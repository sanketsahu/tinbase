import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Most suites boot a full backend (PGlite WASM Postgres) in beforeAll.
    // A cold boot is seconds on its own and much longer when several workers
    // boot at once — the 5s/10s vitest defaults kill suites at random under
    // load, showing up as "skipped" tests and hook timeouts.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Cap parallelism: a worker per core means dozens of concurrent WASM
    // Postgres boots, which thrashes the machine and makes every suite
    // slower than running fewer at a time.
    maxWorkers: 4,
  },
})
