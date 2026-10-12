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
  private fade = 0;
  private endFade: (() => void) | null = null;
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
    // Between asking to play and sound coming out: first load, or a stall.
    this.audio.addEventListener("waiting", () => this.setWaiting(this.wanted));
    this.audio.addEventListener("playing", () => this.setWaiting(false));
    // A network or decode failure after play() had already resolved.
    this.audio.addEventListener("error", () => {
      if (!this.wanted) return;
      this.cancelFade();
      this.audio.volume = this.target;
      this.setWanted(false);
      this.onerror(this.audio.error);
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
    this.audio.src = `${this.baseUrl}audio/${s.file}`;
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
        // A newer select changed the source, which aborts this play();
        // that select starts its own, so this is not a failure to report.
        if (seq !== this.seq) return;
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
