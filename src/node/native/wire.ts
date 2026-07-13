/**
 * Minimal Postgres wire-protocol (v3) client — enough for tinbase's needs:
 * trust (unix socket), cleartext/md5/SCRAM-SHA-256 auth (external TCP),
 * simple + extended queries, typed decoding, LISTEN/NOTIFY. Pure Node, no deps.
 */
import { createConnection, type Socket } from 'node:net'
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'

interface ConnectOpts {
  socketPath?: string
  host?: string
  port?: number
  user: string
  database: string
  password?: string
}

export interface WireResults<T = any> {
  rows: T[]
  affectedRows?: number
}

export class PgWireError extends Error {
  code?: string
  detail?: string
  hint?: string
  severity?: string
  constructor(fields: Map<string, string>) {
    super(fields.get('M') ?? 'postgres error')
    this.code = fields.get('C')
    this.detail = fields.get('D')
    this.hint = fields.get('H')
    this.severity = fields.get('S')
  }
}

interface Column {
  name: string
  typeOid: number
}

export class PgWireClient {
  private socket!: Socket
  private buffer = Buffer.alloc(0)
  private pending: {
    resolve: (v: WireResults[]) => void
    reject: (e: Error) => void
    results: WireResults[]
    columns: Column[]
    error: PgWireError | null
  } | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  onNotification: ((channel: string, payload: string) => void) | null = null

  static async connect(opts: ConnectOpts) {
    const client = new PgWireClient()
    await client.open(opts)
    return client
  }

