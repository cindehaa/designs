import type { LayoutSpec } from "@/lib/layoutSchema";

/**
 * The one-shot example that anchors the aesthetic: a painting of a sailboat on
 * a stormy ocean under a cloudy sky. This is a concrete, schema-valid
 * `LayoutSpec` we show Claude so it learns (a) the exact JSON shape, (b) that
 * fields should use deliberate whitespace/fade rather than filling edge-to-edge,
 * and (c) that subjects should read as a recognizable bold silhouette.
 */
/**
 * Builds the example's coarse label grid (40x24) for the boat scene:
 * clouds across the top third, ocean across the bottom half, the boat as a
 * blob in the middle, and `.` where nothing dominates (horizon gap). In real
 * outputs this grid is a faithful coarse segmentation of the photo.
 */
function buildExampleLabelGrid(): string[] {
  const COLS = 40;
  const ROWS = 24;
  const rows: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    let row = "";
    const y = r / (ROWS - 1);
    for (let c = 0; c < COLS; c++) {
      const x = c / (COLS - 1);
      // Boat blob: center-left, between 35% and 62% down.
      const inBoat =
        y > 0.35 && y < 0.62 && x > 0.34 && x < 0.66 && Math.abs(x - 0.5) < (y - 0.3) * 0.6;
      if (inBoat) row += "1"; // BOAT
      else if (y < 0.34) row += "0"; // CLOUDS
      else if (y > 0.48) row += "2"; // OCEAN
      else row += "."; // horizon band — no element
    }
    rows.push(row);
  }
  return rows;
}

const ONE_SHOT_EXAMPLE: LayoutSpec = {
  background_color: "#efeae2", // warm cream
  text_color: "#262019", // dark charcoal ink
  font_family: "Roboto Slab",
  fields: [
    {
      // Sky band: dense at the very top, faded to near-zero by ~55% down.
      word: "CLOUDS",
      axis: "vertical",
      opacity_curve: [
        [0.0, 0.95],
        [0.25, 0.6],
        [0.45, 0.25],
        [0.55, 0.03],
      ],
    },
    {
      // Ocean band: a faint ghost until ~45% down, then ramps to fully solid
      // by the bottom edge.
      word: "OCEAN",
      axis: "vertical",
      opacity_curve: [
        [0.0, 0.05],
        [0.45, 0.05],
        [0.7, 0.45],
        [1.0, 1.0],
      ],
    },
  ],
  subjects: [
    {
      // Bold, solid silhouette of the ship's hull + sails in the middle.
      word: "BOAT",
      bbox: { x: 0.33, y: 0.38, w: 0.34, h: 0.26 },
      density_grid: [
        "00000090000000000000",
        "00000099000000000000",
        "00000099900000000000",
        "00000099990000000000",
        "00000099999000000000",
        "00000099999900000000",
        "00000099999990000000",
        "00000099999999000000",
        "00000099999999900000",
        "00000099999999990000",
        "00000099999999999000",
        "00000099999999999900",
        "00000099999999999990",
        "00000099999999999990",
        "00099999999999999999",
        "00999999999999999990",
        "09999999999999999900",
        "09999999999999999000",
        "00999999999999990000",
        "00099999999999900000",
      ],
      z: 10,
      opacity: 1.0,
    },
  ],
  label_grid: {
    words: ["CLOUDS", "BOAT", "OCEAN"],
    rows: buildExampleLabelGrid(),
  },
};

const ALLOWED_FONTS = ["Roboto Slab", "Zilla Slab", "Bitter"] as const;

/**
 * The system prompt: role, hard rules, and the schema contract. Kept stable so
 * it can be prompt-cached across requests.
 */
