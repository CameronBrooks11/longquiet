import type { Soundscape } from "./catalogue";

// Sounds saved for offline listening, in the cache the service worker
// answers audio from (src/sw/sw.ts, which names it too).
const AUDIO_CACHE = "audio";

export const offlineSupported =
  "serviceWorker" in navigator && "caches" in window;

// Only the built site has a worker to register; the dev server does not.
export function registerWorker(base: string) {
  if (!offlineSupported || !import.meta.env.PROD) return;
  navigator.serviceWorker
    .register(`${base}sw.js`)
    .catch((err: unknown) => console.warn("Offline listening is off:", err));
}

function urls(base: string, s: Soundscape): string[] {
  return s.tracks.map((t) => `${base}audio/${t.file}`);
}

export function bytes(s: Soundscape): number {
  return s.tracks.reduce((n, t) => n + t.build.bytes, 0);
}

// Saved only when every file of it is: a playlist missing a piece is not.
export async function isSaved(base: string, s: Soundscape): Promise<boolean> {
  const c = await caches.open(AUDIO_CACHE);
  const hits = await Promise.all(urls(base, s).map((u) => c.match(u)));
  return hits.every(Boolean);
}

// Tell the worker which files are saved, and wait until it knows; no
// worker, or none answering within a second, is no reason to fail.
function notifyWorker(): Promise<void> {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    setTimeout(resolve, 1000);
    worker.postMessage("saved-changed", [channel.port2]);
  });
}

export async function save(base: string, s: Soundscape) {
  // Asked once a listener saves something, so the browser keeps it under
  // storage pressure where it can; refused is fine.
  void navigator.storage?.persist?.();
  const c = await caches.open(AUDIO_CACHE);
  await c.addAll(urls(base, s));
  await notifyWorker();
}

export async function remove(base: string, s: Soundscape) {
  const c = await caches.open(AUDIO_CACHE);
  await Promise.all(urls(base, s).map((u) => c.delete(u)));
  await notifyWorker();
}

export function megabytes(n: number): string {
  return `${Math.max(1, Math.round(n / 1e6))} MB`;
}
