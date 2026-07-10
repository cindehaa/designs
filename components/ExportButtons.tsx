"use client";

import React, { useState } from "react";
import type { LayoutSpec } from "@/lib/layoutSchema";

export interface ExportButtonsProps {
  /** Ref to the live rendered <svg> element (from WordArtRenderer). */
  svgRef: React.RefObject<SVGSVGElement>;
  /** The current layout spec, for the JSON export. */
  layout: LayoutSpec;
  /** Pixel dimensions used when rasterizing to PNG. */
  width: number;
  height: number;
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Serialize the live SVG node to a standalone XML string. */
function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Download buttons for the rendered word art: SVG (serialized DOM), PNG
 * (rasterized via an offscreen canvas), and the raw layout JSON.
 */
export default function ExportButtons({ svgRef, layout, width, height }: ExportButtonsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const source = serializeSvg(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "word-art.svg");
    URL.revokeObjectURL(url);
  };

  const downloadPng = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    setBusy(true);
    setError(null);
    try {
      const source = serializeSvg(svg);
      const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      const scale = 2; // export at 2x for a crisp raster
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = width * scale;
          canvas.height = height * scale;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Could not get 2D canvas context"));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => reject(new Error("Failed to rasterize SVG"));
        img.src = svgUrl;
      });
      triggerDownload(dataUrl, "word-art.png");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PNG export failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "layout.json");
    URL.revokeObjectURL(url);
  };

  const btn =
    "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={downloadSvg}>
          Download SVG
        </button>
        <button type="button" className={btn} onClick={downloadPng} disabled={busy}>
          {busy ? "Rendering PNG…" : "Download PNG"}
        </button>
        <button type="button" className={btn} onClick={downloadJson}>
          Download JSON
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
