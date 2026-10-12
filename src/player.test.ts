import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { soundscapes } from "./catalogue";
import { Player } from "./player";

// The parts of <audio> the player relies on, as Chrome does them (measured):
// play() unpauses at once, fires "play", and its promise waits for the file;
// pause() fires "pause" and rejects a pending play() with AbortError;
// changing src pauses silently (only abort/emptied) and rejects a pending
// play() too; while the error is an unsupported source (code 4), play()
// rejects at once with no event, and after a network error (code 2) it waits
// forever; load() resets the element and clears the error. Events are queued tasks,
// and a src change or load() drops any not yet dispatched.
class FakeAudio {
  paused = true;
  volume = 1;
  loop = false;
  preload = "";
  private source = "";
  private pending: { resolve: () => void; reject: (e: Error) => void } | null =
    null;
  private listeners = new Map<string, (() => void)[]>();
  private queued = new Set<ReturnType<typeof setTimeout>>();

  get src() {
    return this.source;
  }
  set src(v: string) {
    this.source = v;
    this.paused = true;
    this.error = null;
    this.dropQueued();
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
    const id = setTimeout(() => {
      this.queued.delete(id);
      this.listeners.get(type)?.forEach((fn) => fn());
    }, 0);
    this.queued.add(id);
  }
  private dropQueued() {
    this.queued.forEach((id) => clearTimeout(id));
    this.queued.clear();
  }
  refuseNextPlay = false;
  play() {
    if (this.error?.code === 4) {
      return Promise.reject(new DOMException("errored", "NotSupportedError"));
    }
    if (this.refuseNextPlay) {
      this.refuseNextPlay = false;
      return Promise.reject(new DOMException("refused", "NotAllowedError"));
    }
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
  error: { code: number } | null = null;
  // The file has arrived: sound starts and a pending play() resolves.
  arrive() {
    if (this.error) return; // a failed fetch delivers nothing until load()
    const p = this.pending;
    this.pending = null;
    this.fire("playing");
    p?.resolve();
  }
  load() {
    this.paused = true;
    this.error = null;
    this.dropQueued();
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.reject(new DOMException("interrupted by load()", "AbortError"));
    }
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
    this.error = { code: 4 };
    this.listeners.get("error")?.forEach((fn) => fn());
    const p = this.pending;
    this.pending = null;
    p?.reject(new DOMException("no supported source", "NotSupportedError"));
  }
  get pendingPlay() {
    return this.pending !== null;
  }
  // The network drops (MEDIA_ERR_NETWORK), playing or not.
  fail() {
    this.error = { code: 2 };
    this.fire("error");
  }
  // Something outside the page pauses it: unplugged headphones, a call.
  interrupt() {
    this.pause();
  }
}

function sound(id: string) {
  const s = soundscapes.find((x) => x.id === id);
  if (!s) throw new Error(`no soundscape ${id}`);
  return s;
}
const [rain, forest, stream, night] = ["rain", "forest", "stream", "night"].map(
  sound,
);

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
  audio.arrive();
  await vi.advanceTimersByTimeAsync(1000);
  await started;
}

const page = {
  hidden: false,
  listeners: new Map<string, (() => void)[]>(),
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  },
  hide() {
    this.hidden = true;
    this.listeners.get("visibilitychange")?.forEach((fn) => fn());
  },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("document", page);
  page.hidden = false;
  page.listeners.clear();
  vi.stubGlobal("navigator", {});
  // Frames never come: fades must not depend on them (they stall in an
  // occluded or unfocused window).
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
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

    audio.arrive();
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

    await expect(started).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10);
    expect(errors).toHaveBeenCalledOnce();
    expect(player.playing).toBe(false);
    expect(player.loading).toBe(false);
    expect(audio.paused).toBe(true);
    expect(audio.error).toBeNull();
  });

  it("loads afresh when play is pressed again after a failed start", async () => {
    const { audio, player } = setup();
    await player.select(rain);
    const first = player.play();
    audio.failStart();
    await first;

    expect(audio.src).toBe("/audio/rain.mp3?retry=1");
    const retry = player.play();
    expect(audio.pendingPlay).toBe(true);
    expect(player.loading).toBe(true);
    audio.arrive();
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
    audio.arrive();
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
    expect(audio.paused).toBe(true);
    expect(audio.error).toBeNull();
  });

  it("can play again after a dropped connection", async () => {
    const { audio, player } = setup();
    await playing(audio, player);
    audio.fail();
    await vi.advanceTimersByTimeAsync(10);

    const retry = player.play();
    expect(audio.pendingPlay).toBe(true);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await retry;
    expect(player.playing).toBe(true);
  });

  it("recovers quietly from an error that arrives while paused", async () => {
    const { audio, player } = setup();
    const errors = vi.fn();
    player.onerror = errors;
    await playing(audio, player);
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    await paused;
    audio.fail();
    await vi.advanceTimersByTimeAsync(10);
    expect(errors).not.toHaveBeenCalled();

    const again = player.play();
    expect(audio.pendingPlay).toBe(true);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await again;
    expect(player.playing).toBe(true);
    expect(player.loading).toBe(false);
  });

  it("blames the sound that failed, even mid-switch", async () => {
    const { audio, player } = setup();
    await playing(audio, player); // rain
    const choice = player.select(forest);
    await vi.advanceTimersByTimeAsync(200); // rain still fading out
    audio.fail();
    await vi.advanceTimersByTimeAsync(1000);
    await choice;

    expect(audio.src).toBe("/audio/forest.mp3");
    await player.select(rain);
    expect(audio.src).toBe("/audio/rain.mp3?retry=1");
  });

  it("follows an outside play after a refused start", async () => {
    const { audio, player } = setup();
    await player.select(rain);
    audio.refuseNextPlay = true;
    await expect(player.play()).rejects.toThrow("refused");
    expect(player.playing).toBe(false);

    void audio.play(); // the browser resumes it, e.g. a media key
    await vi.advanceTimersByTimeAsync(10);
    expect(player.playing).toBe(true);
  });
});

describe("Player fades", () => {
  it("finish at once when the page is hidden mid-fade", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await player.select(rain);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(100); // fading up
    expect(audio.volume).toBeLessThan(0.7);

    page.hide(); // e.g. the phone is locked
    expect(audio.volume).toBeCloseTo(0.7);
    await started;
  });

  it("run smoothly on timers, with no animation frames at all", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await player.select(rain);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.volume).toBeGreaterThan(0.2); // part-way, not stuck
    expect(audio.volume).toBeLessThan(0.6);
    await vi.advanceTimersByTimeAsync(400);
    expect(audio.volume).toBeCloseTo(0.7);
    await started;
  });

  it("let a pause complete when the page is hidden mid-fade", async () => {
    const { audio, player } = setup();
    await playing(audio, player);
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(100);

    page.hide();
    expect(audio.volume).toBe(0); // the fade-out reached its end
    await paused;
    expect(audio.paused).toBe(true);
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
    audio.arrive();
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
    audio.arrive();
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
    audio.arrive();
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
