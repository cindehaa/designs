import React, { forwardRef, useId } from "react";
import type { LayoutSpec, Field, Subject, OpacityPoint } from "@/lib/layoutSchema";
import { fontFamilyToCss, fontVariables } from "@/lib/fonts";

export interface WordArtRendererProps {
  layout: LayoutSpec;
  width: number;
  height: number;
}

// --- tuning constants -------------------------------------------------------
/** Fraction of canvas height used per field text row (~16 rows fit). */
const FIELD_ROW_FRACTION = 0.062;
/** Approx width of one uppercase glyph in a bold slab face, in `em`. */
const GLYPH_EM = 0.62;
/** Number of text rows tiled inside a subject's bbox. */
const SUBJECT_ROWS = 12;

/**
 * Piecewise-linear interpolation of an opacity curve at `pos` (0-1 along axis).
 * Clamps to the first/last control point outside the curve's range.
 */
function interpolateOpacity(curve: OpacityPoint[], pos: number): number {
  if (curve.length === 0) return 1;
  if (pos <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (pos >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (pos <= x1) {
      const span = x1 - x0 || 1;
      const t = (pos - x0) / span;
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/** Repeat `word` enough times (space-separated) to overflow `spanPx`. */
function tiledString(word: string, tileWidthPx: number, spanPx: number): string {
  const count = Math.ceil(spanPx / Math.max(tileWidthPx, 1)) + 3;
  return Array.from({ length: count }, () => word).join(" ");
}

// ---------------------------------------------------------------------------
// Field rendering (background bands)
// ---------------------------------------------------------------------------

function FieldLayer({
  field,
  width,
  height,
  textColor,
}: {
  field: Field;
  width: number;
  height: number;
  textColor: string;
}) {
  const rowHeight = height * FIELD_ROW_FRACTION;
  const fontSize = rowHeight * 0.92;
  const tileWidth = (field.word.length + 1) * fontSize * GLYPH_EM;
  const numRows = Math.ceil(height / rowHeight) + 1;

  const rows: React.ReactNode[] = [];
  for (let r = 0; r < numRows; r++) {
    const rowCenterY = r * rowHeight + rowHeight * 0.75;
    // Stagger every other row by half a tile for an organic, non-grid look.
    const stagger = (r % 2) * (tileWidth / 2);
    const startX = -tileWidth + stagger;

    if (field.axis === "vertical") {
      // Opacity varies top->bottom; one uniform value per row.
      const pos = rowCenterY / height;
      const opacity = interpolateOpacity(field.opacity_curve, pos);
      if (opacity <= 0.001) continue;
      rows.push(
        <text
          key={r}
          x={startX}
          y={rowCenterY}
          fontSize={fontSize}
          fill={textColor}
          fillOpacity={opacity}
          xmlSpace="preserve"
        >
          {tiledString(field.word, tileWidth, width - startX)}
        </text>,
      );
    } else {
      // Horizontal axis: opacity varies left->right, so tile per-word and
      // give each tile the interpolated opacity at its own x position.
      const numTiles = Math.ceil((width - startX) / tileWidth) + 2;
      for (let t = 0; t < numTiles; t++) {
        const x = startX + t * tileWidth;
        const pos = (x + tileWidth / 2) / width;
        const opacity = interpolateOpacity(field.opacity_curve, pos);
        if (opacity <= 0.001) continue;
        rows.push(
          <text
            key={`${r}-${t}`}
            x={x}
            y={rowCenterY}
            fontSize={fontSize}
            fill={textColor}
            fillOpacity={opacity}
            xmlSpace="preserve"
          >
            {field.word}
          </text>,
        );
      }
    }
  }

  return <g>{rows}</g>;
}

// ---------------------------------------------------------------------------
// Subject rendering (foreground silhouettes carved from a density grid)
// ---------------------------------------------------------------------------

function SubjectLayer({
  subject,
  width,
  height,
  textColor,
  idPrefix,
  index,
}: {
  subject: Subject;
  width: number;
  height: number;
  textColor: string;
  idPrefix: string;
  index: number;
}) {
  const bx = subject.bbox.x * width;
  const by = subject.bbox.y * height;
  const bw = subject.bbox.w * width;
  const bh = subject.bbox.h * height;

  const rows = subject.density_grid;
  const gridRows = rows.length;
  const gridCols = rows[0]?.length ?? 0;
  const cellW = gridCols > 0 ? bw / gridCols : bw;
  const cellH = gridRows > 0 ? bh / gridRows : bh;

  const maskId = `${idPrefix}-mask-${index}`;
  const filterId = `${idPrefix}-blur-${index}`;
  const blur = Math.max(Math.min(cellW, cellH) * 0.5, 0.4);

  // Density cells -> white rects whose opacity encodes digit 0-9.
  const cells: React.ReactNode[] = [];
  for (let ry = 0; ry < gridRows; ry++) {
    const row = rows[ry];
    for (let cx = 0; cx < gridCols; cx++) {
      const digit = row.charCodeAt(cx) - 48; // '0' -> 0
      if (digit <= 0) continue;
      cells.push(
        <rect
          key={`${ry}-${cx}`}
          x={bx + cx * cellW}
          y={by + ry * cellH}
          width={cellW + 0.5}
          height={cellH + 0.5}
          fill="#ffffff"
          fillOpacity={digit / 9}
        />,
      );
    }
  }

  // Tiled word text filling the bbox; the mask carves the silhouette out of it.
  const fontSize = bh / SUBJECT_ROWS;
  const rowHeight = fontSize * 1.02;
  const tileWidth = (subject.word.length + 1) * fontSize * GLYPH_EM;
  const numRows = Math.ceil(bh / rowHeight) + 1;
  const textRows: React.ReactNode[] = [];
  for (let r = 0; r < numRows; r++) {
    const y = by + r * rowHeight + rowHeight * 0.85;
    const stagger = (r % 2) * (tileWidth / 2);
    const startX = bx - tileWidth + stagger;
    textRows.push(
      <text
        key={r}
        x={startX}
        y={y}
        fontSize={fontSize}
        fill={textColor}
        fillOpacity={subject.opacity}
        xmlSpace="preserve"
      >
        {tiledString(subject.word, tileWidth, bw + tileWidth)}
      </text>,
    );
  }

  return (
    <g>
      <defs>
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <g filter={`url(#${filterId})`}>{cells}</g>
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>{textRows}</g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Root renderer
// ---------------------------------------------------------------------------

const WordArtRenderer = forwardRef<SVGSVGElement, WordArtRendererProps>(
  function WordArtRenderer({ layout, width, height }, ref) {
    const idPrefix = useId().replace(/:/g, "");
    const sortedSubjects = [...layout.subjects]
      .map((subject, index) => ({ subject, index }))
      .sort((a, b) => a.subject.z - b.subject.z);

    return (
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        className={fontVariables}
        style={{
          fontFamily: fontFamilyToCss(layout.font_family),
          fontWeight: 800,
          textTransform: "uppercase",
          display: "block",
        }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* 1. Background */}
        <rect x={0} y={0} width={width} height={height} fill={layout.background_color} />

        {/* 2. Fields (back-to-front, before subjects) */}
        {layout.fields.map((field, i) => (
          <FieldLayer
            key={`field-${i}`}
            field={field}
            width={width}
            height={height}
            textColor={layout.text_color}
          />
        ))}

        {/* 3. Subjects (ascending z draws last / on top) */}
        {sortedSubjects.map(({ subject, index }) => (
          <SubjectLayer
            key={`subject-${index}`}
            subject={subject}
            width={width}
            height={height}
            textColor={layout.text_color}
            idPrefix={idPrefix}
            index={index}
          />
        ))}
      </svg>
    );
  },
);

export default WordArtRenderer;
