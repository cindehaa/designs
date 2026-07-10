import type { LayoutSpec } from "@/lib/layoutSchema";

/**
 * A procedurally-generated, always-valid layout used when the model fails to
 * produce a schema-valid spec even after a self-correction retry. It is
 * deliberately generic: one centered subject with an elliptical density
 * falloff, plus one vertical field with a simple linear opacity ramp. The
 * point is graceful degradation — the request still returns something a
 * renderer can draw, rather than erroring out.
 */
export function buildFallbackLayout(): LayoutSpec {
  const rows = 20;
  const cols = 20;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const rx = cols / 2;
  const ry = rows / 2;

  const density_grid: string[] = [];
  for (let r = 0; r < rows; r++) {
    let row = "";
    for (let c = 0; c < cols; c++) {
      // Normalized elliptical distance from center: 0 at center, 1 at edge.
      const dx = (c - cx) / rx;
      const dy = (r - cy) / ry;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Inside the ellipse -> higher density toward the center; outside -> 0.
      const value = dist >= 1 ? 0 : Math.round((1 - dist) * 9);
      row += String(Math.max(0, Math.min(9, value)));
    }
    density_grid.push(row);
  }

  return {
    background_color: "#efeae2",
    text_color: "#262019",
    font_family: "Roboto Slab",
    fields: [
      {
        word: "FIELD",
        axis: "vertical",
        opacity_curve: [
          [0.0, 0.1],
          [1.0, 1.0],
        ],
      },
    ],
    subjects: [
      {
        word: "SUBJECT",
        bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
        density_grid,
        z: 10,
        opacity: 1.0,
      },
    ],
  };
}
