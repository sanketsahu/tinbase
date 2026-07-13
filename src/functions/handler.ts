/**
 * Edge Functions (/functions/v1/*) - supabase.functions.invoke() support.
 *
 * A "function" is any fetch handler: (Request) => Response | Promise<Response>.
 * The core takes a name → handler map (portable, works in the browser); the
 * Node CLI populates it from supabase/functions/<name>/index.{ts,js,mjs}
 * modules that `export default` a fetch handler.
 */
import type { RequestContext } from '../types.js'
import { runWithDenoEnv } from './deno-shim.js'

/** An edge function: a fetch handler invoked with the resolved request context. */
export type EdgeFunction = (req: Request, ctx: FunctionContext) => Response | Promise<Response>

/** Second argument passed to every {@link EdgeFunction} invocation. */
export interface FunctionContext {
  /** verified request context (role + JWT claims) resolved by the router */
  auth: RequestContext
  /** keys/urls so the function can create its own supabase-js client, plus any secrets loaded from supabase/functions/.env */
  env: {
    SUPABASE_URL: string
    SUPABASE_ANON_KEY: string
    SUPABASE_SERVICE_ROLE_KEY: string
    [key: string]: string
  }
}

/** Registry and dispatcher for edge functions, backing supabase.functions.invoke(). */
export class FunctionsHandler {
  constructor(
    private functions: Map<string, EdgeFunction>,
    private env: FunctionContext['env']
  ) {}

  /** Register (or replace) a function under `name`, served at /functions/v1/<name>. */
  register(name: string, fn: EdgeFunction): void {
    this.functions.set(name, fn)
  }

  /** Names of all registered functions. */
  list(): string[] {
    return [...this.functions.keys()]
  }

  /** Dispatch a /functions/v1/<name> request to its handler, returning a 404 when unknown and a 500 when the handler throws or returns a non-Response. */
  async handle(req: Request, ctx: RequestContext, url: URL): Promise<Response> {
    const name = url.pathname.replace(/^\/functions\/v1\/?/, '').split('/')[0]
    if (!name) {
      return json(404, { error: 'function name required: /functions/v1/<name>' })
    }
    const fn = this.functions.get(name)
    if (!fn) {
      return json(404, { error: `function "${name}" not found` })
    }
    try {
      // Bind Deno.env to this backend's function env for the call so a
      // Deno.serve/Deno.env-style function reads its own secrets, not another
      // backend's or the host process.env.
      const res = await runWithDenoEnv(this.env, () => Promise.resolve(fn(req, { auth: ctx, env: this.env })))
      if (!(res instanceof Response)) {
        return json(500, { error: `function "${name}" did not return a Response` })
      }
      return res
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return json(500, { error: message })
    }
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
