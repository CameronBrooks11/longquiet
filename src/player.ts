import type { Soundscape } from "./catalogue";

const FADE_MS = 600;

// One looping <audio> element. A plain media element, rather than Web Audio,
// is what phones keep playing with the screen locked.
export class Player {
  private target = 1;
  private wanted = false;
  private waiting = false;
  // Set when our own play() call will cause the element's next "play" event.
  private ownPlay = false;
  // Failures per file. Chrome keeps a failed response for a URL for the
  // life of the page, so a retry asks for the same file at a new URL.
  private failures = new Map<string, number>();
  // The sound whose file the element holds; during a switch's fade-out
  // that is still the old one, while current is already the new one.
  private loaded: Soundscape | null = null;
  private fade = 0;
  private endFade: (() => void) | null = null;
  private fadeTarget = 0;
  private current: Soundscape | null = null;
  // Bumped by every select, so a slower, older one can tell it was overtaken.
  private seq = 0;
  onchange: () => void = () => {};
  onerror: (err: unknown) => void = () => {};

  constructor(
    private readonly baseUrl: string,
    readonly audio: HTMLAudioElement = new Audio(),
  ) {
    this.audio.loop = true;
    this.audio.preload = "none";
    // The system can pause or resume behind our back: unplugged headphones,
    // a phone call, a hardware media key.
    this.audio.addEventListener("pause", () => {
      if (this.wanted) {
        this.cancelFade();
        this.audio.volume = this.target;
        this.setWanted(false);
      }
    });
    this.audio.addEventListener("play", () => {
      if (this.ownPlay) {
        this.ownPlay = false;
        return;
      }
      if (!this.wanted) {
        this.audio.volume = this.target;
        this.setWanted(true);
      }
    });
    // Fades run on animation frames, which stop once the page is hidden: a
    // phone locked as a sound starts would hold the fade wherever it was,
    // possibly near silence. Finish any fade at once instead.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.finishFade();
    });
    // Between asking to play and sound coming out: first load, or a stall.
    this.audio.addEventListener("waiting", () => this.setWaiting(this.wanted));
    this.audio.addEventListener("playing", () => this.setWaiting(false));
    // A load or network failure, at the start or mid-play. load() clears the
    // error and resets the element: until then play() would reject at once,
    // and a dropped connection is not refetched, so a retry would never work.
    // An error while paused is not reported, but the reset still matters:
    // a new src clears the error (as load() would) and points the next play
    // past the failed response.
    this.audio.addEventListener("error", () => {
      const err = this.audio.error;
      const wanted = this.wanted;
      this.cancelFade();
      this.audio.volume = this.target;
      if (wanted) this.setWanted(false);
      if (this.loaded) {
        const f = this.loaded.file;
        this.failures.set(f, (this.failures.get(f) ?? 0) + 1);
      }
      if (this.current) {
        this.load(this.current);
      } else {
        this.audio.load();
      }
      if (wanted) this.onerror(err);
    });
  }

  // What the listener asked for, which leads the element during a fade.
  get playing(): boolean {
    return this.wanted;
  }

  // Playback was asked for but no sound is coming out yet.
  get loading(): boolean {
    return this.wanted && this.waiting;
  }

  get soundscape(): Soundscape | null {
    return this.current;
  }

  // iOS ignores element volume (it is always 1, the hardware buttons rule).
  static volumeIsControllable(): boolean {
    const probe = new Audio();
    probe.volume = 0.5;
    return probe.volume === 0.5;
  }

  setVolume(v: number) {
    this.target = v;
    if (!this.fade) this.audio.volume = v;
  }

  // The choice takes effect at once (UI, Media Session); the element follows
  // after the fade-out, and only if no newer choice has come in meanwhile.
  async select(s: Soundscape) {
    if (this.current?.id === s.id) return;
    const seq = ++this.seq;
    const resume = this.wanted;
    this.current = s;
    this.updateMediaSession();
    this.onchange();
    if (resume) await this.fadeTo(0);
    if (seq !== this.seq) return;
    this.load(s);
    if (resume && this.wanted) await this.play();
  }

  async play() {
    if (!this.current) return;
    const seq = this.seq;
    this.setWanted(true);
    if (this.audio.paused) {
      this.audio.volume = 0;
      this.setWaiting(true);
      this.ownPlay = true;
      try {
        await this.audio.play();
      } catch (err) {
        // No "play" event follows a rejection, unless a newer play() set the
        // flag for its own.
        if (seq === this.seq) this.ownPlay = false;
        // Already handled: a newer select changed the source, the listener
        // paused before anything loaded, or the "error" listener reported a
        // failed load. Anything else (say, autoplay refused) is reported here.
        if (seq !== this.seq || !this.wanted) return;
        this.setWanted(false);
        throw err;
      }
    }
    if (seq !== this.seq) return;
    await this.fadeTo(this.target);
  }

  async pause() {
    this.setWanted(false);
    await this.fadeTo(0);
    if (!this.wanted) {
      this.audio.pause();
      this.audio.volume = this.target;
    }
  }

  private load(s: Soundscape) {
    this.loaded = s;
    this.audio.src = this.srcFor(s);
  }

  private srcFor(s: Soundscape): string {
    const n = this.failures.get(s.file);
    return `${this.baseUrl}audio/${s.file}${n ? `?retry=${n}` : ""}`;
  }

  toggle(): Promise<void> {
    return this.wanted ? this.pause() : this.play();
  }

  private setWaiting(w: boolean) {
    if (this.waiting === w) return;
    this.waiting = w;
    this.onchange();
  }

  private setWanted(w: boolean) {
    this.wanted = w;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = w ? "playing" : "paused";
    }
    this.onchange();
  }

  // Animation frames stop while the page is hidden, so a lock-screen pause
  // jumps straight to the end rather than waiting for a frame that never comes.
  private fadeTo(to: number): Promise<void> {
    this.cancelFade();
    if (document.hidden) {
      this.audio.volume = to;
      return Promise.resolve();
    }
    const from = this.audio.volume;
    const start = performance.now();
    this.fadeTarget = to;
    return new Promise((resolve) => {
      this.endFade = resolve;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / FADE_MS);
        this.audio.volume = from + (to - from) * t;
        if (t < 1) {
          this.fade = requestAnimationFrame(step);
        } else {
          this.fade = 0;
          this.endFade = null;
          resolve();
        }
      };
      this.fade = requestAnimationFrame(step);
    });
  }

  private finishFade() {
    if (!this.fade) return;
    this.audio.volume = this.fadeTarget;
    this.cancelFade();
  }

  private cancelFade() {
    cancelAnimationFrame(this.fade);
    this.fade = 0;
    this.endFade?.();
    this.endFade = null;
  }

  private updateMediaSession() {
    if (!("mediaSession" in navigator) || !this.current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.current.label,
      artist: `${this.current.title} — ${this.current.author}`,
      album: "longquiet",
    });
    navigator.mediaSession.setActionHandler("play", () => void this.play());
    navigator.mediaSession.setActionHandler("pause", () => void this.pause());
  }
}
