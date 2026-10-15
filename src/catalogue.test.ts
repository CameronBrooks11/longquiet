import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  describeProcessing,
  findSoundscape,
  populatedSections,
  sections,
  soundsIn,
  soundscapes,
  tracks,
} from "./catalogue";
import { defaults } from "./preferences";

const manifest = JSON.parse(
  readFileSync(new URL("../sounds/sounds.json", import.meta.url), "utf8"),
) as { audio: { release: string; baseUrl: string } };

// Licences whose terms allow self-hosting and streaming the recording here:
// public domain, CC0, CC BY and CC BY-SA. Spelled out, not imported, so
// editing the catalogue cannot widen it.
const allowed = [
  "https://creativecommons.org/publicdomain/zero/1.0/",
  "https://creativecommons.org/publicdomain/mark/1.0/",
  "https://creativecommons.org/licenses/by/3.0/",
  "https://creativecommons.org/licenses/by/4.0/",
  "https://creativecommons.org/licenses/by-sa/3.0/",
  "https://creativecommons.org/licenses/by-sa/4.0/",
];

describe("catalogue", () => {
  it("has unique ids and files", () => {
    expect(new Set(soundscapes.map((s) => s.id)).size).toBe(soundscapes.length);
    expect(new Set(tracks.map((t) => t.file)).size).toBe(tracks.length);
  });

  it.each(soundscapes)("$id has something to play", (s) => {
    expect(s.tracks.length).toBeGreaterThan(0);
    // A looped recording is exactly one track; a playlist plays through.
    if (s.loops) expect(s.tracks).toHaveLength(1);
  });

  // The audio itself is a release asset (just fetch-audio), not in git.
  it.each(tracks)("$id records its built file", (s) => {
    expect(s.build.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.build.bytes).toBeGreaterThan(0);
  });

  it("names an audio release to fetch from", () => {
    // CalVer, with .N for a second release on the same day.
    expect(manifest.audio.release).toMatch(
      /^audio-\d{4}\.\d{2}\.\d{2}(\.\d+)?$/,
    );
    expect(manifest.audio.baseUrl).toMatch(
      /^https:\/\/github\.com\/.+\/releases\/download$/,
    );
  });

  it.each(tracks)("$id carries full attribution", (s) => {
    expect(s.title).not.toBe("");
    expect(s.author).not.toBe("");
    expect(s.modifications).not.toBe("");
    expect(s.sourceUrl).toMatch(/^https:\/\//);
    expect(s.authorUrl).toMatch(/^https:\/\//);
    expect(allowed).toContain(s.licence.url);
  });

  it.each(tracks)("$id pins its original and a sane recipe", (s) => {
    expect(s.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.source.file).toMatch(/\.(wav|flac|aiff?|ogg|mp3)$/);
    expect(s.recipe.crossfade).toBeGreaterThanOrEqual(0);
    if (s.recipe.excerpt !== null) {
      expect(s.recipe.excerpt).toBeGreaterThan(2 * s.recipe.crossfade);
    }
  });

  // A loop is cut and crossfaded, so it starts from a lossless original. A
  // playlist piece may come from a lossy one when no lossless copy exists;
  // the credits name the format either way.
  // An element looping itself goes briefly silent at each restart on iOS
  // Safari (#34), so every loop is played as overlapping copies instead.
  it.each(soundscapes)("$id overlaps only if it loops", (s) => {
    if (s.loops) {
      expect(s.overlap).toBeGreaterThan(0);
      expect(s.overlap).toBe(s.tracks[0].recipe.crossfade);
    } else {
      expect(s.overlap).toBe(0);
    }
  });

  it.each(soundscapes.filter((s) => s.loops))(
    "$id loops from a lossless original",
    (s) => {
      for (const t of s.tracks) {
        expect(t.source.file).toMatch(/\.(wav|flac|aiff?)$/);
      }
    },
  );

  it("is listed in the README by source URL", () => {
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    for (const s of tracks) expect(readme).toContain(s.sourceUrl);
  });

  it("resolves the default and falls back for unknown ids", () => {
    expect(findSoundscape(defaults.soundscape).id).toBe(defaults.soundscape);
    expect(findSoundscape("no-such-sound")).toBe(soundscapes[0]);
    expect(findSoundscape(null)).toBe(soundscapes[0]);
  });
});

describe("sections", () => {
  it("have unique ids and a known kind", () => {
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
    for (const s of sections) {
      expect(["loop", "tones", "playlist"]).toContain(s.kind);
    }
  });

  it.each(soundscapes)("$id belongs to a listed section", (s) => {
    expect(sections.map((x) => x.id)).toContain(s.section);
  });

  it("count as populated only with something to play, in listed order", () => {
    const expected = sections.filter((s) => soundsIn(s.id).length > 0);
    expect(populatedSections).toEqual(expected);
    expect(populatedSections.length).toBeGreaterThan(0);
  });
});

describe("describeProcessing", () => {
  it("says when rare peaks were limited", () => {
    expect(
      describeProcessing(
        "16-bit FLAC",
        { excerpt: 620, crossfade: 8, limit: -2.5 },
        -26,
      ),
    ).toBe(
      "From the original 16-bit FLAC; first 10:20 only; faded in over the " +
        "first 8 s and out over the last 8 s, for the player to overlap into " +
        "a crossfade at the loop point; levelled to −26 LUFS; " +
        "rare peaks limited to −2.5 dBFS; encoded as MP3",
    );
  });

  it("names only the steps the recipe takes", () => {
    expect(
      describeProcessing("24-bit FLAC", { excerpt: null, crossfade: 0 }, -26),
    ).toBe(
      "From the original 24-bit FLAC; levelled to −26 LUFS and encoded as MP3",
    );
    expect(
      describeProcessing("24-bit WAV", { excerpt: 620, crossfade: 8 }, -26),
    ).toBe(
      "From the original 24-bit WAV; first 10:20 only; faded in over the " +
        "first 8 s and out over the last 8 s, for the player to overlap into " +
        "a crossfade at the loop point; levelled to −26 LUFS " +
        "and encoded as MP3",
    );
  });
});
