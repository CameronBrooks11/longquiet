import "./style.css";
import {
  clock,
  findSoundscape,
  nowPlaying,
  playlistSummary,
  populatedSections,
  soundscapes,
  type Soundscape,
} from "./catalogue";
import { moveIndex, tabStop } from "./keys";
import {
  bytes,
  isSaved,
  megabytes,
  offlineSupported,
  registerWorker,
  remove,
  save,
} from "./offline";
import { Player } from "./player";
import { loadPreferences, savePreferences } from "./preferences";
import { remainingLabel, SleepTimer } from "./sleep";

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
const nextButton = byId<HTMLButtonElement>("next");
const previousButton = byId<HTMLButtonElement>("previous");
const pieces = byId<HTMLDivElement>("pieces");
const now = byId<HTMLParagraphElement>("now");
const volume = byId<HTMLInputElement>("volume");
const timerChoice = byId<HTMLSelectElement>("timer");
const timerLeft = byId<HTMLSpanElement>("timer-left");

const buttons = soundscapes.map((s) =>
  el("button", {
    type: "button",
    textContent: s.label,
    onclick: () => choose(s, true),
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
        t.sharedUnder
          ? `; this version is shared under ${t.sharedUnder}.`
          : ".",
        el(
          "details",
          {},
          el("summary", { textContent: "Changes made" }),
          `${t.modifications}.`,
        ),
      ),
    ),
  ),
);

function render() {
  const current = player.soundscape;
  tabs.forEach((t, i) => {
    const selected = populatedSections[i].id === shown;
    t.dataset.playing = String(
      player.playing && current?.section === populatedSections[i].id,
    );
    t.setAttribute("aria-selected", String(selected));
    t.tabIndex = selected ? 0 : -1;
    if (selected) scapes.setAttribute("aria-label", populatedSections[i].label);
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
  nextButton.hidden = previousButton.hidden = !current || current.loops;
  if (current && !current.loops) {
    nextButton.title = `Next piece in ${current.label}`;
    nextButton.setAttribute("aria-label", nextButton.title);
    previousButton.title = `Previous piece in ${current.label}`;
    previousButton.setAttribute("aria-label", previousButton.title);
    if (prefs.pieces[current.id] !== player.piece) {
      prefs.pieces[current.id] = player.piece;
      savePreferences(localStorage, prefs);
    }
  }
  renderPieces(current);
  const track = player.track;
  if (current && track) {
    const { title, artist, playlist } = nowPlaying(current, track);
    // One line each, cut short at the edge so the page below never moves;
    // the full text is in the title, the lock screen and the credits.
    const lines = [`${playlist ? `${playlist} · ` : ""}${title}`, artist];
    if (now.textContent !== lines.join("")) {
      now.replaceChildren(
        ...lines.map((text) => el("span", { textContent: text, title: text })),
      );
    }
  } else {
    now.textContent = "";
  }
  followPlayback();
  renderTimer();
}

// The current playlist's pieces, below the controls: built when the playlist
// changes, marked as the piece moves on.
let listed: Soundscape | null = null;
function renderPieces(current: Soundscape | null) {
  const list = current && !current.loops ? current : null;
  pieces.hidden = !list || list.section !== shown;
  if (list !== listed) {
    listed = list;
    pieces.replaceChildren();
    if (list) {
      const items = list.tracks.map((t, i) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              type: "button",
              onclick: () => {
                const playing = player.playing;
                player.playPiece(i).catch(reportPlaybackError);
                if (!playing) player.play().catch(reportPlaybackError);
              },
            },
            el("span", { textContent: t.title }),
            el("span", {
              className: "length",
              textContent: clock(t.build.seconds),
            }),
          ),
        ),
      );
      const ol = el("ol", {}, ...items);
      ol.setAttribute("aria-label", `${list.label} pieces`);
      pieces.append(
        el("p", {
          textContent: `${list.description} · ${playlistSummary(list)}`,
        }),
        ol,
      );
    }
  }
  pieces.querySelectorAll("button").forEach((b, i) => {
    if (list && i === player.piece) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  });
}

// Sleep timer. Not saved between visits: tonight's timer is not tomorrow's.
const SLEEP_FADE_MS = 30_000;
const SLEEP_NOTICE_MS = 5_000;
const sleep = new SleepTimer();
let wasPlaying = false;
let cancelledAt = -Infinity;

// Starting playback starts a waiting timer; pausing, by hand or by the
// system, cancels it.
function followPlayback() {
  if (player.playing && !wasPlaying) sleep.started();
  if (!player.playing && wasPlaying && sleep.on) {
    sleep.cancel();
    timerChoice.value = "0";
    cancelledAt = Date.now();
  }
  wasPlaying = player.playing;
}

