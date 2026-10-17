export interface Preferences {
  soundscape: string;
  volume: number;
  // The piece each playlist was last on, by playlist id.
  pieces: Record<string, number>;
}

const KEY = "longquiet:prefs";

export const defaults: Readonly<Preferences> = {
  soundscape: "rain",
  volume: 0.7,
  pieces: {},
};

function fresh(): Preferences {
  return { ...defaults, pieces: {} };
}

function readPieces(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([, v]) => typeof v === "number" && Number.isInteger(v) && v >= 0,
    ),
  );
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function loadPreferences(store: KeyValueStore): Preferences {
  let raw: unknown;
  try {
    raw = JSON.parse(store.getItem(KEY) ?? "null");
  } catch {
    return fresh();
  }
  if (typeof raw !== "object" || raw === null) return fresh();
  const r = raw as Record<string, unknown>;
  return {
    soundscape:
      typeof r.soundscape === "string" ? r.soundscape : defaults.soundscape,
    volume:
      typeof r.volume === "number" && r.volume >= 0 && r.volume <= 1
        ? r.volume
        : defaults.volume,
    pieces: readPieces(r.pieces),
  };
}

export function savePreferences(store: KeyValueStore, prefs: Preferences) {
  try {
    store.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked (private browsing): preferences just don't persist.
  }
}
