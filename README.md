# Word Art Engine

Turn a photo into typographic word art: each major element in the image is
redrawn using its own name as repeated text — a boat becomes the word
**BOAT**, the sea becomes rows of **OCEAN**, the sky becomes **CLOUDS**.

One Claude vision call analyzes the photo and returns a compact layout spec;
everything after that is deterministic, client-side SVG rendering.

## Two render modes

- **Poster** — a designed, non-literal interpretation. Background bands
  ("fields" like sky/ocean) fade along an axis via opacity curves, foreground
  shapes ("subjects" like a boat) render as bold word-filled silhouettes from
  a density grid, and the palette is chosen to complement the photo while
  leaving deliberate whitespace.
- **Mosaic** — an ASCII-engine-style rendering. The photo is downsampled to a
  letter grid, every letter takes the true color of the pixels under it, and
  the character in each cell comes from the word of whichever element that
  cell belongs to (via a coarse segmentation grid Claude returns in the same
  call). A letter-size slider trades detail for legibility.

## Running it

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Upload a photo, hit **Generate word art**, then tweak: mode toggle, letter
size (mosaic), colors, font, per-element words and opacity — all tweaks
re-render instantly without another API call. Export as SVG, PNG, or the raw
layout JSON (which can be hand-edited and re-rendered).

## How it works

```
photo ──▶ /api/generate ──▶ Claude vision ──▶ LayoutSpec JSON
                              │  (Zod-validated; one self-correction
                              │   retry; procedural fallback)
                              ▼
        ┌─ fields:   word + opacity curve along an axis
        ├─ subjects: word + bbox + 20×20 density grid
        ├─ label_grid: ~40×24 coarse segmentation (mosaic mode)
        └─ palette + font
                              │
                              ▼
   WordArtRenderer (poster) / MosaicRenderer (mosaic) ──▶ SVG ──▶ PNG/JSON
```

Key files:

- `lib/layoutSchema.ts` — Zod schema, the single source of truth for the spec
- `lib/anthropicPrompt.ts` — the vision prompt with a one-shot boat example
- `app/api/generate/route.ts` — API route: validate → retry → fallback
- `components/WordArtRenderer.tsx` — poster renderer
- `components/MosaicRenderer.tsx` — mosaic renderer (canvas color sampling)
- `scripts/verify-ui.mjs` — Playwright e2e check with a mocked API response
  (`npm run dev` in one shell, then `node scripts/verify-ui.mjs`)
