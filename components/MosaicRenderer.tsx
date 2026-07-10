"use client";

import React, { forwardRef, useEffect, useMemo, useState } from "react";
import type { LayoutSpec } from "@/lib/layoutSchema";
import { fontFamilyToCss } from "@/lib/fonts";

export interface MosaicRendererProps {
  layout: LayoutSpec;
  /** Object URL / data URL of the uploaded photo to sample colors from. */
  imageSrc: string;
  width: number;
  height: number;
  /** Letter cell size in px — the "letter size" toggle. Smaller = more detail. */
  letterSize: number;
}

/** Width of a letter cell relative to `letterSize` (slab caps are ~0.62em wide). */
const CELL_ASPECT = 0.72;
/** Hard cap on total cells so tiny letter sizes can't hang the browser. */
const MAX_CELLS = 14000;

interface SampledGrid {
  cols: number;
  rows: number;
  /** RGB per cell, row-major, 3 bytes per cell. */
  rgb: Uint8ClampedArray;
}

/**
 * Downsample the photo to exactly cols x rows using a canvas: drawing the
 * image scaled down makes each canvas pixel the average of the pixels under
 * it, which is precisely the per-cell color an ASCII-style engine wants.
 */
function sampleImage(img: HTMLImageElement, cols: number, rows: number): SampledGrid {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { cols, rows, rgb: new Uint8ClampedArray(cols * rows * 3) };
  ctx.drawImage(img, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const rgb = new Uint8ClampedArray(cols * rows * 3);
  for (let i = 0; i < cols * rows; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  return { cols, rows, rgb };
}

/**
 * ASCII-engine-style renderer: the photo is downsampled to a letter grid, each
 * cell takes the TRUE color of the pixels under it, and the character drawn in
 * a cell is the next letter of the word of whichever element the cell belongs
 * to (via the coarse `label_grid` from the layout spec, upsampled
 * nearest-neighbor). Cells labeled `.` stay empty so the background shows.
 */
const MosaicRenderer = forwardRef<SVGSVGElement, MosaicRendererProps>(
  function MosaicRenderer({ layout, imageSrc, width, height, letterSize }, ref) {
    const [sampled, setSampled] = useState<SampledGrid | null>(null);

    // Cell geometry. Clamp the cell count so extreme letter sizes stay usable.
    const { cols, rows, cellW, cellH } = useMemo(() => {
      let cw = Math.max(4, letterSize * CELL_ASPECT);
      let ch = Math.max(6, letterSize);
      let c = Math.max(1, Math.floor(width / cw));
      let r = Math.max(1, Math.floor(height / ch));
      if (c * r > MAX_CELLS) {
        const scale = Math.sqrt((c * r) / MAX_CELLS);
        c = Math.max(1, Math.floor(c / scale));
        r = Math.max(1, Math.floor(r / scale));
      }
      return { cols: c, rows: r, cellW: width / c, cellH: height / r };
    }, [width, height, letterSize]);

    useEffect(() => {
      let cancelled = false;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (!cancelled) setSampled(sampleImage(img, cols, rows));
      };
      img.src = imageSrc;
      return () => {
        cancelled = true;
      };
    }, [imageSrc, cols, rows]);

    const labelGrid = layout.label_grid;

    const rowElements = useMemo(() => {
      if (!sampled || !labelGrid) return null;
      const gridRows = labelGrid.rows.length;
      const gridCols = labelGrid.rows[0].length;
      const out: React.ReactElement[] = [];

      for (let r = 0; r < rows; r++) {
        // Per-word running letter index so words read continuously along a row
        // within each region ("BOATBOATBO..."), restarting each row.
        const letterIndex: number[] = new Array(labelGrid.words.length).fill(0);
        const tspans: React.ReactElement[] = [];
        const gy = Math.min(gridRows - 1, Math.floor((r / rows) * gridRows));

        for (let c = 0; c < cols; c++) {
          const gx = Math.min(gridCols - 1, Math.floor((c / cols) * gridCols));
          const ch = labelGrid.rows[gy][gx];
          if (ch === ".") continue;
          const wordIdx = ch.charCodeAt(0) - 48; // '0' -> 0
          const word = labelGrid.words[wordIdx];
          if (!word) continue;
          const letter = word[letterIndex[wordIdx] % word.length];
          letterIndex[wordIdx]++;
          const i = r * cols + c;
          const fill = `rgb(${sampled.rgb[i * 3]},${sampled.rgb[i * 3 + 1]},${sampled.rgb[i * 3 + 2]})`;
          tspans.push(
            <tspan key={c} x={c * cellW + cellW / 2} fill={fill}>
              {letter}
            </tspan>,
          );
        }
        if (tspans.length > 0) {
          out.push(
            <text
              key={r}
              y={r * cellH + cellH * 0.78}
              fontSize={letterSize}
              textAnchor="middle"
            >
              {tspans}
            </text>,
          );
        }
      }
      return out;
    }, [sampled, labelGrid, rows, cols, cellW, cellH, letterSize]);

    return (
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          fontFamily: fontFamilyToCss(layout.font_family),
          fontWeight: 700,
          display: "block",
        }}
        aria-label="Generated word-art mosaic"
      >
        <rect width={width} height={height} fill={layout.background_color} />
        {labelGrid ? (
          rowElements
        ) : (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fill={layout.text_color}
            fontSize={16}
          >
            This layout has no label grid — regenerate to enable mosaic mode.
          </text>
        )}
      </svg>
    );
  },
);

export default MosaicRenderer;
