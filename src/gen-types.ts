/**
 * Generate a Supabase-shaped `Database` TypeScript type from the live schema,
 * matching `supabase gen types typescript` closely enough that a typed
 * supabase-js client works unchanged:
 *
 *   export type Database = {
 *     public: {
 *       Tables: { <t>: { Row, Insert, Update, Relationships } }
 *       Views:  { <v>: { Row } }
 *       Functions: { <f>: { Args, Returns } }
 *       Enums:  { <e>: "a" | "b" }
 *       CompositeTypes: {}
 *     }
 *   }
 */
import type { Database } from './db/database.js'

interface ColumnRow {
  table_name: string
  column_name: string
  udt_name: string
  is_nullable: string
  has_default: boolean
  is_generated: boolean
  table_kind: string // 'r' table, 'v' view, 'm' matview
}

interface EnumRow {
  name: string
  labels: string[]
}

interface FnRow {
  name: string
  args_json: { name: string; type: string }[] | null
  return_type: string
  returns_set: boolean
  return_typtype: string
}

const JSON_TYPE = 'Json'

export async function generateTypes(db: Database, schema = 'public'): Promise<string> {
  const enums = await loadEnums(db, schema)
  const enumNames = new Set(enums.map((e) => e.name))
  const cols = await loadColumns(db, schema)
  const info = await db.getSchemaInfo(schema)
  const fns = await loadFunctions(db, schema)

  const tables = new Map<string, ColumnRow[]>()
  const views = new Map<string, ColumnRow[]>()
  for (const c of cols) {
    const target = c.table_kind === 'r' ? tables : views
    if (!target.has(c.table_name)) target.set(c.table_name, [])
    target.get(c.table_name)!.push(c)
  }

  const tsType = (udt: string, nullable: boolean): string => {
    const base = mapType(udt, enumNames, schema)
    return nullable ? `${base} | null` : base
  }

  const relationshipsFor = (table: string): string => {
    const fks = info.foreignKeys.filter((fk) => fk.srcSchema === schema && fk.srcTable === table)
    if (fks.length === 0) return '[]'
    const items = fks.map(
      (fk) =>
        `          {\n` +
        `            foreignKeyName: ${JSON.stringify(fk.constraintName)}\n` +
        `            columns: ${JSON.stringify(fk.srcColumns)}\n` +
        `            isOneToOne: false\n` +
        `            referencedRelation: ${JSON.stringify(fk.tgtTable)}\n` +
        `            referencedColumns: ${JSON.stringify(fk.tgtColumns)}\n` +
        `          }`
    )
    return `[\n${items.join(',\n')}\n        ]`
  }

  const tableBlock = (name: string, columns: ColumnRow[]): string => {
    const row = columns.map((c) => `          ${ident(c.column_name)}: ${tsType(c.udt_name, c.is_nullable === 'YES')}`).join('\n')
    const insert = columns
      .map((c) => {
        const optional = c.is_nullable === 'YES' || c.has_default || c.is_generated
        const t = c.is_nullable === 'YES' ? `${mapType(c.udt_name, enumNames, schema)} | null` : mapType(c.udt_name, enumNames, schema)
        return `          ${ident(c.column_name)}${optional ? '?' : ''}: ${t}`
      })
      .join('\n')
    const update = columns
      .map((c) => {
        const t = c.is_nullable === 'YES' ? `${mapType(c.udt_name, enumNames, schema)} | null` : mapType(c.udt_name, enumNames, schema)
        return `          ${ident(c.column_name)}?: ${t}`
      })
      .join('\n')
    return (
      `      ${ident(name)}: {\n` +
      `        Row: {\n${row}\n        }\n` +
      `        Insert: {\n${insert}\n        }\n` +
      `        Update: {\n${update}\n        }\n` +
      `        Relationships: ${relationshipsFor(name)}\n` +
      `      }`
    )
  }

  const viewBlock = (name: string, columns: ColumnRow[]): string => {
    const row = columns.map((c) => `          ${ident(c.column_name)}: ${tsType(c.udt_name, c.is_nullable === 'YES')}`).join('\n')
    return `      ${ident(name)}: {\n        Row: {\n${row}\n        }\n        Relationships: []\n      }`
  }

  const fnBlock = (f: FnRow): string => {
    const args =
      !f.args_json || f.args_json.length === 0
        ? 'Record<PropertyKey, never>'
        : `{\n${f.args_json.map((a) => `          ${ident(a.name || '')}: ${mapArgType(a.type, enumNames, schema)}`).join('\n')}\n        }`
    const returns = f.return_typtype === 'c' || f.returns_set ? 'Json' : mapType(f.return_type, enumNames, schema)
    return `      ${ident(f.name)}: {\n        Args: ${args}\n        Returns: ${returns}\n      }`
  }

  const tablesBlock = [...tables].map(([n, c]) => tableBlock(n, c)).join('\n')
  const viewsBlock = [...views].map(([n, c]) => viewBlock(n, c)).join('\n')
  const fnsBlock = fns.map(fnBlock).join('\n')
  const enumsBlock = enums.map((e) => `      ${ident(e.name)}: ${e.labels.map((l) => JSON.stringify(l)).join(' | ')}`).join('\n')

  return `export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  ${ident(schema)}: {
    Tables: {
${tablesBlock || '      [_ in never]: never'}
    }
    Views: {
${viewsBlock || '      [_ in never]: never'}
    }
    Functions: {
${fnsBlock || '      [_ in never]: never'}
    }
    Enums: {
${enumsBlock || '      [_ in never]: never'}
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
`
}

