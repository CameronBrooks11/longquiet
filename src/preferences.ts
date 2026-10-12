export interface Preferences {
  soundscape: string;
  volume: number;
}

const KEY = "longquiet:prefs";

export const defaults: Preferences = { soundscape: "rain", volume: 0.7 };

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function loadPreferences(store: KeyValueStore): Preferences {
  let raw: unknown;
  try {
    raw = JSON.parse(store.getItem(KEY) ?? "null");
  } catch {
    return { ...defaults };
  }
  if (typeof raw !== "object" || raw === null) return { ...defaults };
  const r = raw as Record<string, unknown>;
  return {
    soundscape:
      typeof r.soundscape === "string" ? r.soundscape : defaults.soundscape,
    volume:
      typeof r.volume === "number" && r.volume >= 0 && r.volume <= 1
        ? r.volume
        : defaults.volume,
  };
}

export function savePreferences(store: KeyValueStore, prefs: Preferences) {
  try {
    store.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked (private browsing): preferences just don't persist.
  }
}
