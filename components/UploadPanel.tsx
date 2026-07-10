"use client";

import React, { useCallback, useRef, useState } from "react";

export interface UploadPanelProps {
  /** Called with the chosen image file when the user clicks Generate. */
  onGenerate: (file: File) => void;
  /** Disable the Generate button (e.g. while a request is in flight). */
  disabled?: boolean;
}

/**
 * Handles image selection (click or drag-drop), shows a preview thumbnail of
 * the source photo, and a Generate button that hands the file to the parent.
 */
export default function UploadPanel({ onGenerate, disabled }: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback((next: File | null) => {
    if (!next || !next.type.startsWith("image/")) return;
    setFile(next);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(next);
    });
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0] ?? null);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          "relative flex aspect-[4/3] w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors",
          dragging
            ? "border-neutral-800 bg-neutral-100"
            : "border-neutral-300 bg-neutral-50 hover:border-neutral-400",
        ].join(" ")}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Source preview"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="px-6 text-center text-sm text-neutral-500">
            <p className="font-medium text-neutral-700">Drop an image here</p>
            <p className="mt-1">or click to browse</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onInputChange}
        />
      </div>

      <button
        type="button"
        disabled={!file || disabled}
        onClick={() => file && onGenerate(file)}
        className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {file ? "Generate word art" : "Choose an image first"}
      </button>
    </div>
  );
}
