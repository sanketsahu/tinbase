import { Play } from 'lucide-react'
import { useState } from 'react'
import { api, getKey } from '../../api'
import { Button, CodeEditor, CodeView, Label, Select, Sheet, SheetClose, Spinner } from '../../components/ui'
import { apiUrl } from '../../lib/snippet'

interface InvokeResult {
  status: number
  ms: number
  headers: [string, string][]
  body: string
}

/** Fire real HTTP requests at /functions/v1/<name> and inspect the response. */
export function InvokeTester({ name, onClose }: { name: string; onClose: () => void }) {
  const [method, setMethod] = useState('POST')
  const [role, setRole] = useState<'service_role' | 'anon'>('service_role')
  const [body, setBody] = useState('{\n  "name": "world"\n}')
  const [result, setResult] = useState<InvokeResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function invoke() {
    setBusy(true)
    setResult(null)
    try {
      const key = role === 'anon' ? ((await api.keys()).anonKey ?? getKey()) : getKey()
      const started = performance.now()
      const res = await fetch(`${apiUrl()}/functions/v1/${name}`, {
        method,
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
      })
      const text = await res.text()
      let pretty = text
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        // not JSON — show raw
      }
      setResult({
        status: res.status,
        ms: Math.round(performance.now() - started),
        headers: [...res.headers.entries()],
        body: pretty,
      })
    } catch (e) {
      setResult({ status: 0, ms: 0, headers: [], body: `Request failed: ${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-[560px]"
      title={
        <span>
          Invoke <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">{name}</code>
        </span>
      }
      footer={
        <>
          <SheetClose asChild>
            <Button variant="outline">Close</Button>
          </SheetClose>
          <Button className="ml-auto" onClick={() => void invoke()} disabled={busy}>
            <Play size={12} /> {busy ? 'Invoking…' : 'Invoke'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Method</Label>
            <Select
              value={method}
              onValueChange={setMethod}
              options={['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m }))}
            />
          </div>
          <div>
            <Label>Authorization</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as typeof role)}
              options={[
                { value: 'service_role', label: 'service_role key' },
                { value: 'anon', label: 'anon key' },
              ]}
            />
          </div>
        </div>

        {method !== 'GET' && (
          <div>
            <Label>Request body (JSON)</Label>
            <CodeEditor lang="js" className="h-32" value={body} onChange={setBody} onCmdEnter={() => void invoke()} />
          </div>
        )}

        {busy && <Spinner />}
        {result && (
          <div>
            <div className="mb-2 flex items-center gap-3 text-[13px]">
              <span
                className={
                  'rounded px-2 py-0.5 font-mono text-xs font-semibold ' +
                  (result.status >= 200 && result.status < 300
                    ? 'bg-brand/15 text-brand'
                    : result.status === 0
                      ? 'bg-destructive/15 text-destructive'
                      : 'bg-warning/15 text-warning')
                }
              >
                {result.status || 'ERR'}
              </span>
              <span className="text-muted-foreground/80">{result.ms} ms</span>
            </div>
            <CodeView value={result.body || '(empty body)'} lang="js" readOnly minLines={4} maxLines={200} />
            {result.headers.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Response headers ({result.headers.length})
                </summary>
                <div className="mt-1.5 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                  {result.headers.map(([k, v]) => (
                    <div key={k} className="truncate">
                      <span className="text-foreground/70">{k}</span>: {v}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