function ident(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
}

function mapType(udt: string, enums: Set<string>, schema: string): string {
  if (udt.startsWith('_')) return `${mapType(udt.slice(1), enums, schema)}[]`
  if (enums.has(udt)) return `Database[${JSON.stringify(schema)}]["Enums"][${JSON.stringify(udt)}]`
  switch (udt) {
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
    case 'oid':
      return 'number'
    case 'bool':
      return 'boolean'
    case 'json':
    case 'jsonb':
      return JSON_TYPE
    case 'text':
    case 'varchar':
    case 'bpchar':
    case 'citext':
    case 'uuid':
    case 'date':
    case 'time':
    case 'timetz':
    case 'timestamp':
    case 'timestamptz':
    case 'interval':
    case 'name':
      return 'string'
    default:
      return 'string'
  }
}

function mapArgType(type: string, enums: Set<string>, schema: string): string {
  // pg_get_function_identity_arguments gives sql type names, not udt; normalize
  const t = type.toLowerCase().trim()
  if (t.endsWith('[]')) return `${mapArgType(t.slice(0, -2), enums, schema)}[]`
  if (/int|serial|numeric|decimal|real|double|float/.test(t)) return 'number'
  if (/bool/.test(t)) return 'boolean'
  if (/json/.test(t)) return JSON_TYPE
  return 'string'
}

async function loadColumns(db: Database, schema: string): Promise<ColumnRow[]> {
  const res = await db.query<ColumnRow>(
    `select c.relname as table_name, a.attname as column_name, t.typname as udt_name,
            case when a.attnotnull then 'NO' else 'YES' end as is_nullable,
            (d.adbin is not null) as has_default,
            (a.attgenerated <> '' or a.attidentity <> '') as is_generated,
            c.relkind as table_kind
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     join pg_type t on t.oid = a.atttypid
     left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = $1 and c.relkind in ('r','v','m') and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`,
    [schema]
  )
  return res.rows
}

async function loadEnums(db: Database, schema: string): Promise<EnumRow[]> {
  const res = await db.query<EnumRow>(
    `select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
     from pg_type t
     join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = $1
     group by t.typname
     order by t.typname`,
    [schema]
  )
  return res.rows
}

async function loadFunctions(db: Database, schema: string): Promise<FnRow[]> {
  const res = await db.query<{
    name: string
    identity_args: string
    return_type: string
    returns_set: boolean
    return_typtype: string
  }>(
    `select p.proname as name,
            pg_get_function_identity_arguments(p.oid) as identity_args,
            t.typname as return_type, p.proretset as returns_set, t.typtype as return_typtype
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_type t on t.oid = p.prorettype
     where n.nspname = $1 and p.prokind = 'f'
     order by p.proname`,
    [schema]
  )
  return res.rows.map((r) => ({
    name: r.name,
    return_type: r.return_type,
    returns_set: r.returns_set,
    return_typtype: r.return_typtype,
    args_json: parseArgs(r.identity_args),
  }))
}

function parseArgs(identity: string): { name: string; type: string }[] {
  if (!identity?.trim()) return []
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of identity) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => {
    const toks = p.trim().split(/\s+/)
    while (toks.length > 1 && ['IN', 'OUT', 'INOUT', 'VARIADIC'].includes(toks[0])) toks.shift()
    if (toks.length === 1) return { name: '', type: toks[0] }
    return { name: toks[0].replace(/^"|"$/g, ''), type: toks.slice(1).join(' ') }
  })
}
