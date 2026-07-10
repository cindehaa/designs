"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { LayoutSpec, FontFamily, OpacityPoint } from "@/lib/layoutSchema";
import { FONT_FAMILIES, fontVariables } from "@/lib/fonts";
import WordArtRenderer from "@/components/WordArtRenderer";
import MosaicRenderer from "@/components/MosaicRenderer";
import UploadPanel from "@/components/UploadPanel";
import ExportButtons from "@/components/ExportButtons";

// --- helpers ---------------------------------------------------------------

interface StoredImage {
  base64: string;
  mediaType: string;
  previewUrl: string;
  aspect: number; // width / height
}

/** Read a File into raw base64 (no data: prefix), media type, and dimensions. */
function readImage(file: File): Promise<StoredImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      const previewUrl = result;
      const img = new Image();
      img.onload = () => {
        resolve({
          base64,
          mediaType: file.type || "image/png",
          previewUrl,
          aspect: img.naturalWidth && img.naturalHeight
            ? img.naturalWidth / img.naturalHeight
            : 4 / 3,
        });
      };
      img.onerror = () => reject(new Error("Could not read image dimensions"));
      img.src = result;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// --- adjustable overrides layered on top of the pristine API layout --------

interface Adjustments {
  background_color: string;
  text_color: string;
  font_family: FontFamily;
  fieldWords: string[];
  fieldMul: number[];
  subjectWords: string[];
  subjectMul: number[];
}

function adjustmentsFromLayout(layout: LayoutSpec): Adjustments {
  return {
    background_color: layout.background_color,
    text_color: layout.text_color,
    font_family: layout.font_family,
    fieldWords: layout.fields.map((f) => f.word),
    fieldMul: layout.fields.map(() => 1),
    subjectWords: layout.subjects.map((s) => s.word),
    subjectMul: layout.subjects.map(() => 1),
  };
}

// --- page ------------------------------------------------------------------

type RenderMode = "poster" | "mosaic";

