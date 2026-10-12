import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { soundscapes } from "./catalogue";
import { Player } from "./player";

// The parts of <audio> the player relies on, as Chrome does them (measured):
// play() unpauses at once, fires "play", and its promise waits for the file;
// pause() fires "pause" and rejects a pending play() with AbortError;
// changing src pauses silently (only abort/emptied) and rejects a pending
// play() too. Events are queued tasks.
class FakeAudio {
  paused = true;
  volume = 1;
  loop = false;
  preload = "";
  private source = "";
  private pending: { resolve: () => void; reject: (e: Error) => void } | null =
    null;
  private listeners = new Map<string, (() => void)[]>();

  get src() {
    return this.source;
  }
  set src(v: string) {
    this.source = v;
    this.paused = true;
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.reject(new DOMException("interrupted by a new load", "AbortError"));
    }
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  private fire(type: string) {
    setTimeout(() => this.listeners.get(type)?.forEach((fn) => fn()), 0);
  }
  play() {
    if (this.paused) {
      this.paused = false;
      this.fire("play");
    }
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }
  pause() {
    if (!this.paused) {
      this.paused = true;
      this.fire("pause");
    }
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.reject(
        new DOMException("interrupted by a call to pause()", "AbortError"),
      );
    }
  }
  error: Error | null = null;
  // The file has loaded: sound starts and a pending play() resolves.
  load() {
    const p = this.pending;
    this.pending = null;
    this.fire("playing");
    p?.resolve();
  }
  // Playback stalls for data, then resumes.
  stall() {
    this.fire("waiting");
  }
  resume() {
    this.fire("playing");
  }
  // The file cannot be loaded at all: "error" fires, then the pending
  // play() rejects, in one task; the element stays unpaused.
  failStart() {
    this.error = new Error("unsupported");
    this.listeners.get("error")?.forEach((fn) => fn());
    const p = this.pending;
    this.pending = null;
    p?.reject(new DOMException("no supported source", "NotSupportedError"));
  }
  get pendingPlay() {
    return this.pending !== null;
  }
  // The network drops after playback had started.
  fail() {
    this.error = new Error("network");
    this.fire("error");
  }
  // Something outside the page pauses it: unplugged headphones, a call.
  interrupt() {
    this.pause();
  }
}

const [rain, forest, stream, night] = soundscapes;

function setup() {
  const audio = new FakeAudio();
  const player = new Player("/", audio as unknown as HTMLAudioElement);
  const changes = vi.fn();
  player.onchange = changes;
  return { audio, player, changes };
}

async function playing(audio: FakeAudio, player: Player) {
  await player.select(rain);
  const started = player.play();
  audio.load();
  await vi.advanceTimersByTimeAsync(1000);
  await started;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Player", () => {
  it("shows an outside pause, such as unplugged headphones", async () => {
    const { audio, player } = setup();
    await playing(audio, player);

    audio.interrupt();
    await vi.advanceTimersByTimeAsync(10);

    expect(player.playing).toBe(false);
  });
});

describe("Player.loading", () => {
  it("is on from pressing play until sound comes out", async () => {
    const { audio, player } = setup();
    await player.select(rain);
    const started = player.play();
    expect(player.playing).toBe(true);
    expect(player.loading).toBe(true);

    audio.load();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    expect(player.loading).toBe(false);
  });

  it("clears when the listener pauses before anything loads", async () => {
    const { player } = setup();
    await player.select(rain);
    void player.play();
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    await paused;
    expect(player.loading).toBe(false);
    expect(player.playing).toBe(false);
  });

  it("does not report a pause during loading as a failure", async () => {
    const { player } = setup();
    await player.select(rain);
    const started = player.play();
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(started).resolves.toBeUndefined();
    await paused;
    expect(player.playing).toBe(false);
    expect(player.loading).toBe(false);
  });

  it("reports a failed start once and leaves nothing spinning", async () => {
    const { audio, player } = setup();
    const errors = vi.fn();
    player.onerror = errors;
    await player.select(rain);
    const started = player.play();
    audio.failStart();

    await expect(started).rejects.toThrow("no supported source");
    await vi.advanceTimersByTimeAsync(10);
    expect(errors).not.toHaveBeenCalled();
    expect(player.playing).toBe(false);
    expect(player.loading).toBe(false);
    expect(audio.paused).toBe(true);
  });

  it("loads afresh when play is pressed again after a failed start", async () => {
    const { audio, player } = setup();
    await player.select(rain);
    const first = player.play();
    audio.failStart();
    await expect(first).rejects.toThrow();

    const retry = player.play();
    expect(audio.pendingPlay).toBe(true);
    expect(player.loading).toBe(true);
    audio.load();
    await vi.advanceTimersByTimeAsync(1000);
    await retry;
    expect(player.playing).toBe(true);
    expect(player.loading).toBe(false);
  });

  it("shows a mid-play stall until playback resumes", async () => {
    const { audio, player } = setup();
    await playing(audio, player);

    audio.stall();
    await vi.advanceTimersByTimeAsync(10);
    expect(player.loading).toBe(true);
    audio.resume();
    await vi.advanceTimersByTimeAsync(10);
    expect(player.loading).toBe(false);
  });

  it("is on again while a switch loads the new sound", async () => {
    const { audio, player } = setup();
    await playing(audio, player);

    const choice = player.select(forest);
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.loading).toBe(true);
    audio.load();
    await vi.advanceTimersByTimeAsync(1000);
    await choice;
    expect(player.loading).toBe(false);
    expect(player.playing).toBe(true);
  });

  it("reports a failure after playback started and returns to Play", async () => {
    const { audio, player } = setup();
    const errors = vi.fn();
    player.onerror = errors;
    await playing(audio, player);

    audio.fail();
    await vi.advanceTimersByTimeAsync(10);
    expect(player.playing).toBe(false);
    expect(player.loading).toBe(false);
    expect(errors).toHaveBeenCalledOnce();
  });
});

