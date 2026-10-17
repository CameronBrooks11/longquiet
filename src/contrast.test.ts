import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("style.css", import.meta.url), "utf8");

// The colour tokens of the first :root block after `from`.
function tokens(from: number): Record<string, string> {
  const start = css.indexOf(":root {", from);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

const themes = {
  light: tokens(0),
  dark: tokens(css.indexOf("@media (prefers-color-scheme: dark)")),
};

// WCAG 2 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text over its background, as the page pairs them.
const textPairs = [
  ["accent-fg", "accent"], // a selected sound
  ["fg", "bg"],
  ["muted", "bg"],
] as const;

describe.each(Object.entries(themes))("%s theme", (_, t) => {
  it.each(textPairs)("--%s on --%s reaches 4.5:1", (text, back) => {
    expect(t[text]).toBeDefined();
    expect(t[back]).toBeDefined();
    expect(contrast(t[text], t[back])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("contrast", () => {
  it("matches the WCAG figures for known pairs", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
