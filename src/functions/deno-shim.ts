/**
 * Minimal `Deno` global shim so Supabase-style edge functions run unchanged
 * under Node/Bun. Supabase functions are written for Deno:
 *
 *   Deno.serve((req) => new Response(...))
 *   const url = Deno.env.get('SUPABASE_URL')
 *
 * Instead of starting a server, our `Deno.serve` captures the handler so the
 * FunctionsHandler can invoke it per request; `Deno.env` reads only the
 * injected SUPABASE_* vars and declared function secrets (never the host
 * process.env).
 *
 * Not resolved: `npm:` / `jsr:` / URL import specifiers and the Deno std lib —
 * a function using those needs a bundling step. Functions that stick to Web
 * APIs (fetch/Request/Response) + Deno.serve/Deno.env work as-is.
 */
type DenoHandler = (req: Request) => Response | Promise<Response>

const captured: { handler?: DenoHandler } = {}

// The Deno global is installed once per process, but each backend has its own
// function env. `activeEnv` is the env the shim's Deno.env currently reads from;
// it's swapped to the invoking backend's env for the duration of each call (see
// runWithDenoEnv). Defaults to empty so a stray Deno.env read outside any
// invocation sees nothing rather than another backend's secrets.
let activeEnv: Record<string, string> = {}

/**
 * Run `fn` with the shim's Deno.env bound to `env`, restoring the previous env
 * afterwards. This keeps Deno.env scoped to the backend handling the request so
 * one backend can't read another's (or the host's) secrets. Invocations are not
 * concurrent within a single synchronous dispatch, but we still restore in a
 * finally to survive throws and nested calls.
 */
export async function runWithDenoEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev = activeEnv
  activeEnv = env
  try {
    return await fn()
  } finally {
    activeEnv = prev
  }
}

/** Install globalThis.Deno if we're not already running under a Deno-like runtime. */
export function installDenoShim(): void {
  const g = globalThis as Record<string, unknown> & { Deno?: unknown; __tinbaseDeno?: boolean }
  if (g.__tinbaseDeno) return
  // a real Deno runtime already provides Deno.serve — don't clobber it
  if (g.Deno && typeof (g.Deno as { serve?: unknown }).serve === 'function') return
  g.__tinbaseDeno = true
  g.Deno = {
    serve(arg1: unknown, arg2?: unknown) {
      captured.handler = (typeof arg1 === 'function' ? arg1 : arg2) as DenoHandler
      // Deno.serve returns a server; some functions `await server.finished`.
      return { finished: Promise.resolve(), shutdown() {}, ref() {}, unref() {}, addr: { hostname: '0.0.0.0', port: 0, transport: 'tcp' } }
    },
    // Scope Deno.env to the injected SUPABASE_* vars + declared function
    // secrets only. It deliberately does NOT fall through to the host
    // process.env, so a function can't read arbitrary server-side env (cloud
    // credentials, DB URLs, etc.).
    env: {
      get: (k: string) => activeEnv[k],
      set: (k: string, v: string) => {
        activeEnv[k] = v
      },
      has: (k: string) => activeEnv[k] !== undefined,
      delete: (k: string) => {
        delete activeEnv[k]
      },
      toObject: () => ({ ...activeEnv }),
    },
    // enough of the surface that idiomatic functions don't crash on reference
    cwd: () => process.cwd(),
    // a function must not be able to terminate the whole server; throw instead
    // of calling process.exit.
    exit: (code?: number) => {
      throw new Error(`Deno.exit(${code ?? 0}) called in an edge function (ignored)`)
    },
  }
}

/** Return and clear the handler captured by the most recent Deno.serve() call. */
export function takeCapturedHandler(): DenoHandler | undefined {
  const h = captured.handler
  captured.handler = undefined
  return h
}

export function resetCapturedHandler(): void {
  captured.handler = undefined
}
