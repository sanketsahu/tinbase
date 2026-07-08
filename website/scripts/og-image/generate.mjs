/**
 * Regenerate the Open Graph image (app/opengraph-image.png).
 *
 * The OG card is a plain HTML page (built below with the Geist fonts inlined so
 * the render is self-contained) screenshotted at 1200x630 @2x in Chromium. This
 * gives real-browser typography and text wrapping, which Satori/next-og cannot
 * match.
 *
 * Requires Playwright's Chromium. Either:
 *   - `npx playwright install chromium` (then this script finds it), or
 *   - set CHROME_PATH to a Chrome/Chromium binary.
 *
 * Run:  node scripts/og-image/generate.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', 'app', 'opengraph-image.png')
const font = async (f) => (await readFile(join(HERE, 'fonts', f))).toString('base64')

const [g400, g700, mono] = await Promise.all([
  font('Geist-400.woff'),
  font('Geist-700.woff'),
  font('GeistMono-400.woff'),
])

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Geist'; font-weight: 400; src: url(data:font/woff;base64,${g400}) format('woff'); }
  @font-face { font-family: 'Geist'; font-weight: 700; src: url(data:font/woff;base64,${g700}) format('woff'); }
  @font-face { font-family: 'Geist Mono'; font-weight: 400; src: url(data:font/woff;base64,${mono}) format('woff'); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  .card {
    width: 1200px; height: 630px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 0 90px;
    background-color: #09090b;
    background-image: radial-gradient(ellipse 90% 70% at 50% 0%, rgba(5,150,105,0.18), transparent 62%);
    color: #fafafa;
    font-family: 'Geist', sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .logo { margin-bottom: 40px; filter: drop-shadow(0 8px 30px rgba(52,211,153,0.25)); }
  h1 {
    font-weight: 700; font-size: 66px; line-height: 1.12; letter-spacing: -2.5px;
    text-align: center; max-width: 980px; text-wrap: balance;
  }
  h1 .tin { color: #34d399; }
  p {
    margin-top: 30px; font-weight: 400; font-size: 27px; line-height: 1.4;
    color: #a1a1aa; text-align: center; max-width: 820px; letter-spacing: -0.2px;
  }
  .cli {
    margin-top: 46px; padding: 15px 30px; border-radius: 12px;
    border: 1px solid #27272a; background-color: #161618;
    font-family: 'Geist Mono', monospace; font-size: 27px; color: #34d399;
    letter-spacing: -0.5px;
  }
  .cli .prompt { color: #52525b; }
</style>
</head>
<body>
  <div class="card">
    <svg class="logo" width="128" height="128" viewBox="0 0 120 120" fill="none">
      <path d="M24 34v56c0 8.8 16.1 16 36 16s36-7.2 36-16V34" fill="#059669" />
      <path d="M24 62c0 8.8 16.1 16 36 16s36-7.2 36-16" stroke="#ffffff" stroke-opacity="0.35" stroke-width="4" fill="none" />
      <ellipse cx="60" cy="34" rx="36" ry="16" fill="#34d399" />
      <circle cx="72" cy="31" r="7" fill="none" stroke="#065f46" stroke-width="4" />
    </svg>
    <h1>The Supabase-compatible backend that fits in a <span class="tin">tin</span></h1>
    <p>One small binary · real Postgres with RLS · supabase-js works unchanged · no Docker</p>
    <div class="cli"><span class="prompt">$</span> npx tinbase start</div>
  </div>
</body>
</html>`

const { chromium } = await import('playwright-core').catch(() => import('playwright'))
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
)
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } })
await browser.close()
console.log('wrote', OUT)