export function buildSystemPrompt(): string {
  return `You are the essence-extraction engine for an image -> word-art generator.

Given a single photograph, identify the 2-5 most dominant visual elements and turn them into a typographic layout spec. Each element is either a FIELD or a SUBJECT:

- A FIELD is a background band that varies smoothly along one axis (sky, ocean, grass, wall, sand...). Represent it with ONE all-caps word plus an "opacity_curve": a small list of [position_along_axis, opacity] control points that a renderer interpolates per text row. Fields should use deliberate whitespace and fade — do NOT fill the canvas edge-to-edge with solid opacity. A convincing field has visible ramps and near-transparent regions (e.g. ~0.05 opacity) so the word-art breathes.

- A SUBJECT is a discrete foreground shape (boat, person, tree, bird, building...). Represent it with ONE all-caps word, a normalized bounding box {x, y, w, h}, and a small local "density_grid": an array of equal-length strings of digit characters 0-9 (0=empty, 9=max density) that traces the subject's silhouette. The grid is scoped ONLY to the subject's own bbox, NOT the whole canvas — roughly 20 rows by 20 columns. A subject should read as a recognizable, bold silhouette.

Also choose:
- "background_color" and "text_color" as hex strings that COMPLEMENT the actual photo's palette. Do not default to cream/charcoal — that is only the example. A cool seascape, a green forest, or a neon city each deserve their own fitting palette.
- "font_family" from this exact allow-list of bold slab-serif fonts: ${ALLOWED_FONTS.map((f) => `"${f}"`).join(", ")}.

Additionally, produce a "label_grid": a coarse semantic segmentation of the WHOLE photo, about 40 columns x 24 rows. It has a "words" array listing every element name (reuse the exact field/subject words), and "rows": strings where each character is a digit indexing into "words" (0 = first word) or "." for cells belonging to no listed element. UNLIKE the fields/subjects (which are artistic), the label_grid must be a FAITHFUL 1:1 map of where each element actually appears in the photo — a renderer colors each cell with the photo's true pixel colors, so accuracy matters more than artistry here. Cover everything recognizable; use "." sparingly for genuinely unassignable areas.

HARD RULES (a response that violates any of these is rejected):
1. Each element's "word" is a SINGLE all-caps word: letters A-Z only, 1-20 characters. No phrases, no spaces, no punctuation, no plural drift beyond one natural word.
2. Every "density_grid" row is digits 0-9 only, and ALL rows in a grid have the SAME length.
3. Every "opacity_curve" has at least 2 points; positions are in 0-1 and STRICTLY INCREASING (0 -> 1). Opacities are in 0-1.
4. Bounding box values are 0-1 normalized to the canvas, and each subject stays on-canvas (x+w <= ~1.0, y+h <= ~1.0).
5. At most 5 elements TOTAL across fields + subjects (typically 1-3 fields and 1-2 subjects).
6. label_grid rows use ONLY digits 0-9 and "."; all rows are the SAME length (16-64 chars); 8-48 rows; every digit indexes into label_grid.words.
7. Respond with ONLY the JSON object matching the schema. No markdown code fences, no commentary, no leading or trailing prose.`;
}

/**
 * The user-turn content: the one-shot example (as concrete JSON) plus the
 * instruction to analyze the attached image. If `zodError` is provided, it is
 * appended so the model can self-correct on a retry.
 */
export function buildUserPrompt(zodError?: string): string {
  const example = JSON.stringify(ONE_SHOT_EXAMPLE, null, 2);

  let prompt = `Here is a worked example. It comes from a painting of a sailboat on a stormy ocean under a cloudy sky. Study the JSON shape AND the aesthetic choices: "CLOUDS" fills the sky and fades to near-zero by ~55% down; "OCEAN" is an almost-invisible ghost (~0.05 opacity) until ~45% down, then ramps to fully solid at the bottom; "BOAT" is a bold, solid silhouette in the middle. Background is warm cream, text is dark charcoal ink.

EXAMPLE OUTPUT:
${example}

Now analyze the attached image and produce a NEW layout spec for it, following the exact same JSON shape. Pick colors that complement THIS photo's palette (not necessarily cream/charcoal). Respond with ONLY the JSON object — no markdown fences, no commentary.`;

  if (zodError) {
    prompt += `

Your previous response FAILED schema validation with these errors:
${zodError}

Fix every listed problem and respond again with ONLY the corrected JSON object.`;
  }

  return prompt;
}
