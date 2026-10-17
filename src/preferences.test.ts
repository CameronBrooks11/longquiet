import { describe, expect, it } from "vitest";
import { defaults, loadPreferences, savePreferences } from "./preferences";

function memoryStore(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set("longquiet:prefs", initial);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("preferences", () => {
  it("round-trips", () => {
    const store = memoryStore();
    savePreferences(store, {
      soundscape: "night",
      volume: 0.25,
      pieces: { nocturnes: 3 },
    });
    expect(loadPreferences(store)).toEqual({
      soundscape: "night",
      volume: 0.25,
      pieces: { nocturnes: 3 },
    });
  });

  it("keeps only whole, non-negative piece numbers", () => {
    const store = memoryStore(
      JSON.stringify({
        pieces: { a: 2, b: -1, c: 1.5, d: "4", e: null, f: 0 },
      }),
    );
    expect(loadPreferences(store).pieces).toEqual({ a: 2, f: 0 });
    const list = memoryStore(JSON.stringify({ pieces: [1, 2] }));
    expect(loadPreferences(list).pieces).toEqual({});
  });

  it.each([
    ["nothing stored", undefined],
    ["corrupt JSON", "{not json"],
    ["null", "null"],
    ["an array", "[]"],
  ])("falls back to defaults given %s", (_, raw) => {
    expect(loadPreferences(memoryStore(raw))).toEqual(defaults);
  });

  it("rejects out-of-range or mistyped fields individually", () => {
    const store = memoryStore(JSON.stringify({ soundscape: 3, volume: 1.5 }));
    expect(loadPreferences(store)).toEqual(defaults);
    const half = memoryStore(
      JSON.stringify({ soundscape: "forest", volume: -1 }),
    );
    expect(loadPreferences(half)).toEqual({
      soundscape: "forest",
      volume: defaults.volume,
      pieces: {},
    });
  });

  it("survives a store that refuses writes", () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    expect(() => savePreferences(store, defaults)).not.toThrow();
  });
});
