/// <reference lib="webworker" />
import { ranged } from "./range";

declare const self: ServiceWorkerGlobalScope;

// The built files, written in by the build (vite.config.ts); their names
// carry content hashes, so a new list means a new release.
const SHELL: string[] = JSON.parse("__SHELL__");
const SHELL_CACHE = `shell-${hash(SHELL.join("\n"))}`;
// Sounds the listener saved, kept across releases; the page writes it
// (src/offline.ts). Not a shared import, which would split the worker into
// chunks a classic worker cannot load. The player may ask for a file again
// as <file>?retry=<n> after a failure, so lookups ignore the query.
const AUDIO_CACHE = "audio";

// The saved files' paths, read when the worker starts and again when the
// page saves or removes a sound. Audio not among them is left alone, so
// the browser fetches it as if there were no worker.
let saved: Set<string> | null = null;
function readSaved(): Promise<void> {
  return caches
    .open(AUDIO_CACHE)
    .then((c) => c.keys())
    .then((keys) => {
      saved = new Set(keys.map((k) => new URL(k.url).pathname));
    });
}
void readSaved();

// The page waits for the reply, so a sound played straight after saving
// is already known here.
self.addEventListener("message", (e) => {
  if (e.data !== "saved-changed") return;
  e.waitUntil(readSaved().then(() => e.ports[0]?.postMessage("ok")));
});

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(["./", ...SHELL]))
      .then(() => self.skipWaiting()),
  );
});

// A new release takes over at once and drops the old release's files.
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("shell-") && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // A saved sound comes from the cache; any other goes to the network as
  // if there were no worker.
  if (url.pathname.includes("/audio/")) {
    if (saved && !saved.has(url.pathname)) return;
    // Saved, or not yet known while the worker starts.
    e.respondWith(
      caches
        .open(AUDIO_CACHE)
        .then((c) => c.match(req, { ignoreSearch: true }))
        .then((hit) =>
          hit
            ? ranged(hit, req.headers.get("Range"))
            : fetch(req).catch(() => Response.error()),
        ),
    );
    return;
  }

  // The page itself from the network when there is one, so a release
  // reaches an installed app on its next open; the saved copy otherwise.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(async () => {
        const hit = await caches.match("./", {
          cacheName: SHELL_CACHE,
          ignoreVary: true,
        });
        return hit ?? Response.error();
      }),
    );
    return;
  }

  e.respondWith(
    caches
      // The page asks for its script and styles with an Origin header
      // the install's requests lacked; a Vary: Origin reply would miss.
      .match(req, { cacheName: SHELL_CACHE, ignoreVary: true })
      .then((hit) => hit ?? fetch(req)),
  );
});
