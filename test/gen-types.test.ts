import { writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBackend, generateTypes, type TinbaseBackend } from '../src/index.js'

const MIGRATION = `
create type mood as enum ('happy', 'sad');

create table authors (
  id serial primary key,
  name text not null,
  bio text,
  meta jsonb default '{}'::jsonb
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author_id int references authors(id),
  status mood default 'happy',
  tags text[] default '{}',
  created_at timestamptz default now()
);

create function add_two(a int, b int) returns int language sql as $$ select a + b $$;
`

let backend: TinbaseBackend
let output: string

beforeAll(async () => {
  backend = await createBackend({ migrations: [{ name: '20240101000000_types', sql: MIGRATION }] })
  output = await generateTypes(backend.db, 'public')
})
afterAll(async () => {
  await backend.close()
})

describe('gen types', () => {
  it('emits a Database type with Tables/Views/Functions/Enums', () => {
    expect(output).toContain('export type Database = {')
    expect(output).toContain('Tables: {')
    expect(output).toContain('Enums: {')
    expect(output).toContain('mood: "happy" | "sad"')
  })

  it('maps column types and nullability correctly', () => {
    // not-null text → string; nullable text → string | null; jsonb → Json; array → string[]
    expect(output).toMatch(/name: string\n/)
    expect(output).toMatch(/bio: string \| null/)
    expect(output).toMatch(/meta: Json \| null/)
    expect(output).toMatch(/tags: string\[\]/)
    expect(output).toContain('status: Database["public"]["Enums"]["mood"] | null')
  })

  it('Insert makes defaulted/nullable columns optional', () => {
    // posts.id has a default → optional in Insert; title is required
    const insertBlock = output.slice(output.indexOf('Insert: {', output.indexOf('posts:')))
    expect(insertBlock).toMatch(/id\?: string/)
    expect(insertBlock).toMatch(/title: string\n/) // required
  })

  it('includes Relationships from foreign keys', () => {
    expect(output).toContain('referencedRelation: "authors"')
    expect(output).toContain('columns: ["author_id"]')
  })

  it('includes functions with Args and Returns', () => {
    expect(output).toContain('add_two: {')
    expect(output).toMatch(/a: number/)
    expect(output).toContain('Returns: number')
  })

  it('output is valid TypeScript and types a supabase-js client', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-types-'))
    writeFileSync(join(dir, 'db.ts'), output)
    // a program that only compiles if the generated types are well-formed
    writeFileSync(
      join(dir, 'use.ts'),
      `import type { Database } from './db'
type Post = Database['public']['Tables']['posts']['Row']
const p: Post = { id: 'x', title: 't', author_id: null, status: 'happy', tags: [], created_at: null }
const mood: Database['public']['Enums']['mood'] = 'sad'
void p; void mood
`
    )
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, moduleResolution: 'bundler', module: 'esnext', target: 'es2022' } })
    )
    // tsc exits 0 only if the generated .d types check
    execFileSync('npx', ['tsc', '-p', join(dir, 'tsconfig.json')], { stdio: 'pipe' })
  })
})
