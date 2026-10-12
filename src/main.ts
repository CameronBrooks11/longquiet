import "./style.css";
import {
  findSoundscape,
  populatedSections,
  soundscapes,
  type Soundscape,
} from "./catalogue";
import { moveIndex, tabStop } from "./keys";
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
const sectionList = byId<HTMLDivElement>("sections");
const panel = byId<HTMLDivElement>("section-panel");
const playButton = byId<HTMLButtonElement>("play");
const now = byId<HTMLParagraphElement>("now");
const volume = byId<HTMLInputElement>("volume");

const buttons = soundscapes.map((s) =>
  el("button", {
    type: "button",
    textContent: s.label,
    onclick: () => choose(s),
  }),
);
buttons.forEach((b) => b.setAttribute("role", "radio"));
scapes.append(...buttons);

// The section on show; it follows the chosen sound, and browsing another
// section does not change what is playing until a sound there is chosen.
let shown = findSoundscape(prefs.soundscape).section;

const tabs = populatedSections.map((section) => {
  const tab = el("button", {
    type: "button",
    textContent: section.label,
    onclick: () => showSection(section.id),
  });
  tab.id = `section-${section.id}`;
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", "section-panel");
  return tab;
});
sectionList.append(...tabs);
// One section needs no switcher; with more, the grid sits in a tab panel.
sectionList.hidden = tabs.length < 2;
if (tabs.length > 1) panel.setAttribute("role", "tabpanel");

function showSection(id: string) {
  shown = id;
  render();
}

function visibleButtons(): HTMLButtonElement[] {
  return buttons.filter((_, i) => soundscapes[i].section === shown);
}

// One tab stop per group; arrows, Home and End move the selection.
function onArrows(
  items: () => HTMLButtonElement[],
  activate: (b: HTMLButtonElement) => void,
  vertical = true,
) {
  return (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(e.target as HTMLButtonElement);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const j = moveIndex(i, e.key, list.length, vertical);
    if (j === null) return;
    e.preventDefault();
    list[j].focus();
    activate(list[j]);
  };
}

scapes.addEventListener(
  "keydown",
  onArrows(visibleButtons, (b) => choose(soundscapes[buttons.indexOf(b)])),
);
sectionList.addEventListener(
  "keydown",
  onArrows(
    () => tabs,
    (t) => showSection(populatedSections[tabs.indexOf(t)].id),
    false,
  ),
);

// One line per built file; a playlist's tracks are numbered under its name.
byId<HTMLUListElement>("credits").append(
  ...soundscapes.flatMap((s) =>
    s.tracks.map((t, i) =>
      el(
        "li",
        {},
        el("strong", {
          textContent: s.loops ? s.label : `${s.label} ${i + 1}`,
        }),
        " — ",
        el("a", { href: t.sourceUrl, textContent: `“${t.title}”` }),
        " by ",
        el("a", { href: t.authorUrl, textContent: t.author }),
        t.recorded ? `, recorded in ${t.recorded}` : "",
        ". ",
        el("a", { href: t.licence.url, textContent: t.licence.name }),
        `. ${t.modifications}.`,
      ),
    ),
  ),
);

function render() {
  const current = player.soundscape;
  tabs.forEach((t, i) => {
    const selected = populatedSections[i].id === shown;
    t.setAttribute("aria-selected", String(selected));
    t.tabIndex = selected ? 0 : -1;
    if (selected && tabs.length > 1) {
      panel.setAttribute("aria-labelledby", t.id);
    }
  });
  const selected = current ? buttons[soundscapes.indexOf(current)] : null;
  const stop = tabStop(visibleButtons(), selected);
  buttons.forEach((b, i) => {
    b.hidden = soundscapes[i].section !== shown;
    b.setAttribute("aria-checked", String(soundscapes[i] === current));
    b.tabIndex = b === stop ? 0 : -1;
  });
  document.body.classList.toggle("is-playing", player.playing);
  document.body.classList.toggle("is-loading", player.loading);
  playButton.setAttribute(
    "aria-label",
    player.loading ? "Pause (loading)" : player.playing ? "Pause" : "Play",
  );
  const track = player.track;
  now.textContent = track ? `${track.title} — ${track.author}` : "";
}

function reportPlaybackError(err: unknown) {
  now.textContent = "Couldn't start playback. Tap play to try again.";
  console.error(err);
}

function choose(s: Soundscape) {
  shown = s.section;
  prefs.soundscape = s.id;
  savePreferences(localStorage, prefs);
  player.select(s).catch(reportPlaybackError);
}

player.onchange = render;
player.onerror = reportPlaybackError;

playButton.addEventListener("click", () => {
  player.toggle().catch(reportPlaybackError);
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
