import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { soundscapes, type Soundscape, type Track } from "./catalogue";
import { Player } from "./player";

// The parts of <audio> the player relies on, as Chrome does them (measured):
// play() unpauses at once, fires "play", and its promise waits for the file;
// pause() fires "pause" and rejects a pending play() with AbortError;
// changing src pauses silently (only abort/emptied) and rejects a pending
// play() too; while the error is an unsupported source (code 4), play()
// rejects at once with no event, and after a network error (code 2) it waits
// forever; load() resets the element and clears the error. Events are queued tasks,
// and a src change or load() drops any not yet dispatched. Every play() call
// still pending is settled together, as the spec's list of pending promises.
class FakeAudio {
  paused = true;
  ended = false;
  volume = 1;
  muted = false;
  loop = false;
  preload = "";
  duration = NaN;
  // Enough buffered to play (4) once the file arrives; a new source, a
  // reload or a seek drops it until data comes again, and a stall to 2.
  readyState = 0;
  private time = 0;
  get currentTime() {
    return this.time;
  }
  set currentTime(v: number) {
    this.time = v;
    this.readyState = Math.min(this.readyState, 1);
  }
  private source = "";
  private pending: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private rejectPending(e: Error) {
    const ps = this.pending;
    this.pending = [];
    ps.forEach((p) => p.reject(e));
  }
  private listeners = new Map<string, (() => void)[]>();
  private queued = new Set<ReturnType<typeof setTimeout>>();