  private open(opts: ConnectOpts) {
    return new Promise<void>((resolve, reject) => {
      this.socket = opts.socketPath
        ? createConnection(opts.socketPath)
        : createConnection(opts.port ?? 5432, opts.host ?? '127.0.0.1')
      this.socket.on('error', (e) => {
        if (this.pending) this.pending.reject(e)
        reject(e)
      })
      this.socket.on('close', () => {
        this.closed = true
        this.pending?.reject(new Error('connection closed'))
      })
      this.socket.on('connect', () => {
        // StartupMessage: length, protocol 196608, key/value pairs
        const params = `user\0${opts.user}\0database\0${opts.database}\0client_encoding\0UTF8\0\0`
        const body = Buffer.from(params, 'utf8')
        const msg = Buffer.alloc(8 + body.length)
        msg.writeInt32BE(8 + body.length, 0)
        msg.writeInt32BE(196608, 4)
        body.copy(msg, 8)
        this.socket.write(msg)
      })

      // SCRAM handshake state, carried across the SASL message exchange
      let clientNonce = ''
      let clientFirstBare = ''
      let serverSignature = ''
      const needPassword = (): boolean => {
        if (opts.password == null) {
          reject(new Error('the server requested a password but none was provided'))
          return false
        }
        return true
      }

      // Startup phase: consume until first ReadyForQuery
      const startupHandler = (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk])
        let msg
        while ((msg = this.nextMessage()) !== null) {
          const [type, payload] = msg
          if (type === 0x52) {
            // Authentication request
            const code = payload.readInt32BE(0)
            if (code === 0) {
              // AuthenticationOk — proceed to ReadyForQuery
            } else if (code === 3) {
              // cleartext password
              if (!needPassword()) return
              this.socket.write(message(0x70, cstring(opts.password!)))
            } else if (code === 5) {
              // md5 password: 'md5' + md5(md5(password + user) + salt)
              if (!needPassword()) return
              const salt = payload.subarray(4, 8)
              const inner = md5Hex(Buffer.from(opts.password! + opts.user, 'utf8'))
              const token = 'md5' + md5Hex(Buffer.concat([Buffer.from(inner, 'utf8'), salt]))
              this.socket.write(message(0x70, cstring(token)))
            } else if (code === 10) {
              // SASL: choose SCRAM-SHA-256
              if (!needPassword()) return
              const mechs = payload.subarray(4).toString('utf8').split('\0').filter(Boolean)
              if (!mechs.includes('SCRAM-SHA-256')) {
                reject(new Error(`no supported SASL mechanism (server offered: ${mechs.join(', ')})`))
                return
              }
              clientNonce = randomBytes(18).toString('base64')
              clientFirstBare = `n=,r=${clientNonce}`
              const initial = Buffer.from(`n,,${clientFirstBare}`, 'utf8')
              this.socket.write(
                message(0x70, Buffer.concat([cstring('SCRAM-SHA-256'), int32(initial.length), initial]))
              )
            } else if (code === 11) {
              // SASLContinue: server-first-message (r=nonce,s=salt,i=iterations)
              const serverFirst = payload.subarray(4).toString('utf8')
              const attrs = scramAttrs(serverFirst)
              if (!attrs.r?.startsWith(clientNonce)) {
                reject(new Error('SCRAM: server nonce does not extend client nonce'))
                return
              }
              const salt = Buffer.from(attrs.s!, 'base64')
              const iterations = parseInt(attrs.i!, 10)
              const saltedPassword = pbkdf2Sync(opts.password!, salt, iterations, 32, 'sha256')
              const clientKey = hmac(saltedPassword, 'Client Key')
              const storedKey = sha256(clientKey)
              const finalNoProof = `c=biws,r=${attrs.r}`
              const authMessage = `${clientFirstBare},${serverFirst},${finalNoProof}`
              const clientSignature = hmac(storedKey, authMessage)
              const proof = xorBuffers(clientKey, clientSignature)
              serverSignature = hmac(hmac(saltedPassword, 'Server Key'), authMessage).toString('base64')
              const clientFinal = `${finalNoProof},p=${proof.toString('base64')}`
              this.socket.write(message(0x70, Buffer.from(clientFinal, 'utf8')))
            } else if (code === 12) {
              // SASLFinal: verify the server signature (v=...)
              const v = scramAttrs(payload.subarray(4).toString('utf8')).v
              if (v && serverSignature && v !== serverSignature) {
                reject(new Error('SCRAM: server signature verification failed'))
                return
              }
            } else {
              reject(new Error(`unsupported auth method ${code}`))
              return
            }
          } else if (type === 0x45) {
            reject(new PgWireError(parseErrorFields(payload)))
            return
          } else if (type === 0x5a) {
            // ReadyForQuery
            this.socket.off('data', startupHandler)
            this.socket.on('data', (c: Buffer) => {
              this.buffer = Buffer.concat([this.buffer, c])
              this.processMessages()
            })
            resolve()
            return
          }
          // ParameterStatus (S), BackendKeyData (K), NoticeResponse (N) — ignore
        }
      }
      this.socket.on('data', startupHandler)
    })
  }

  /** One protocol op at a time; queued to be safe under concurrency. */
  private run(send: () => void): Promise<WireResults[]> {
    const op = this.queue.then(
      () =>
        new Promise<WireResults[]>((resolve, reject) => {
          if (this.closed) return reject(new Error('connection closed'))
          this.pending = { resolve, reject, results: [], columns: [], error: null }
          send()
        })
    )
    this.queue = op.catch(() => {})
    return op
  }

  /** Simple query protocol — supports multiple statements. */
  async exec(sql: string): Promise<WireResults[]> {
    return this.run(() => this.socket.write(message(0x51, cstring(sql))))
  }

  /** Extended query protocol with text-format params. */
  async query<T = any>(sql: string, params: unknown[] = []): Promise<WireResults<T>> {
    const results = await this.run(() => {
      const parse = message(0x50, Buffer.concat([cstring(''), cstring(sql), int16(0)]))
      const paramBufs: Buffer[] = [int16(0), int16(params.length)]
      for (const p of params) {
        if (p === null || p === undefined) {
          paramBufs.push(int32(-1))
        } else {
          const b = Buffer.from(String(p), 'utf8')
          paramBufs.push(int32(b.length), b)
        }
      }
      paramBufs.push(int16(0))
      const bind = message(0x42, Buffer.concat([cstring(''), cstring(''), ...paramBufs]))
      const describe = message(0x44, Buffer.concat([Buffer.from('P'), cstring('')]))
      const execute = message(0x45, Buffer.concat([cstring(''), int32(0)]))
      const sync = message(0x53, Buffer.alloc(0))
      this.socket.write(Buffer.concat([parse, bind, describe, execute, sync]))
    })
    return (results[0] ?? { rows: [] }) as WireResults<T>
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) return resolve()
      this.socket.write(message(0x58, Buffer.alloc(0))) // Terminate
      this.socket.end(() => resolve())
    })
  }

  // ── message pump ──────────────────────────────────────────────────────

  private nextMessage(): [number, Buffer] | null {
    if (this.buffer.length < 5) return null
    const type = this.buffer[0]
    const length = this.buffer.readInt32BE(1)
    if (this.buffer.length < 1 + length) return null
    const payload = this.buffer.subarray(5, 1 + length)
    this.buffer = this.buffer.subarray(1 + length)
    return [type, Buffer.from(payload)]
  }

  private processMessages(): void {
    let msg
    while ((msg = this.nextMessage()) !== null) {
      const [type, payload] = msg
      const p = this.pending
      switch (type) {
        case 0x54: {
          // RowDescription
          if (!p) break
          const count = payload.readInt16BE(0)
          let off = 2
          const columns: Column[] = []
          for (let i = 0; i < count; i++) {
            const end = payload.indexOf(0, off)
            const name = payload.toString('utf8', off, end)
            off = end + 1
            const typeOid = payload.readInt32BE(off + 6)
            off += 18
            columns.push({ name, typeOid })
          }
          p.columns = columns
          break
        }
        case 0x44: {
          // DataRow
          if (!p) break
          const count = payload.readInt16BE(0)
          let off = 2
          const row: Record<string, unknown> = {}
          for (let i = 0; i < count; i++) {
            const len = payload.readInt32BE(off)
            off += 4
            let value: unknown = null
            if (len >= 0) {
              value = decodeValue(payload.toString('utf8', off, off + len), p.columns[i]?.typeOid ?? 25)
              off += len
            }
            row[p.columns[i]?.name ?? `col${i}`] = value
          }
          if (p.results.length === 0) p.results.push({ rows: [] })
          p.results[p.results.length - 1].rows.push(row)
          break
        }
        case 0x43: {
          // CommandComplete — tag like "INSERT 0 5" / "UPDATE 3" / "SELECT 2"
          if (!p) break
          const tag = payload.toString('utf8', 0, payload.length - 1)
          const parts = tag.split(' ')
          const affected = parseInt(parts[parts.length - 1], 10)
          if (p.results.length === 0) p.results.push({ rows: [] })
          const current = p.results[p.results.length - 1]
          if (!Number.isNaN(affected)) current.affectedRows = affected
          // next statement in a multi-statement exec starts a fresh result
          p.results.push({ rows: [] })
          p.columns = []
          break
        }
        case 0x45: {
          // ErrorResponse — final resolution happens at ReadyForQuery
          if (p) p.error = new PgWireError(parseErrorFields(payload))
          break
        }
        case 0x41: {
          // NotificationResponse
          payload.readInt32BE(0) // sender pid
          const channelEnd = payload.indexOf(0, 4)
          const channel = payload.toString('utf8', 4, channelEnd)
          const payloadEnd = payload.indexOf(0, channelEnd + 1)
          const body = payload.toString('utf8', channelEnd + 1, payloadEnd)
          this.onNotification?.(channel, body)
          break
        }
        case 0x5a: {
          // ReadyForQuery — op finished
          if (!p) break
          this.pending = null
          if (p.error) p.reject(p.error)
          else {
            // drop the trailing empty result opened by the last CommandComplete
            const results = p.results.filter((r, i) => i < p.results.length - 1 || r.rows.length > 0 || r.affectedRows !== undefined)
            p.resolve(results.length > 0 ? results : [{ rows: [] }])
          }
          break
        }
        // ParseComplete (1), BindComplete (2), NoData (n), EmptyQueryResponse (I),
        // NoticeResponse (N), ParameterStatus (S) — ignored
      }
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

// ── auth helpers ──
const hmac = (key: Buffer, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest()
const sha256 = (b: Buffer): Buffer => createHash('sha256').update(b).digest()
const md5Hex = (b: Buffer): string => createHash('md5').update(b).digest('hex')
function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i]
  return out
}
/** Parse SCRAM attribute strings like `r=…,s=…,i=…` into a map. */
function scramAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of s.split(',')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

function message(type: number, body: Buffer): Buffer {
  const out = Buffer.alloc(5 + body.length)
  out[0] = type
  out.writeInt32BE(4 + body.length, 1)
  body.copy(out, 5)
  return out
}

const cstring = (s: string) => Buffer.from(s + '\0', 'utf8')
const int16 = (n: number) => {
  const b = Buffer.alloc(2)
  b.writeInt16BE(n)
  return b
}
const int32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n)
  return b
}

