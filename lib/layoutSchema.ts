import { z } from "zod";

/**
 * Shared layout spec for the image -> word-art engine.
 *
 * This file is the single source of truth for the layout shape. Both the
 * API route (`app/api/generate/route.ts`) and the frontend renderer import the
 * inferred TypeScript types from here, so the Zod schemas and the types stay in
 * lockstep. Do not rename the exports without coordinating with the frontend.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A hex color like `#efeae2` or the short form `#eee`. */
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color like #efeae2");

/** A single ALL-CAPS word, 1-20 chars, letters A-Z only (no spaces/plurals-as-phrases). */
export const wordSchema = z
  .string()
  .regex(/^[A-Z]{1,20}$/, "must be a single ALL-CAPS word (A-Z, 1-20 chars)");

/**
 * Curated allow-list of bold slab-serif fonts. All-caps, letterpress feel.
 * Keep this list short and stable — the frontend loads matching web fonts.
 */
export const fontFamilySchema = z.enum(["Roboto Slab", "Zilla Slab", "Bitter"]);

// ---------------------------------------------------------------------------
// Field — a background band that varies along one axis
// ---------------------------------------------------------------------------

/** A single control point on an opacity curve: [position 0-1, opacity 0-1]. */
export const opacityPointSchema = z.tuple([
  z.number().min(0).max(1), // position along axis
  z.number().min(0).max(1), // opacity
]);

export const fieldSchema = z.object({
  word: wordSchema,
  axis: z.enum(["vertical", "horizontal"]),
  opacity_curve: z
    .array(opacityPointSchema)
    .min(2, "opacity_curve needs at least 2 control points")
    .refine(
      (points) => points.every((p, i) => i === 0 || p[0] > points[i - 1][0]),
      { message: "opacity_curve positions must be strictly increasing" },
    ),
});

// ---------------------------------------------------------------------------
// Subject — a discrete foreground silhouette
// ---------------------------------------------------------------------------

/** Normalized bounding box (0-1 relative to the canvas). */
export const bboxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

/**
 * A local silhouette grid, scoped to the subject's own bbox (NOT the whole
 * canvas). Each string is a row of digit characters `0`-`9` (0=empty,
 * 9=max density). All rows must be the same length.
 */
export const densityGridSchema = z
  .array(z.string().regex(/^[0-9]+$/, "density_grid rows must be digits 0-9 only"))
  .min(1, "density_grid needs at least 1 row")
  .refine(
    (rows) => rows.every((r) => r.length === rows[0].length),
    { message: "all density_grid rows must have the same length" },
  );

export const subjectSchema = z
  .object({
    word: wordSchema,
    bbox: bboxSchema,
    density_grid: densityGridSchema,
    z: z.number(),
    opacity: z.number().min(0).max(1),
  })
  .refine((s) => s.bbox.x + s.bbox.w <= 1.05, {
    message: "bbox x + w must be <= 1.05 (subject overflows canvas)",
    path: ["bbox"],
  })
  .refine((s) => s.bbox.y + s.bbox.h <= 1.05, {
    message: "bbox y + h must be <= 1.05 (subject overflows canvas)",
    path: ["bbox"],
  });

// ---------------------------------------------------------------------------
// LabelGrid — coarse semantic segmentation for "mosaic" mode
// ---------------------------------------------------------------------------

/**
 * A coarse per-cell segmentation of the WHOLE photo, used by the mosaic
 * renderer: each cell's letter is drawn in the true image color sampled under
 * it, and the character comes from the word of the element the cell belongs to.
 *
 * `words` lists the element names in index order; each row character is either
 * a digit (index into `words`) or `.` for cells that belong to no element
 * (rendered as bare background). Unlike fields/subjects, this grid is meant to
 * be faithful 1:1 segmentation — artistic fading is poster mode's job.
 */
export const labelGridSchema = z
  .object({
    words: z.array(wordSchema).min(1).max(10),
    rows: z
      .array(z.string().regex(/^[0-9.]+$/, "label_grid rows must be digits 0-9 or '.'"))
      .min(8, "label_grid needs at least 8 rows")
      .max(48, "label_grid may have at most 48 rows"),
  })
  .refine((g) => g.rows.every((r) => r.length === g.rows[0].length), {
    message: "all label_grid rows must have the same length",
    path: ["rows"],
  })
  .refine((g) => g.rows[0].length >= 16 && g.rows[0].length <= 64, {
    message: "label_grid rows must be 16-64 characters wide",
    path: ["rows"],
  })
  .refine(
    (g) =>
      g.rows.every((r) =>
        [...r].every((ch) => ch === "." || Number(ch) < g.words.length),
      ),
    { message: "every digit in label_grid rows must index into words", path: ["rows"] },
  );

// ---------------------------------------------------------------------------
// LayoutSpec — the full document
// ---------------------------------------------------------------------------

export const layoutSpecSchema = z
  .object({
    background_color: hexColorSchema,
    text_color: hexColorSchema,
    font_family: fontFamilySchema,
    fields: z.array(fieldSchema),
    subjects: z.array(subjectSchema),
    label_grid: labelGridSchema.optional(),
  })
  .refine((spec) => spec.fields.length + spec.subjects.length >= 1, {
    message: "layout must contain at least 1 element (field or subject)",
  })
  .refine((spec) => spec.fields.length + spec.subjects.length <= 5, {
    message: "layout may contain at most 5 elements total (fields + subjects)",
  });

// ---------------------------------------------------------------------------
// Inferred TypeScript types (import these on both server and client)
// ---------------------------------------------------------------------------

export type HexColor = z.infer<typeof hexColorSchema>;
export type FontFamily = z.infer<typeof fontFamilySchema>;
export type OpacityPoint = z.infer<typeof opacityPointSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type Bbox = z.infer<typeof bboxSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type LabelGrid = z.infer<typeof labelGridSchema>;
export type LayoutSpec = z.infer<typeof layoutSpecSchema>;
