// Every recording the app can play comes from sounds/sounds.json, the same
// file scripts/build-sounds.sh renders from. The credits panel is built from
// it, so a sound cannot ship without its attribution, and the description of
// what was done to each file comes from the recipe that did it.
import data from "../sounds/sounds.json";

export interface Licence {
  name: string;
  url: string;
}

export interface Recipe {
  excerpt: number | null;
  crossfade: number;
  limit?: number | null;
}

// How a section plays: one looped recording, generated tones, or a run of
// tracks one after another.
export type SectionKind = "loop" | "tones" | "playlist";

export interface Section {
  id: string;
  label: string;
  kind: SectionKind;
}

// One built file: a looped recording, or one piece of a playlist.
export interface Track {
  id: string;
  title: string;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  licence: Licence;
  recorded?: string;
  source: { file: string; format: string; sha256: string };
  build: { sha256: string; bytes: number };
  recipe: Recipe;
  file: string;
  modifications: string;
}

// What the listener picks: one looped track, or a playlist played in order
// and repeated.
export interface Soundscape {
  id: string;
  label: string;
  section: string;
  tracks: readonly Track[];
  loops: boolean;
}

type RawTrack = Omit<Track, "file" | "modifications">;
type RawSound = { id: string; label: string; section: string } & (
  RawTrack | { tracks: RawTrack[] }
);

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Typographic minus, as the credits are prose.
function signed(n: number): string {
  return `${n < 0 ? "−" : ""}${Math.abs(n)}`;
}

export function describeProcessing(
  format: string,
  recipe: Recipe,
  target: number,
): string {
  const steps = [`From the original ${format}`];
  if (recipe.excerpt !== null)
    steps.push(`first ${clock(recipe.excerpt)} only`);
  if (recipe.crossfade > 0) {
    const x = recipe.crossfade;
    steps.push(
      `last ${x} s crossfaded into the first ${x} s to smooth the loop point`,
    );
  }
  if (recipe.limit != null) {
    steps.push(`levelled to ${signed(target)} LUFS`);
    steps.push(`rare peaks limited to ${signed(recipe.limit)} dBFS`);
    steps.push("encoded as MP3");
  } else {
    steps.push(`levelled to ${signed(target)} LUFS and encoded as MP3`);
  }
  return steps.join("; ");
}

function toTrack(t: RawTrack): Track {
  return {
    ...t,
    file: `${t.id}.mp3`,
    modifications: describeProcessing(
      t.source.format,
      t.recipe,
      data.loudnessTarget,
    ),
  };
}

export const soundscapes: readonly Soundscape[] = (
  data.sounds as RawSound[]
).map((s) => {
  const { id, label, section } = s;
  return "tracks" in s
    ? { id, label, section, tracks: s.tracks.map(toTrack), loops: false }
    : { id, label, section, tracks: [toTrack(s)], loops: true };
});

// Every built file, in catalogue order.
export const tracks: readonly Track[] = soundscapes.flatMap((s) => s.tracks);

export const sections = data.sections as readonly Section[];

export function soundsIn(section: string): Soundscape[] {
  return soundscapes.filter((s) => s.section === section);
}

// Sections with something to play, in their listed order.
export const populatedSections: readonly Section[] = sections.filter(
  (s) => soundsIn(s.id).length > 0,
);

export function findSoundscape(id: string | null | undefined): Soundscape {
  return soundscapes.find((s) => s.id === id) ?? soundscapes[0];
}