function parseErrorFields(payload: Buffer): Map<string, string> {
  const fields = new Map<string, string>()
  let off = 0
  while (off < payload.length && payload[off] !== 0) {
    const key = String.fromCharCode(payload[off])
    const end = payload.indexOf(0, off + 1)
    fields.set(key, payload.toString('utf8', off + 1, end))
    off = end + 1
  }
  return fields
}

/** Decode a text-format value by type OID to match PGlite's JS types. */
function decodeValue(text: string, oid: number): unknown {
  switch (oid) {
    case 16: // bool
      return text === 't'
    case 20: // int8
    case 21: // int2
    case 23: // int4
    case 26: // oid
      return Number(text)
    case 700:
    case 701: // float4/8
      return Number(text)
    case 114: // json
    case 3802: // jsonb
      return JSON.parse(text)
    case 1114: // timestamp
      return new Date(text.replace(' ', 'T') + 'Z')
    case 1184: {
      // timestamptz: "2026-07-05 14:00:00.1+00"
      let iso = text.replace(' ', 'T')
      if (/[+-]\d\d$/.test(iso)) iso += ':00'
      return new Date(iso)
    }
    case 1000: // _bool
      return parsePgArray(text).map((v) => v === 't')
    case 1007: // _int4
    case 1016: // _int8
      return parsePgArray(text).map((v) => (v === null ? null : Number(v)))
    case 1009: // _text
    case 1015: // _varchar
      return parsePgArray(text)
    default:
      return text
  }
}

/** Parse a one-dimensional Postgres array literal: {a,"b c",NULL} */
export function parsePgArray(text: string): (string | null)[] {
  const out: (string | null)[] = []
  if (text.length < 2) return out
  let i = 1
  while (i < text.length - 1) {
    if (text[i] === ',') {
      i++
      continue
    }
    if (text[i] === '"') {
      let value = ''
      i++
      while (text[i] !== '"') {
        if (text[i] === '\\') i++
        value += text[i++]
      }
      i++
      out.push(value)
    } else {
      let value = ''
      while (i < text.length - 1 && text[i] !== ',') value += text[i++]
      out.push(value === 'NULL' ? null : value)
    }
  }
  return out
}