describe("Player.select", () => {
  it("shows a new choice at once, before the fade-out ends", async () => {
    const { audio, player, changes } = setup();
    await playing(audio, player);
    changes.mockClear();

    void player.select(forest);

    expect(player.soundscape).toBe(forest);
    expect(changes).toHaveBeenCalled();
    expect(audio.src).toBe("/audio/rain.mp3");
  });

  it("ends a burst of choices on the last one, still playing", async () => {
    const { audio, player } = setup();
    await playing(audio, player);

    const all = [forest, stream, night].map((s) => player.select(s));
    await vi.advanceTimersByTimeAsync(1000);
    audio.load();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(all);

    expect(player.soundscape).toBe(night);
    expect(audio.src).toBe("/audio/night.mp3");
    expect(player.playing).toBe(true);
    expect(audio.paused).toBe(false);
  });

  it("keeps playing when a newer choice aborts an older play()", async () => {
    const { audio, player } = setup();
    await playing(audio, player);

    const first = player.select(forest);
    await vi.advanceTimersByTimeAsync(1000); // forest's play() now pending
    expect(audio.src).toBe("/audio/forest.mp3");
    const second = player.select(stream); // its src change aborts forest's
    await vi.advanceTimersByTimeAsync(1000);
    audio.load();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(audio.src).toBe("/audio/stream.mp3");
    expect(player.playing).toBe(true);
  });

  it("leaves a choice made during a pause selected and paused", async () => {
    const { audio, player } = setup();
    await playing(audio, player);

    const choice = player.select(forest);
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([choice, paused]);

    expect(player.soundscape).toBe(forest);
    expect(audio.src).toBe("/audio/forest.mp3");
    expect(player.playing).toBe(false);
    expect(audio.paused).toBe(true);
  });

  it("ends a key-repeat burst playing at full volume", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await playing(audio, player);

    const all: Promise<void>[] = [];
    for (const s of [forest, stream, night, rain, forest, stream, night]) {
      all.push(player.select(s)); // each press its own task, ms apart
      await vi.advanceTimersByTimeAsync(2);
    }
    await vi.advanceTimersByTimeAsync(1000);
    audio.load();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(all);

    expect(audio.src).toBe("/audio/night.mp3");
    expect(player.playing).toBe(true);
    expect(audio.paused).toBe(false);
    expect(audio.volume).toBeCloseTo(0.7);
  });

  it("pauses cleanly when pause lands during a switch's fade", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await playing(audio, player);

    const choice = player.select(forest);
    await vi.advanceTimersByTimeAsync(300);
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([choice, paused]);

    expect(audio.src).toBe("/audio/forest.mp3");
    expect(audio.paused).toBe(true);
    expect(player.playing).toBe(false);
    expect(audio.volume).toBeCloseTo(0.7);
  });

  it("still reports a real failure to start", async () => {
    const { audio, player } = setup();
    await player.select(rain);
    const started = player.play();
    audio.src = "/audio/rain.mp3"; // a reload fails the only pending play()
    await expect(started).rejects.toThrow("interrupted");
    expect(player.playing).toBe(false);
  });
});
