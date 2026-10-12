// Every recording the app can play. The credits panel is rendered from this
// list, so a sound cannot ship without its attribution.

export interface Licence {
  name: string;
  url: string;
}

export interface Soundscape {
  id: string;
  label: string;
  file: string;
  title: string;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  licence: Licence;
  recorded?: string;
  modifications: string;
}

export const CC0: Licence = {
  name: "CC0 1.0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
};

const PREVIEW = "From the Freesound high-quality MP3 preview";
const LEVELLED = "levelled to −26 LUFS and re-encoded as MP3";

export const soundscapes: readonly Soundscape[] = [
  {
    id: "rain",
    label: "Rain",
    file: "rain.mp3",
    title: "Rainstorm 10 min",
    author: "Valerie-Vivegnis",
    authorUrl: "https://freesound.org/people/Valerie-Vivegnis/",
    sourceUrl: "https://freesound.org/people/Valerie-Vivegnis/sounds/759545/",
    licence: CC0,
    modifications: `${PREVIEW}; last 8 s crossfaded into the first 8 s to smooth the loop point; ${LEVELLED}`,
  },
  {
    id: "forest",
    label: "Forest",
    file: "forest.mp3",
    title: "Afternoon Woods in October - Midwest US (loop)",
    author: "NickTayloe",
    authorUrl: "https://freesound.org/people/NickTayloe/",
    sourceUrl: "https://freesound.org/people/NickTayloe/sounds/830253/",
    licence: CC0,
    recorded: "Albion, Indiana, United States",
    modifications: `${PREVIEW}; ${LEVELLED}`,
  },
  {
    id: "stream",
    label: "Stream",
    file: "stream.mp3",
    title: "Stream flow over the stones in the fields and insect chirping",
    author: "lastraindrop",
    authorUrl: "https://freesound.org/people/lastraindrop/",
    sourceUrl: "https://freesound.org/people/lastraindrop/sounds/732848/",
    licence: CC0,
    recorded: "Guilin Shi, Guangxi, China",
    modifications: `${PREVIEW}; first 10:20 only; last 8 s crossfaded into the first 8 s to smooth the loop point; ${LEVELLED}`,
  },
  {
    id: "night",
    label: "Night",
    file: "night.mp3",
    title: "Serrinha do Alambari night frogs chorus with close crickets",
    author: "MeliaRoger",
    authorUrl: "https://freesound.org/people/MeliaRoger/",
    sourceUrl: "https://freesound.org/people/MeliaRoger/sounds/645706/",
    licence: CC0,
    recorded: "Resende, Rio de Janeiro, Brazil",
    modifications: `${PREVIEW}; last 8 s crossfaded into the first 8 s to smooth the loop point; ${LEVELLED}`,
  },
];

export function findSoundscape(id: string | null | undefined): Soundscape {
  return soundscapes.find((s) => s.id === id) ?? soundscapes[0];
}
