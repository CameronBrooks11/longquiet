import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSoundscape, soundscapes } from "./catalogue";
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

  it("resolves the default and falls back for unknown ids", () => {
    expect(findSoundscape(defaults.soundscape).id).toBe(defaults.soundscape);
    expect(findSoundscape("no-such-sound")).toBe(soundscapes[0]);
    expect(findSoundscape(null)).toBe(soundscapes[0]);
  });
});