export default function Home() {
  const [image, setImage] = useState<StoredImage | null>(null);
  const [baseLayout, setBaseLayout] = useState<LayoutSpec | null>(null);
  const [adj, setAdj] = useState<Adjustments | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RenderMode>("poster");
  const [letterSize, setLetterSize] = useState(13);
  const svgRef = useRef<SVGSVGElement>(null);

  const CANVAS_W = 900;
  const aspect = image?.aspect ?? 4 / 3;
  const canvasH = Math.round(CANVAS_W / aspect);

  // The working layout the renderer draws from: base layout + live overrides.
  const renderLayout = useMemo<LayoutSpec | null>(() => {
    if (!baseLayout || !adj) return null;
    // Word overrides apply to the mosaic too: label_grid words that match an
    // element's original word follow that element's override.
    const wordOverride = new Map<string, string>();
    baseLayout.fields.forEach((f, i) => {
      if (adj.fieldWords[i]) wordOverride.set(f.word, adj.fieldWords[i]);
    });
    baseLayout.subjects.forEach((s, i) => {
      if (adj.subjectWords[i]) wordOverride.set(s.word, adj.subjectWords[i]);
    });
    const label_grid = baseLayout.label_grid
      ? {
          ...baseLayout.label_grid,
          words: baseLayout.label_grid.words.map(
            (w) => wordOverride.get(w) || w,
          ),
        }
      : undefined;
    return {
      ...baseLayout,
      label_grid,
      background_color: adj.background_color,
      text_color: adj.text_color,
      font_family: adj.font_family,
      fields: baseLayout.fields.map((f, i) => ({
        ...f,
        word: adj.fieldWords[i] ?? f.word,
        opacity_curve: f.opacity_curve.map(
          ([p, o]) => [p, clamp01(o * (adj.fieldMul[i] ?? 1))] as OpacityPoint,
        ),
      })),
      subjects: baseLayout.subjects.map((s, i) => ({
        ...s,
        word: adj.subjectWords[i] ?? s.word,
        opacity: clamp01(s.opacity * (adj.subjectMul[i] ?? 1)),
      })),
    };
  }, [baseLayout, adj]);

  const runGenerate = useCallback(async (img: StoredImage) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: img.base64, mediaType: img.mediaType }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (data && (data.error || data.message)) ||
            `Request failed (${res.status})`,
        );
      }
      // The API may return the layout directly or under a `layout` key.
      const layout: LayoutSpec = data?.layout ?? data;
      if (!layout || !Array.isArray(layout.fields)) {
        throw new Error("Unexpected response shape from /api/generate");
      }
      setBaseLayout(layout);
      setAdj(adjustmentsFromLayout(layout));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleGenerate = useCallback(
    async (file: File) => {
      try {
        const img = await readImage(file);
        setImage(img);
        await runGenerate(img);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read image");
      }
    },
    [runGenerate],
  );

  const handleRegenerate = useCallback(() => {
    if (image) void runGenerate(image);
  }, [image, runGenerate]);

  // small helpers to update a single adjustment field immutably
  const patch = (p: Partial<Adjustments>) =>
    setAdj((prev) => (prev ? { ...prev, ...p } : prev));
  const setAt = <T,>(arr: T[], i: number, v: T): T[] =>
    arr.map((x, j) => (j === i ? v : x));

  return (
    <main className={`min-h-screen bg-neutral-100 text-neutral-900 ${fontVariables}`}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Word Art Engine</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Turn a photo into typographic word art built from the names of its parts.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          {/* Left column: upload + controls */}
          <aside className="flex flex-col gap-6">
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Source
              </h2>
              <UploadPanel onGenerate={handleGenerate} disabled={loading} />
              {baseLayout && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={loading}
                  className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 disabled:opacity-50"
                >
                  {loading ? "Regenerating…" : "Regenerate"}
                </button>
              )}
            </section>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {renderLayout && (
              <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  Mode
                </h2>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1">
                  {(["poster", "mosaic"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                        mode === m
                          ? "bg-white text-neutral-900 shadow-sm"
                          : "text-neutral-500 hover:text-neutral-800"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                {mode === "mosaic" && (
                  <div className="mt-4 flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-neutral-500">
                      Letter size
                    </span>
                    <input
                      type="range"
                      min={7}
                      max={28}
                      step={1}
                      value={letterSize}
                      onChange={(e) => setLetterSize(Number(e.target.value))}
                      className="w-full"
                    />
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-neutral-500">
                      {letterSize}
                    </span>
                  </div>
                )}
                {mode === "mosaic" && !renderLayout.label_grid && (
                  <p className="mt-3 text-xs text-amber-600">
                    This layout has no label grid (generated before mosaic mode
                    existed) — hit Regenerate to enable it.
                  </p>
                )}
              </section>
            )}

            {renderLayout && adj && (
              <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  Style
                </h2>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm text-neutral-700">Background</label>
                    <input
                      type="color"
                      value={adj.background_color}
                      onChange={(e) => patch({ background_color: e.target.value })}
                      className="h-8 w-14 cursor-pointer rounded border border-neutral-300"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm text-neutral-700">Text</label>
                    <input
                      type="color"
                      value={adj.text_color}
                      onChange={(e) => patch({ text_color: e.target.value })}
                      className="h-8 w-14 cursor-pointer rounded border border-neutral-300"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm text-neutral-700">Font</label>
                    <select
                      value={adj.font_family}
                      onChange={(e) =>
                        patch({ font_family: e.target.value as FontFamily })
                      }
                      className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                    >
                      {FONT_FAMILIES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {baseLayout && baseLayout.fields.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Fields
                    </h3>
                    <div className="flex flex-col gap-4">
                      {baseLayout.fields.map((f, i) => (
                        <ElementControl
                          key={`field-${i}`}
                          word={adj.fieldWords[i] ?? f.word}
                          mul={adj.fieldMul[i] ?? 1}
                          onWord={(v) => patch({ fieldWords: setAt(adj.fieldWords, i, v) })}
                          onMul={(v) => patch({ fieldMul: setAt(adj.fieldMul, i, v) })}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {baseLayout && baseLayout.subjects.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Subjects
                    </h3>
                    <div className="flex flex-col gap-4">
                      {baseLayout.subjects.map((s, i) => (
                        <ElementControl
                          key={`subject-${i}`}
                          word={adj.subjectWords[i] ?? s.word}
                          mul={adj.subjectMul[i] ?? 1}
                          onWord={(v) =>
                            patch({ subjectWords: setAt(adj.subjectWords, i, v) })
                          }
                          onMul={(v) => patch({ subjectMul: setAt(adj.subjectMul, i, v) })}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {renderLayout && (
              <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                  Export
                </h2>
                <ExportButtons
                  svgRef={svgRef}
                  layout={renderLayout}
                  width={CANVAS_W}
                  height={canvasH}
                />
              </section>
            )}
          </aside>

          {/* Right column: side-by-side original / word art */}
          <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Panel title="Original">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image.previewUrl}
                  alt="Original"
                  className="h-full w-full object-contain"
                  style={{ aspectRatio: String(aspect) }}
                />
              ) : (
                <Placeholder text="Upload an image to begin" />
              )}
            </Panel>

            <Panel title="Word art">
              {loading ? (
                <Placeholder text="Generating…" />
              ) : renderLayout ? (
                <div className="w-full" style={{ aspectRatio: String(aspect) }}>
                  {mode === "mosaic" && image ? (
                    <MosaicRenderer
                      ref={svgRef}
                      layout={renderLayout}
                      imageSrc={image.previewUrl}
                      width={CANVAS_W}
                      height={canvasH}
                      letterSize={letterSize}
                    />
                  ) : (
                    <WordArtRenderer
                      ref={svgRef}
                      layout={renderLayout}
                      width={CANVAS_W}
                      height={canvasH}
                    />
                  )}
                </div>
              ) : (
                <Placeholder text="Your word art will appear here" />
              )}
            </Panel>
          </section>
        </div>
      </div>
    </main>
  );
}

// --- small presentational helpers ------------------------------------------

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {title}
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        {children}
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center p-8 text-center text-sm text-neutral-400">
      {text}
    </div>
  );
}

function ElementControl({
  word,
  mul,
  onWord,
  onMul,
}: {
  word: string;
  mul: number;
  onWord: (v: string) => void;
  onMul: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="text"
        value={word}
        onChange={(e) => onWord(e.target.value.toUpperCase())}
        className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm font-semibold uppercase tracking-wide"
      />
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs text-neutral-500">Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={mul}
          onChange={(e) => onMul(Number(e.target.value))}
          className="w-full"
        />
        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-neutral-500">
          {mul.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
