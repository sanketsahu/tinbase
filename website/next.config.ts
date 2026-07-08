import type { NextConfig } from 'next'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// read the tinbase package version from the repo root so the site's version
// badge stays in sync automatically (no manual bump). `next build` runs with
// cwd = website/, so ../package.json is the root package.
let tinbaseVersion = '0.0.0'
try {
  tinbaseVersion = JSON.parse(readFileSync(join(process.cwd(), '..', 'package.json'), 'utf8')).version
} catch {
  // fall back to 0.0.0 if the root package.json isn't reachable
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_TINBASE_VERSION: tinbaseVersion,
  },
}

export default nextConfig