  get src() {
    return this.source;
  }
  // How many times a source was set: each one starts a fresh fetch.
  loads = 0;
  set src(v: string) {
    this.loads++;
    this.source = v;
    this.readyState = 0;
    this.paused = true;
    this.ended = false;
    this.error = null;
    this.dropQueued();
    this.rejectPending(
      new DOMException("interrupted by a new load", "AbortError"),
    );
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
      this.pending.push({ resolve, reject });
    });
  }
  pause() {
    if (!this.paused) {
      this.paused = true;
      this.fire("pause");
    }
    this.rejectPending(
      new DOMException("interrupted by a call to pause()", "AbortError"),
    );
  }
  error: { code: number } | null = null;
  // The file has arrived: sound starts and a pending play() resolves.
  arrive() {
    if (this.error) return; // a failed fetch delivers nothing until load()
    const ps = this.pending;
    this.pending = [];
    this.readyState = 4;
    this.fire("playing");
    ps.forEach((p) => p.resolve());
  }
  load() {
    this.readyState = 0;
    this.paused = true;
    this.ended = false;
    this.error = null;
    this.dropQueued();
    this.rejectPending(new DOMException("interrupted by load()", "AbortError"));
  }
  // Playback stalls for data, then resumes.
  stall() {
    this.readyState = 2;
    this.fire("waiting");
  }
  resume() {
    this.readyState = 4;
    this.fire("playing");
  }
  // The file cannot be loaded at all: "error" fires, then the pending
  // play() rejects, in one task; the element stays unpaused.
  failStart() {
    this.error = { code: 4 };
    this.listeners.get("error")?.forEach((fn) => fn());
    this.rejectPending(
      new DOMException("no supported source", "NotSupportedError"),
    );
  }
  get pendingPlay() {
    return this.pending.length > 0;
  }
  // The network drops (MEDIA_ERR_NETWORK), playing or not.
  fail() {
    this.error = { code: 2 };
    this.fire("error");
  }
  // A non-looping file plays to its end: it pauses, then reports ended.
  end() {
    if (!Number.isNaN(this.duration)) this.time = this.duration;
    this.ended = true;
    this.paused = true;
    this.fire("pause");
    this.fire("ended");
  }
  // The clock moves on while playing; a test of a stall leaves it still.
  advance(dt: number) {
    if (!this.paused && !this.error) this.time += dt;
  }
  // Playback reaches a position: the clock moves and "timeupdate" fires.
  tick(t: number) {
    this.time = t;
    this.fire("timeupdate");
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

function trackOf(id: string): Track {
  return { ...soundscapes[0].tracks[0], id, title: id, file: `${id}.mp3` };
}
const playlist: Soundscape = {
  id: "pieces",
  label: "Pieces",
  section: "music",
  loops: false,
  overlap: 0,
  tracks: ["piece-1", "piece-2", "piece-3"].map(trackOf),
};

function setup() {
  const audio = new FakeAudio();
  const spare = new FakeAudio();
  const player = new Player(
    "/",
    audio as unknown as HTMLAudioElement,
    spare as unknown as HTMLAudioElement,
  );
  const changes = vi.fn();
  player.onchange = changes;
  return { audio, spare, player, changes };
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

  it("are instant when the page is already hidden", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await player.select(rain);
    page.hide();
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(0);
    await started;
    expect(audio.volume).toBeCloseTo(0.7);
  });

  it("never touch the volume again once cancelled", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await player.select(rain);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(100); // fading in
    const paused = player.pause(); // cancels the fade-in, fades out
    let peak = audio.volume;
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(20);
      if (!audio.paused) peak = Math.max(peak, audio.volume);
    }
    await Promise.all([started, paused]);
    expect(peak).toBeLessThan(0.7 * 0.3); // never rose past where it was
    expect(audio.paused).toBe(true);
  });

  it("still finish on hide after an earlier fade was cancelled", async () => {
    // A cancelled fade's timer must stop: if it ran on, its end would mark no
    // fade as running while the newer one still is, and hiding would no
    // longer finish it.
    const { audio, player } = setup();
    player.setVolume(0.7);
    await player.select(rain);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(300); // fading in
    const paused = player.pause(); // new fade-out, 600 ms from here
    await vi.advanceTimersByTimeAsync(350); // past the old fade's end
    page.hide();
    expect(audio.volume).toBe(0);
    await Promise.all([started, paused]);
  });

  it("head for a new volume set during a fade-in", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await player.select(rain);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(200);
    player.setVolume(0.3);
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    expect(audio.volume).toBeCloseTo(0.3);
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

describe("Player sleep fade", () => {
  it("fades over the length given, then pauses", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await playing(audio, player);
    const paused = player.pause(30_000);
    expect(player.playing).toBe(false); // shows Play from the start
    await vi.advanceTimersByTimeAsync(15_000);
    expect(audio.paused).toBe(false);
    expect(audio.volume).toBeGreaterThan(0.25);
    expect(audio.volume).toBeLessThan(0.45);
    await vi.advanceTimersByTimeAsync(15_100);
    await paused;
    expect(audio.paused).toBe(true);
  });

  it("stops at once if the phone is locked during it", async () => {
    const { audio, player } = setup();
    await playing(audio, player);
    const paused = player.pause(30_000);
    await vi.advanceTimersByTimeAsync(5_000);
    page.hide();
    await paused;
    expect(audio.paused).toBe(true);
  });

  it("gives way to play pressed during it", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await playing(audio, player);
    const paused = player.pause(30_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const resumed = player.play();
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all([paused, resumed]);
    expect(audio.paused).toBe(false);
    expect(audio.volume).toBeCloseTo(0.7);
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

describe("Player playlists", () => {
  it("hands a recording between elements and plays a playlist through", async () => {
    const { audio, player } = setup();
    await player.select(rain);
    expect(audio.loop).toBe(false);
    await player.select(playlist);
    expect(audio.loop).toBe(false);
    expect(audio.src).toBe("/audio/piece-1.mp3");
    expect(player.track?.id).toBe("piece-1");
  });

  it("moves to the next track at each end and starts over after the last", async () => {
    const { audio, player } = setup();
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;

    const heard: string[] = [];
    for (let i = 0; i < 3; i++) {
      audio.end();
      await vi.advanceTimersByTimeAsync(10);
      heard.push(audio.src);
      expect(player.playing).toBe(true); // a track ending is not a pause
      audio.arrive();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(heard).toEqual([
      "/audio/piece-2.mp3",
      "/audio/piece-3.mp3",
      "/audio/piece-1.mp3",
    ]);
    expect(audio.paused).toBe(false);
  });

  it("stays put when a track ends while paused", async () => {
    const { audio, player } = setup();
    await player.select(playlist);
    audio.end();
    await vi.advanceTimersByTimeAsync(10);
    expect(audio.src).toBe("/audio/piece-1.mp3");
    expect(player.playing).toBe(false);
  });

  it("starts a playlist from its first track when chosen again", async () => {
    const { audio, player } = setup();
    await playing(audio, player);
    const toList = player.select(playlist);
    await vi.advanceTimersByTimeAsync(1000);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await toList;
    audio.end();
    await vi.advanceTimersByTimeAsync(10);
    expect(player.track?.id).toBe("piece-2");

    const back = player.select(rain);
    await vi.advanceTimersByTimeAsync(1000);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await back;
    const again = player.select(playlist); // the choice applies at once
    expect(player.track?.id).toBe("piece-1");
    await vi.advanceTimersByTimeAsync(1000);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await again;
    expect(audio.src).toBe("/audio/piece-1.mp3");
  });
});

describe("Player pieces", () => {
  async function listening(start = 0) {
    const ctx = setup();
    await ctx.player.select(playlist, start);
    const started = ctx.player.play();
    ctx.audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    return ctx;
  }

  it("starts a playlist at the piece it is given", async () => {
    const { audio, player } = setup();
    await player.select(playlist, 2);
    expect(player.piece).toBe(2);
    expect(audio.src).toBe("/audio/piece-3.mp3");
  });

  it("starts at the first piece given one it does not have", async () => {
    const { player } = setup();
    await player.select(playlist, 7);
    expect(player.piece).toBe(0);
  });

  it("goes back a piece, and from the first to the last, while paused", async () => {
    const { audio, player } = setup();
    await player.select(playlist, 1);
    await player.previous();
    expect(player.track?.id).toBe("piece-1");
    await player.previous();
    expect(player.track?.id).toBe("piece-3");
    expect(audio.src).toBe("/audio/piece-3.mp3");
    expect(player.playing).toBe(false);
  });

  it("starts the piece again when more than three seconds in", async () => {
    const { audio, player } = await listening(1);
    audio.tick(42);
    await player.previous();
    expect(player.track?.id).toBe("piece-2");
    expect(audio.src).toBe("/audio/piece-2.mp3");
    expect(audio.currentTime).toBe(0);
    expect(player.playing).toBe(true);
  });

  it("goes back a piece when less than three seconds in", async () => {
    const { audio, player } = await listening(1);
    audio.tick(2);
    const back = player.previous();
    await vi.advanceTimersByTimeAsync(1000);
    await back;
    expect(audio.src).toBe("/audio/piece-1.mp3");
  });

  it("plays a chosen piece, fading out the one playing", async () => {
    const { audio, player } = await listening();
    const jump = player.playPiece(2);
    expect(player.track?.id).toBe("piece-3"); // shown at once
    await vi.advanceTimersByTimeAsync(1000);
    await jump;
    expect(audio.src).toBe("/audio/piece-3.mp3");
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.playing).toBe(true);
  });

  it("leaves the piece playing when it is chosen again", async () => {
    const { audio, player } = await listening(1);
    audio.tick(42);
    await player.playPiece(1);
    expect(audio.src).toBe("/audio/piece-2.mp3");
    expect(audio.currentTime).toBe(42);
  });

  it("offers previous track on the lock screen for a playlist only", async () => {
    const { handlers } = lockScreen();
    const { player } = setup();
    await player.select(rain);
    expect(handlers.get("previoustrack")).toBeNull();
    await player.select(playlist, 1);
    handlers.get("previoustrack")!();
    expect(player.track?.id).toBe("piece-1");
  });
});

// A lock screen: records the handlers the player registers.
function lockScreen() {
  const handlers = new Map<string, (() => void) | null>();
  const session = {
    metadata: null as unknown,
    playbackState: "none",
    setActionHandler(name: string, fn: (() => void) | null) {
      handlers.set(name, fn);
    },
  };
  vi.stubGlobal("navigator", { mediaSession: session });
  vi.stubGlobal(
    "MediaMetadata",
    class {
      constructor(readonly init: { title: string; artist: string }) {}
    },
  );
  return { handlers, session };
}

const otherList: Soundscape = {
  ...playlist,
  id: "others",
  tracks: ["other-1", "other-2"].map(trackOf),
};

describe("Player lock screen and playlist edges", () => {
  it("offers next track for a playlist only, and shows the track", async () => {
    const { handlers, session } = lockScreen();
    const { player } = setup();
    await player.select(rain);
    expect(handlers.get("nexttrack")).toBeNull();
    await player.select(playlist);
    expect(handlers.get("nexttrack")).toBeTypeOf("function");
    expect((session.metadata as { init: { title: string } }).init.title).toBe(
      "piece-1",
    );
  });

  // The page's now line names the same things, from the same metadata.
  it("names a loop by its label and a piece with its playlist", async () => {
    const { session } = lockScreen();
    const { player } = setup();
    const shown = () => (session.metadata as { init: unknown }).init;
    await player.select(rain);
    expect(shown()).toEqual({
      title: "Rain",
      artist: rain.tracks[0].author,
      album: "longquiet",
    });
    await player.select(playlist);
    expect(shown()).toEqual({
      title: "piece-1",
      artist: playlist.tracks[0].author,
      album: "longquiet · Pieces",
    });
  });

  it("moves on and redraws when next track is pressed", async () => {
    const { handlers } = lockScreen();
    const { player, changes } = setup();
    await player.select(playlist);
    changes.mockClear();
    handlers.get("nexttrack")!();
    expect(player.track?.id).toBe("piece-2");
    expect(changes).toHaveBeenCalled();
  });

  it("reports nothing when next is pressed while a track still loads", async () => {
    const { handlers } = lockScreen();
    const { audio, player } = setup();
    const errors = vi.fn();
    player.onerror = errors;
    await player.select(playlist);
    const first = player.play(); // piece-1 still loading
    handlers.get("nexttrack")!();
    handlers.get("nexttrack")!();
    await vi.advanceTimersByTimeAsync(10);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);

    // The page reports a rejected play(); being overtaken is not a failure.
    await expect(first).resolves.toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
    expect(audio.src).toBe("/audio/piece-3.mp3");
    expect(player.playing).toBe(true);
  });

  it("starts a new playlist at its first track even if the old one ends mid-switch", async () => {
    const { audio, player } = setup();
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;

    const choice = player.select(otherList);
    await vi.advanceTimersByTimeAsync(200);
    audio.end(); // piece-1 runs out during the fade-out
    await vi.advanceTimersByTimeAsync(1000);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await choice;
    expect(player.track?.id).toBe("other-1");
    expect(audio.src).toBe("/audio/other-1.mp3");
  });
});

describe("Player next button", () => {
  it("fades the current piece out before moving on", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;

    const skipped = player.next();
    expect(player.track?.id).toBe("piece-2"); // shown at once
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.src).toBe("/audio/piece-1.mp3"); // still fading out
    expect(audio.volume).toBeLessThan(0.7);
    expect(audio.volume).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(400);
    await skipped;
    expect(audio.src).toBe("/audio/piece-2.mp3");
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.paused).toBe(false);
    expect(audio.volume).toBeCloseTo(0.7);
  });

  it("moves on at once while the piece is still loading", async () => {
    const { audio, player } = setup();
    await player.select(playlist);
    void player.play(); // piece-1 still loading, silent
    await player.next();
    expect(audio.src).toBe("/audio/piece-2.mp3");
  });

  it("does not skip twice when the old piece ends during the fade", async () => {
    const { audio, player } = setup();
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;

    const skipped = player.next();
    await vi.advanceTimersByTimeAsync(200);
    audio.end(); // piece-1 runs out mid-fade
    await vi.advanceTimersByTimeAsync(600);
    await skipped;
    expect(player.track?.id).toBe("piece-2");
    expect(audio.src).toBe("/audio/piece-2.mp3");
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.paused).toBe(false);
  });

  it("only moves on while paused", async () => {
    const { audio, player } = setup();
    await player.select(playlist);
    await player.next();
    expect(player.track?.id).toBe("piece-2");
    expect(audio.src).toBe("/audio/piece-2.mp3");
    expect(player.playing).toBe(false);
    expect(audio.paused).toBe(true);
  });

  it("ends a burst of presses on the last one, playing", async () => {
    const { audio, player } = setup();
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;

    void player.next();
    await vi.advanceTimersByTimeAsync(100);
    const last = player.next();
    await vi.advanceTimersByTimeAsync(100);
    // The overtaken press must not load its piece mid-fade.
    expect(audio.src).toBe("/audio/piece-1.mp3");
    await vi.advanceTimersByTimeAsync(600);
    await last;
    expect(audio.src).toBe("/audio/piece-3.mp3");
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.playing).toBe(true);
    expect(audio.paused).toBe(false);
  });

  it("does nothing for a looped recording, not even a fade", async () => {
    const { audio, player } = setup();
    player.setVolume(0.7);
    await player.select(rain);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;

    const skipped = player.next();
    let low = audio.volume;
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(20);
      low = Math.min(low, audio.volume);
    }
    await skipped;
    expect(low).toBeCloseTo(0.7);
    expect(player.track?.id).toBe(rain.tracks[0].id);
    expect(audio.src).toBe("/audio/rain.mp3");
  });
});

