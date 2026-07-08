# OG image

The site's Open Graph image is a static PNG at `app/opengraph-image.png` (Next
serves it and injects the `og:image` / `twitter:image` tags automatically via the
[file convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image)).

It's produced by screenshotting an HTML card in Chromium rather than generating it
with `next/og` (Satori), so it gets real-browser typography, `text-wrap: balance`,
gradients, and drop shadows. The card uses the site's heading font (Geist) and
Geist Mono, inlined into the page so the render is self-contained.

## Regenerate

```bash
# one-time: get a Chromium for Playwright
npx playwright install chromium
# then, from website/:
node scripts/og-image/generate.mjs
```

The image renders at 1200×630 @2x (2400×1260). To point at an existing
Chrome/Chromium instead of the Playwright download, set `CHROME_PATH`.

Edit the copy, colors, or layout inside `generate.mjs` and re-run.
