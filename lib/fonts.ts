import { Roboto_Slab, Zilla_Slab, Bitter } from "next/font/google";
import type { FontFamily } from "@/lib/layoutSchema";

/**
 * Curated bold slab-serif web fonts, matching the `fontFamilySchema` allow-list
 * in `lib/layoutSchema.ts`. Each is loaded via `next/font/google` and exposes a
 * CSS variable that we attach to a parent DOM element; SVG `<text>` then
 * inherits the correct `font-family` through the cascade.
 */

// Roboto Slab and Bitter ship as variable fonts (weight axis), so we request a
// bold-capable range rather than a single static weight.
export const robotoSlab = Roboto_Slab({
  subsets: ["latin"],
  weight: ["700", "900"],
  variable: "--font-roboto-slab",
  display: "swap",
});

export const zillaSlab = Zilla_Slab({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-zilla-slab",
  display: "swap",
});

export const bitter = Bitter({
  subsets: ["latin"],
  weight: ["700", "900"],
  variable: "--font-bitter",
  display: "swap",
});

/** All font CSS-variable class names, to attach to a wrapping element. */
export const fontVariables = [
  robotoSlab.variable,
  zillaSlab.variable,
  bitter.variable,
].join(" ");

/**
 * Map a schema `font_family` value to the CSS `font-family` string that
 * references the loaded next/font CSS variable (with a slab-serif fallback).
 */
export function fontFamilyToCss(family: FontFamily): string {
  switch (family) {
    case "Roboto Slab":
      return "var(--font-roboto-slab), Georgia, 'Times New Roman', serif";
    case "Zilla Slab":
      return "var(--font-zilla-slab), Georgia, 'Times New Roman', serif";
    case "Bitter":
      return "var(--font-bitter), Georgia, 'Times New Roman', serif";
    default:
      return "Georgia, 'Times New Roman', serif";
  }
}

/** The list of allowed font-family values, for building UI selectors. */
export const FONT_FAMILIES: FontFamily[] = ["Roboto Slab", "Zilla Slab", "Bitter"];