describe("Player loop handover", () => {
  // Rain playing on the first element, with the second primed and waiting.
  async function looping() {
    const s = setup();
    await s.player.select(rain);
    const started = s.player.play();
    s.audio.arrive();
    s.spare.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    s.audio.duration = 600;
    return s;
  }
  const overlap = rain.overlap;
  // The playing copy reaches its fade-out and the other starts and sounds.
  async function handingOver(s: Awaited<ReturnType<typeof looping>>) {
    s.audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    s.spare.arrive();
    await vi.advanceTimersByTimeAsync(0);
    s.spare.advance(0.3);
  }

  it("primes the second element on the first play, then leaves it paused", async () => {
    const { player, spare } = setup();
    await player.select(rain);
    void player.play();
    expect(spare.src).toBe("/audio/rain.mp3");
    expect(spare.muted).toBe(true);
    expect(spare.paused).toBe(false);
    spare.arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(true);
    expect(spare.muted).toBe(false);
  });

  it("does not prime again while a priming play is still under way", async () => {
    const { audio, spare, player } = setup();
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    void player.select(rain);
    const loads = spare.loads;
    await vi.advanceTimersByTimeAsync(1000);
    expect(spare.loads).toBe(loads);
    expect(spare.muted).toBe(true);
  });

  it("primes the second element at the tap that switches a playlist to a loop", async () => {
    const { audio, spare, player } = setup();
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    expect(spare.src).toBe("");
    void player.select(rain);
    expect(spare.src).toBe("/audio/rain.mp3");
    expect(spare.muted).toBe(true);
    expect(spare.paused).toBe(false);
  });

  it("starts the other copy as this one fades out, then hands over at its end", async () => {
    const s = await looping();
    const { audio, spare, player } = s;
    audio.tick(600 - overlap - 0.5);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(true);

    spare.currentTime = 123;
    await handingOver(s);
    expect(spare.paused).toBe(false);
    // From 0.2 s in (as far into its fade-in as this copy is into its
    // fade-out), then 0.3 s of playing.
    expect(spare.currentTime).toBeCloseTo(0.5);
    expect(spare.src).toBe(audio.src);

    audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.audio).toBe(spare);
    expect(player.playing).toBe(true);
    expect(audio.paused).toBe(true);
  });

  it("keeps a sounding copy past the moment a silent one is given up", async () => {
    const s = await looping();
    await handingOver(s);
    s.audio.tick(600 - overlap + 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.spare.paused).toBe(false);
    expect(s.audio.currentTime).toBe(600 - overlap + 3);
  });

  it("does not start the other copy while paused", async () => {
    const { audio, spare, player } = await looping();
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    await paused;
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(true);
  });

  it("hands over the sound now chosen, not the one it was primed with", async () => {
    const s = await looping();
    void s.player.select(forest);
    await vi.advanceTimersByTimeAsync(1000);
    s.audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    s.audio.duration = 600;
    s.audio.tick(600 - forest.overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.spare.src).toBe("/audio/forest.mp3");
    expect(s.spare.paused).toBe(false);
  });

  it("needs sound from each new copy, not just the last", async () => {
    const s = await looping();
    await handingOver(s);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    s.spare.duration = 600;
    s.spare.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    s.spare.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.audio).toBe(s.spare);
    expect(s.spare.currentTime).toBe(overlap);
  });

  it("does not switch to a copy a late priming play paused", async () => {
    const { audio, spare, player } = setup();
    await player.select(rain);
    spare.refuseNextPlay = true;
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    await paused;

    // Resumed in the copy's last seconds: priming and the handover overlap.
    audio.duration = 600;
    audio.currentTime = 600 - overlap + 0.2;
    void player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(0);
    audio.tick(600 - overlap + 0.5);
    await vi.advanceTimersByTimeAsync(0);
    spare.arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(false);
    spare.advance(0.3);
    audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.audio).toBe(spare);
    expect(player.playing).toBe(true);
    expect(player.audio.paused).toBe(false);
  });

  it("takes a copy whose clock moves as sounding, whatever its events", async () => {
    const s = await looping();
    s.audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    // WebKit after a seek: "playing", then "waiting" with no "playing" after,
    // while the clock moves on.
    s.spare.arrive();
    s.spare.stall();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.spare.readyState).toBe(2);
    s.spare.advance(2.5);
    s.audio.tick(600 - overlap + 2.7);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.spare.paused).toBe(false);
    s.spare.advance(5);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.audio).toBe(s.spare);
  });

  it("does not take over with a copy whose clock stopped", async () => {
    const s = await looping();
    await handingOver(s);
    s.audio.tick(600 - overlap + 3);
    await vi.advanceTimersByTimeAsync(0);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.audio).toBe(s.audio);
    expect(s.audio.currentTime).toBe(overlap);
  });

  it("does not take a copy started in the last second for one making sound", async () => {
    const { audio, spare, player } = await looping();
    audio.tick(600 - 0.5);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(false);
    audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.audio).toBe(audio);
  });

  it("leaves the playing copy alone when a priming play settles after the switch", async () => {
    const { audio, spare, player } = setup();
    await player.select(rain);
    spare.refuseNextPlay = true;
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    await paused;

    // Resumed late: the priming play and the handover overlap, and the
    // clock moves before the play settles.
    audio.duration = 600;
    audio.currentTime = 600 - overlap + 0.2;
    void player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(0);
    audio.tick(600 - overlap + 0.5);
    await vi.advanceTimersByTimeAsync(0);
    spare.advance(5);
    audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.audio).toBe(spare);
    spare.arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(false);
    expect(player.playing).toBe(true);
  });

  it("stops a priming play when the choice moves to a playlist", async () => {
    const { audio, spare, player } = setup();
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    void player.select(rain);
    await vi.advanceTimersByTimeAsync(1000);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    expect(spare.paused).toBe(false);
    void player.select(playlist);
    await vi.advanceTimersByTimeAsync(1000);
    expect(spare.paused).toBe(true);
  });

  it("does not switch to a copy the system paused", async () => {
    const s = await looping();
    await handingOver(s);
    s.spare.interrupt();
    await vi.advanceTimersByTimeAsync(0);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.audio).toBe(s.audio);
    expect(s.audio.paused).toBe(false);
  });

  it("blames the file a failed priming play was for", async () => {
    const { audio, spare, player } = setup();
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    void player.select(rain);
    spare.fail();
    await vi.advanceTimersByTimeAsync(1000);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    audio.duration = 600;
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.src).toBe("/audio/rain.mp3?retry=1");
    expect(spare.error).toBeNull();
  });

  it("blames the file a failed handover was for after a change of loop", async () => {
    const s = await looping();
    void s.player.select(forest);
    await vi.advanceTimersByTimeAsync(1000);
    s.audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    s.audio.duration = 600;
    s.audio.tick(600 - forest.overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    s.spare.fail();
    await vi.advanceTimersByTimeAsync(0);
    s.audio.tick(600 - forest.overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.spare.src).toBe("/audio/forest.mp3?retry=1");
  });

  it("ignores a waiting element's error outside a handover", async () => {
    const { audio, spare } = await looping();
    audio.currentTime = 100;
    spare.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.currentTime).toBe(100);
  });

  it("does not seek the playing copy for a silent handover once paused", async () => {
    const { audio, player } = await looping();
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    void player.pause(30000);
    audio.tick(600 - overlap + 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.currentTime).toBe(600 - overlap + 3);
  });

  it("takes the playing copy's own stall and recovery as no word on the other", async () => {
    const s = await looping();
    s.audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    s.audio.stall();
    s.audio.resume();
    await vi.advanceTimersByTimeAsync(0);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.audio).toBe(s.audio);

    const t = await looping();
    await handingOver(t);
    t.audio.stall();
    await vi.advanceTimersByTimeAsync(0);
    t.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.player.audio).toBe(t.spare);
  });

  it("takes over with a copy whose priming play was still under way", async () => {
    const { audio, spare, player } = setup();
    await player.select(rain);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.muted).toBe(true);
    audio.duration = 600;
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.muted).toBe(false);
    spare.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    spare.advance(0.3);
    audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.audio).toBe(spare);
    expect(spare.paused).toBe(false);
    expect(spare.muted).toBe(false);
  });

  it("hands over when a pause's fade outlasts the copy, so Play resumes one copy", async () => {
    const s = await looping();
    await handingOver(s);
    void s.player.pause(30000);
    await vi.advanceTimersByTimeAsync(5000);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.audio).toBe(s.spare);
    void s.player.play();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.spare.paused).toBe(false);
    expect(s.audio.paused).toBe(true);
  });

  it("stops both copies when a pause's fade ends after a handover", async () => {
    const s = await looping();
    await handingOver(s);
    const paused = s.player.pause(30000);
    await vi.advanceTimersByTimeAsync(5000);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(30000);
    await paused;
    expect(s.audio.paused).toBe(true);
    expect(s.spare.paused).toBe(true);
  });

  it("resumes a copy that ended while paused past its fade-in", async () => {
    const s = await looping();
    void s.player.pause(30000);
    await vi.advanceTimersByTimeAsync(1000);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.audio.currentTime).not.toBe(overlap);
    void s.player.play();
    expect(s.audio.currentTime).toBe(overlap);
    expect(s.audio.paused).toBe(false);
  });

  it("reports a copy that cannot restart itself", async () => {
    const { audio, player } = await looping();
    const errors = vi.fn();
    player.onerror = errors;
    audio.refuseNextPlay = true;
    audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.playing).toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("does not give up the old sound's handover during a change's fade-out", async () => {
    const { audio, spare, player } = await looping();
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    void player.select(forest);
    audio.tick(600 - overlap + 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.currentTime).toBe(600 - overlap + 3);
    expect(spare.paused).toBe(false);
  });

  it("keeps what the primed element has fetched rather than loading it again", async () => {
    const { audio, spare } = await looping();
    const loads = spare.loads;
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.loads).toBe(loads);
    expect(spare.paused).toBe(false);
  });

  it("hands back again at the next copy's end", async () => {
    const s = await looping();
    const { audio, spare, player } = s;
    await handingOver(s);
    audio.end();
    await vi.advanceTimersByTimeAsync(0);
    spare.duration = 600;
    spare.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.paused).toBe(false);
    audio.arrive();
    await vi.advanceTimersByTimeAsync(0);
    audio.advance(0.3);
    spare.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.audio).toBe(audio);
    expect(player.playing).toBe(true);
  });

  it("starts the other copy part-way in when this one resumed late", async () => {
    const { audio, spare } = await looping();
    audio.tick(600 - 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(false);
    expect(spare.currentTime).toBeCloseTo(overlap - 3);
  });

  it("skips this copy's fades when the other refuses to start", async () => {
    const { audio, spare, player } = await looping();
    const errors = vi.fn();
    player.onerror = errors;
    spare.refuseNextPlay = true;
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(true);
    expect(audio.currentTime).toBe(overlap);
    expect(audio.paused).toBe(false);
    expect(player.audio).toBe(audio);
    expect(player.playing).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it("gives up on a waiting element that fails, and retries it at a new URL", async () => {
    const { audio, spare, player } = await looping();
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    spare.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.currentTime).toBe(overlap);
    expect(spare.paused).toBe(true);
    expect(player.audio).toBe(audio);
    expect(player.playing).toBe(true);

    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.src).toBe("/audio/rain.mp3?retry=1");
    expect(spare.error).toBeNull();
    expect(spare.paused).toBe(false);
  });

  it("gives up on a waiting element that fails after it started sounding", async () => {
    const s = await looping();
    await handingOver(s);
    s.spare.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.audio.currentTime).toBe(overlap);
    expect(s.spare.paused).toBe(true);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.audio).toBe(s.audio);
  });

  it("gives up on a waiting element still silent after a moment", async () => {
    const { audio, spare, player } = await looping();
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    audio.tick(600 - overlap + 1.5);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(false);
    audio.tick(600 - overlap + 2.5);
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.currentTime).toBe(overlap);
    expect(spare.paused).toBe(true);
    expect(player.audio).toBe(audio);
  });

  it("does not take over with a waiting element that stalled", async () => {
    const s = await looping();
    await handingOver(s);
    s.spare.stall();
    await vi.advanceTimersByTimeAsync(0);
    s.audio.tick(600 - overlap + 3);
    await vi.advanceTimersByTimeAsync(0);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.audio).toBe(s.audio);
    expect(s.audio.currentTime).toBe(overlap);
  });

  it("ignores a stale refusal from a handover a change of sound replaced", async () => {
    const { audio, player } = await looping();
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    // The change of sound fades out, then drops the waiting element, whose
    // pending play() rejects after the handover is gone.
    void player.select(forest);
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.src).toBe("/audio/forest.mp3");
    expect(audio.currentTime).toBeCloseTo(600 - overlap + 0.2);
  });

  it("does not hand over to an element that never sounded", async () => {
    const { audio, spare, player } = await looping();
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.audio).toBe(audio);
    expect(audio.currentTime).toBe(overlap);
    expect(audio.paused).toBe(false);
    expect(spare.paused).toBe(true);
    expect(player.playing).toBe(true);
  });

  it("retries an element that failed while being primed", async () => {
    const s = setup();
    await s.player.select(rain);
    void s.player.play();
    s.audio.arrive();
    s.spare.fail();
    await vi.advanceTimersByTimeAsync(1000);
    s.audio.duration = 600;
    s.audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    s.spare.arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.spare.src).toBe("/audio/rain.mp3?retry=1");
    s.spare.advance(0.3);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.audio).toBe(s.spare);
  });

  it("primes again on the next play if priming was refused", async () => {
    const { audio, spare, player } = setup();
    await player.select(rain);
    spare.refuseNextPlay = true;
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    expect(spare.muted).toBe(false);
    const paused = player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    await paused;
    void player.play();
    expect(spare.muted).toBe(true);
    expect(spare.paused).toBe(false);
  });

  it("clears the loading state when the other copy takes over", async () => {
    const s = await looping();
    s.audio.stall();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.loading).toBe(true);
    await handingOver(s);
    s.audio.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.loading).toBe(false);
  });

  it("stops both copies on a pause mid-handover", async () => {
    const s = await looping();
    await handingOver(s);
    const paused = s.player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    await paused;
    expect(s.audio.paused).toBe(true);
    expect(s.spare.paused).toBe(true);
  });

  it("stops both copies when the system pauses mid-handover", async () => {
    const s = await looping();
    await handingOver(s);
    s.audio.interrupt();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.playing).toBe(false);
    expect(s.spare.paused).toBe(true);
  });

  it("stops both copies when the playing one fails mid-handover", async () => {
    const s = await looping();
    await handingOver(s);
    s.audio.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.player.playing).toBe(false);
    expect(s.spare.paused).toBe(true);
  });

  it("stops both copies on a change of sound mid-handover", async () => {
    const s = await looping();
    await handingOver(s);
    void s.player.select(forest);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.spare.paused).toBe(true);
    expect(s.audio.src).toBe("/audio/forest.mp3");
  });

  it("does not hand over the old sound during a change's fade-out", async () => {
    const { audio, spare, player } = await looping();
    void player.select(forest);
    audio.tick(600 - overlap + 0.2);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(true);
  });

  it("fades both copies together", async () => {
    const s = await looping();
    await handingOver(s);
    void s.player.pause();
    await vi.advanceTimersByTimeAsync(300);
    expect(s.audio.volume).toBeGreaterThan(0);
    expect(s.audio.volume).toBeLessThan(1);
    expect(s.spare.volume).toBe(s.audio.volume);
  });

  it("finishes both copies' fade when the page is hidden", async () => {
    const s = await looping();
    await handingOver(s);
    void s.player.pause();
    await vi.advanceTimersByTimeAsync(300);
    page.hide();
    expect(s.audio.volume).toBe(0);
    expect(s.spare.volume).toBe(0);
  });

  it("sets both copies' level at once on a hidden page", async () => {
    const s = await looping();
    await handingOver(s);
    page.hide();
    void s.player.pause();
    expect(s.spare.volume).toBe(0);
  });

  it("sets both copies' volume", async () => {
    const s = await looping();
    await handingOver(s);
    s.player.setVolume(0.5);
    expect(s.audio.volume).toBe(0.5);
    expect(s.spare.volume).toBe(0.5);
  });

  it("does not hand over a playlist track", async () => {
    const { audio, spare, player } = setup();
    await player.select(playlist);
    const started = player.play();
    audio.arrive();
    await vi.advanceTimersByTimeAsync(1000);
    await started;
    audio.duration = 300;
    audio.tick(300);
    await vi.advanceTimersByTimeAsync(0);
    expect(spare.paused).toBe(true);
    expect(spare.src).toBe("");
  });
});
