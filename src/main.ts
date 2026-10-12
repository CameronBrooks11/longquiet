import "./style.css";
import { findSoundscape, soundscapes, type Soundscape } from "./catalogue";
import { Player } from "./player";
import { loadPreferences, savePreferences } from "./preferences";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const prefs = loadPreferences(localStorage);
const player = new Player(import.meta.env.BASE_URL);
player.setVolume(prefs.volume);

const scapes = byId<HTMLDivElement>("scapes");
const playButton = byId<HTMLButtonElement>("play");
const now = byId<HTMLParagraphElement>("now");
const volume = byId<HTMLInputElement>("volume");

const buttons = soundscapes.map((s) =>
  el("button", {
    type: "button",
    textContent: s.label,
    onclick: () => void choose(s),
  }),
);
buttons.forEach((b) => b.setAttribute("role", "radio"));
scapes.append(...buttons);

byId<HTMLUListElement>("credits").append(
  ...soundscapes.map((s) =>
    el(
      "li",
      {},
      el("strong", { textContent: s.label }),
      " — ",
      el("a", { href: s.sourceUrl, textContent: `“${s.title}”` }),
      " by ",
      el("a", { href: s.authorUrl, textContent: s.author }),
      s.recorded ? `, recorded in ${s.recorded}` : "",
      ". ",
      el("a", { href: s.licence.url, textContent: s.licence.name }),
      `. ${s.modifications}.`,
    ),
  ),
);

function render() {
  const current = player.soundscape;
  buttons.forEach((b, i) =>
    b.setAttribute("aria-checked", String(soundscapes[i] === current)),
  );
  document.body.classList.toggle("is-playing", player.playing);
  playButton.setAttribute("aria-label", player.playing ? "Pause" : "Play");
  now.textContent = current ? `${current.title} — ${current.author}` : "";
}

async function choose(s: Soundscape) {
  prefs.soundscape = s.id;
  savePreferences(localStorage, prefs);
  const pending = player.select(s);
  render();
  await pending;
}

player.onchange = render;

playButton.addEventListener("click", () => {
  player.toggle().catch((err: unknown) => {
    now.textContent = "Couldn't start playback. Tap play to try again.";
    console.error(err);
  });
});

if (Player.volumeIsControllable()) {
  volume.value = String(prefs.volume);
  volume.addEventListener("input", () => {
    prefs.volume = Number(volume.value);
    player.setVolume(prefs.volume);
    savePreferences(localStorage, prefs);
  });
} else {
  byId("volume-row").hidden = true;
  byId("volume-hint").hidden = false;
}

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    playButton.click();
  }
});

void player.select(findSoundscape(prefs.soundscape));
render();
