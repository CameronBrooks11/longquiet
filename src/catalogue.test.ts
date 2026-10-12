import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeProcessing, findSoundscape, soundscapes } from "./catalogue";
import { defaults } from "./preferences";

const audioDir = new URL("../public/audio/", import.meta.url);

// Licences whose terms allow self-hosting and streaming the recording here.
// Spelled out, not imported, so editing the catalogue cannot widen it.
const allowed = [
  "https://creativecommons.org/publicdomain/zero/1.0/",
  "https://creativecommons.org/licenses/by/4.0/",
];

describe("catalogue", () => {
  it("has unique ids and files", () => {
    expect(new Set(soundscapes.map((s) => s.id)).size).toBe(soundscapes.length);
    expect(new Set(soundscapes.map((s) => s.file)).size).toBe(
      soundscapes.length,
    );
  });

  it.each(soundscapes)("$id ships its audio file", (s) => {
    expect(existsSync(new URL(s.file, audioDir))).toBe(true);
  });

  it.each(soundscapes)("$id carries full attribution", (s) => {
    expect(s.title).not.toBe("");
    expect(s.author).not.toBe("");
    expect(s.modifications).not.toBe("");
    expect(s.sourceUrl).toMatch(/^https:\/\//);
    expect(s.authorUrl).toMatch(/^https:\/\//);
    expect(allowed).toContain(s.licence.url);
  });

  it.each(soundscapes)("$id pins its original and a sane recipe", (s) => {
    expect(s.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.source.file).toMatch(/\.(wav|flac|aiff?)$/);
    expect(s.recipe.crossfade).toBeGreaterThanOrEqual(0);
    if (s.recipe.excerpt !== null) {
      expect(s.recipe.excerpt).toBeGreaterThan(2 * s.recipe.crossfade);
    }
  });

  it("is listed in the README by source URL", () => {
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    for (const s of soundscapes) expect(readme).toContain(s.sourceUrl);
  });

  it("resolves the default and falls back for unknown ids", () => {
    expect(findSoundscape(defaults.soundscape).id).toBe(defaults.soundscape);
    expect(findSoundscape("no-such-sound")).toBe(soundscapes[0]);
    expect(findSoundscape(null)).toBe(soundscapes[0]);
  });
});

describe("describeProcessing", () => {
  it("names only the steps the recipe takes", () => {
    expect(
      describeProcessing("24-bit FLAC", { excerpt: null, crossfade: 0 }, -26),
    ).toBe(
      "From the original 24-bit FLAC; levelled to −26 LUFS and encoded as MP3",
    );
    expect(
      describeProcessing("24-bit WAV", { excerpt: 620, crossfade: 8 }, -26),
    ).toBe(
      "From the original 24-bit WAV; first 10:20 only; last 8 s crossfaded " +
        "into the first 8 s to smooth the loop point; levelled to −26 LUFS " +
        "and encoded as MP3",
    );
  });
});
