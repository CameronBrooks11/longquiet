import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { soundscapes } from "./catalogue";
import { Player } from "./player";

// The parts of <audio> the player relies on: play() stays pending until the
// file has loaded, and changing src aborts a pending play() and pauses.
class FakeAudio {
  paused = true;
  volume = 1;
  loop = false;
  preload = "";
  private source = "";
  private pending: { resolve: () => void; reject: (e: Error) => void } | null =
    null;

  get src() {
    return this.source;
  }
  keepsPlayingOnSrcChange = false;
  set src(v: string) {
    this.source = v;
    if (!this.keepsPlayingOnSrcChange) this.paused = true;
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.reject(new DOMException("interrupted by a new load", "AbortError"));
    }
  }
  addEventListener() {}
  play() {
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }
  pause() {
    this.paused = true;
  }
  load() {
    const p = this.pending;
    this.pending = null;
    this.paused = false;
    p?.resolve();
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

  it("fades the last of a burst back up while the element plays on", async () => {
    // Chrome keeps a playing element playing across a src change.
    const { audio, player } = setup();
    await playing(audio, player);
    audio.keepsPlayingOnSrcChange = true;
    player.setVolume(0.7);

    // Key repeat: each press is its own event, a couple of ms apart.
    const all: Promise<void>[] = [];
    for (const s of [forest, stream, night, rain, forest, stream, night]) {
      all.push(player.select(s));
      await vi.advanceTimersByTimeAsync(2);
    }
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(all);

    expect(audio.src).toBe("/audio/night.mp3");
    expect(player.playing).toBe(true);
    expect(audio.volume).toBeCloseTo(0.7);
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

  it("still reports a real failure to start", async () => {
    const { audio, player } = setup();
    await player.select(rain);
    const started = player.play();
    audio.src = "/audio/rain.mp3"; // a reload fails the only pending play()
    await expect(started).rejects.toThrow("interrupted");
    expect(player.playing).toBe(false);
  });
});