// Runs several times a second; writes only when the minute changes, and
// leaves the select alone so an open list is not reset under the pointer.
function renderTimer() {
  const left = sleep.remaining();
  const label = sleep.waiting
    ? "Starts when you press play"
    : left !== null
      ? remainingLabel(left)
      : Date.now() - cancelledAt < SLEEP_NOTICE_MS
        ? "Timer cancelled"
        : "";
  if (timerLeft.textContent !== label) timerLeft.textContent = label;
}

// Checked every second while the page runs, and on the audio's own
// timeupdate events, which may keep coming on a locked phone when timers
// do not. Either way the deadline is wall-clock time.
function checkTimer() {
  if (sleep.expire()) {
    timerChoice.value = "0";
    player.pause(SLEEP_FADE_MS).catch(reportPlaybackError);
  }
  renderTimer();
}

timerChoice.addEventListener("change", () => {
  sleep.set(Number(timerChoice.value), player.playing);
  renderTimer();
});
setInterval(checkTimer, 1000);
for (const el of player.elements) el.addEventListener("timeupdate", checkTimer);

function reportPlaybackError(err: unknown) {
  now.textContent = "Couldn't start playback. Tap play to try again.";
  console.error(err);
}

// A tap plays what it chose; the arrow keys only move the selection while
// paused, so browsing with the keyboard stays silent.
function choose(s: Soundscape, start = false) {
  shown = s.section;
  prefs.soundscape = s.id;
  savePreferences(localStorage, prefs);
  const playing = player.playing;
  // While paused, select() loads the new source before its first await, so
  // play() still runs inside the tap, as iOS requires.
  player.select(s, prefs.pieces[s.id]).catch(reportPlaybackError);
  if (start && !playing) player.play().catch(reportPlaybackError);
}

player.onchange = render;
player.onerror = reportPlaybackError;

playButton.addEventListener("click", () => {
  player.toggle().catch(reportPlaybackError);
});
nextButton.addEventListener("click", () => void player.next());
previousButton.addEventListener("click", () => void player.previous());

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

// Space plays and pauses from the page or a sound's button, which is
// already selected once focused. Other controls keep Space for themselves.
function spaceToggles(e: KeyboardEvent): boolean {
  const t = e.target as Node;
  return e.code === "Space" && (t === document.body || scapes.contains(t));
}
document.addEventListener("keydown", (e) => {
  if (!spaceToggles(e)) return;
  e.preventDefault();
  if (!e.repeat) playButton.click();
});

// Offline listening: a sound saved whole plays with no connection. The
// list says which are saved and the space they take.
const base = import.meta.env.BASE_URL;
registerWorker(base);
const offline = byId<HTMLDetailsElement>("offline");
const offlineUse = byId<HTMLParagraphElement>("offline-use");
const saved = new Set<string>();
const offlineRows = soundscapes.map((s) => {
  const button = el("button", { type: "button" });
  button.addEventListener("click", () => void toggleSaved(s, button));
  const li = el(
    "li",
    {},
    el("span", { textContent: s.label }),
    el("span", { className: "size", textContent: megabytes(bytes(s)) }),
    button,
  );
  return { s, button, li };
});
byId<HTMLUListElement>("offline-list").append(...offlineRows.map((r) => r.li));

function renderOffline() {
  for (const { s, button } of offlineRows) {
    const on = saved.has(s.id);
    button.textContent = on ? "Remove" : "Save";
    button.setAttribute(
      "aria-label",
      on ? `Remove ${s.label}` : `Save ${s.label} for offline`,
    );
  }
  const used = soundscapes
    .filter((s) => saved.has(s.id))
    .reduce((n, s) => n + bytes(s), 0);
  offlineUse.textContent = saved.size
    ? `Saved sounds play with no connection. ${megabytes(used)} in use.`
    : "Save a sound to play it with no connection.";
}

async function toggleSaved(s: Soundscape, button: HTMLButtonElement) {
  const removing = saved.has(s.id);
  button.disabled = true;
  button.textContent = removing ? "Removing…" : "Saving…";
  try {
    if (removing) {
      await remove(base, s);
      saved.delete(s.id);
    } else {
      await save(base, s);
      saved.add(s.id);
    }
    renderOffline();
  } catch (err) {
    console.warn(err);
    renderOffline();
    offlineUse.textContent = removing
      ? `Couldn't remove ${s.label}.`
      : `Couldn't save ${s.label}. There may not be enough space.`;
  } finally {
    button.disabled = false;
  }
}

if (offlineSupported) {
  offline.hidden = false;
  renderOffline();
  void Promise.all(
    soundscapes.map(async (s) => {
      if (await isSaved(base, s)) saved.add(s.id);
    }),
  ).then(renderOffline);
}

const first = findSoundscape(prefs.soundscape);
void player.select(first, prefs.pieces[first.id]);
render();
