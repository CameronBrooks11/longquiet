import type { Soundscape, Track } from "./catalogue";

const FADE_MS = 600;
// Fades step on timers, not animation frames: frames stall in a visible but
// occluded or unfocused window (measured: a fade-up stuck at 0 for 800 ms),
// while timers keep running there.
const FADE_STEP_MS = 20;

// One <audio> element, looping a recording or playing through a playlist. A
// plain media element, rather than Web Audio, is what phones keep playing
// with the screen locked. A loop uses a second element too: an element
// looping itself goes briefly silent at each restart on iOS Safari (#34), so
// the copies take turns instead, each starting as the other reaches its last
// few seconds. The files fade in and out over exactly that overlap, so the
// two sum to a crossfade, and being a fraction of a second late is inaudible.
export class Player {
  private target = 1;
  private wanted = false;
  private waiting = false;
  // Set when our own play() call will cause the element's next "play" event.
  private ownPlay = false;
  // Failures per file. Chrome keeps a failed response for a URL for the
  // life of the page, so a retry asks for the same file at a new URL.
  private failures = new Map<string, number>();
  // The track whose file the element holds; during a switch's fade-out
  // that is still the old one, while current is already the new choice.
  private loaded: Track | null = null;
  private fade: ReturnType<typeof setTimeout> | undefined;
  private endFade: (() => void) | null = null;
  private fadeTarget = 0;
  private current: Soundscape | null = null;
  // Position in the current choice's tracks; always 0 for a looped recording.
  private trackIndex = 0;
  // Bumped by every select, so a slower, older one can tell it was overtaken.
  private seq = 0;
  // The two elements; the one at `active` is the element everything else
  // drives, and the other waits to take over at a loop's end.
  private readonly els: readonly [HTMLAudioElement, HTMLAudioElement];
  private active = 0;
  // The waiting element has been started for the current copy's end.
  private handingOver = false;
  // The waiting element has played once on a tap, which iOS requires before
  // it may start later on its own with the screen locked.
  private primed = false;
  onchange: () => void = () => {};
  onerror: (err: unknown) => void = () => {};

  constructor(
    private readonly baseUrl: string,
    audio: HTMLAudioElement = new Audio(),
    spare: HTMLAudioElement = new Audio(),
  ) {
    this.els = [audio, spare];
    for (const el of this.els) {
      el.loop = false;
      el.preload = "none";
      this.listen(el);
    }
    // A hidden page's timers may be throttled or the page suspended (Firefox,
    // iOS, page freezing), so a phone locked as a sound starts could hold the
    // fade wherever it was, possibly near silence. Finish any fade at once.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.finishFade();
    });
  }

  // The element now playing, or about to.
  get audio(): HTMLAudioElement {
    return this.els[this.active];
  }

  // Both elements, for listeners that must follow whichever is playing.
  get elements(): readonly HTMLAudioElement[] {
    return this.els;
  }

  private get spare(): HTMLAudioElement {
    return this.els[1 - this.active];
  }

  // Each listener answers only for the active element; the waiting one's
  // events are its own business, apart from the clock that starts it.
  private listen(el: HTMLAudioElement) {
    const on = (type: string, fn: () => void) =>
      el.addEventListener(type, () => {
        if (el === this.audio) fn();
      });
    // The system can pause or resume behind our back: unplugged headphones,
    // a phone call, a hardware media key.
    // A playlist track reaching its end also fires "pause"; that is not one.
    on("pause", () => {
      if (this.wanted && !this.audio.ended) {
        this.cancelFade();
        this.dropSpare();
        this.setLevel(this.target);
        this.setWanted(false);
      }
    });
    on("play", () => {
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
    on("waiting", () => this.setWaiting(this.wanted));
    on("playing", () => this.setWaiting(false));
    // A loop's copy has ended: the other element carries on. A playlist moves
    // on to its next track, and starts over after the last. Neither when the
    // element still holds the previous choice, ending during a switch's
    // fade-out.
    on("ended", () => {
      if (!this.wanted || !this.current) return;
      if (this.loaded !== this.track) return;
      if (this.current.loops) this.loopOver();
      else void this.next();
    });
    on("timeupdate", () => this.handOver());
    // A load or network failure, at the start or mid-play. load() clears the
    // error and resets the element: until then play() would reject at once,
    // and a dropped connection is not refetched, so a retry would never work.
    // An error while paused is not reported, but the reset still matters:
    // a new src clears the error (as load() would) and points the next play
    // past the failed response.
    on("error", () => {
      const err = this.audio.error;
      const wanted = this.wanted;
      this.cancelFade();
      this.dropSpare();
      this.setLevel(this.target);
      if (wanted) this.setWanted(false);
      if (this.loaded) {
        const f = this.loaded.file;
        this.failures.set(f, (this.failures.get(f) ?? 0) + 1);
      }
      if (this.current) {
        this.loadTrack();
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

  // What is playing now: the recording, or the playlist's current track.
  get track(): Track | null {
    return this.current?.tracks[this.trackIndex] ?? null;
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
    if (this.fade === undefined) this.setLevel(v);
    // A fade-in in progress heads for the new level instead of the old one.
    else if (this.fadeTarget > 0) this.fadeTarget = v;
  }

  // The choice takes effect at once (UI, Media Session); the element follows
  // after the fade-out, and only if no newer choice has come in meanwhile.
  async select(s: Soundscape) {
    if (this.current?.id === s.id) return;
    const seq = ++this.seq;
    const resume = this.wanted;
    this.current = s;
    this.trackIndex = 0;
    // Before the fade's await, while a tap that chose a loop still counts.
    if (resume) this.prime();
    this.updateMediaSession();
    this.onchange();
    if (resume) await this.fadeTo(0);
    if (seq !== this.seq) return;
    this.dropSpare();
    this.loadTrack();
    if (resume && this.wanted) await this.play();
  }

  // The next track of a playlist, wrapping round: the page's next button
  // and the lock screen's "next track". It fades in like any start; while
  // paused it only moves on.
  async next() {
    if (!this.current || this.current.loops) return;
    // A new source aborts any play() still waiting on the old one; bumping
    // seq marks that one as overtaken rather than a failure to report.
    const seq = ++this.seq;
    this.trackIndex = (this.trackIndex + 1) % this.current.tracks.length;
    this.updateMediaSession();
    this.onchange();
    // Skipping mid-piece fades out first, as a change of sound does; at a
    // track's natural end, or while nothing is audible yet, there is
    // nothing to fade.
    if (this.wanted && !this.audio.ended && this.audio.volume > 0) {
      await this.fadeTo(0);
    }
    if (seq !== this.seq) return;
    this.dropSpare();
    this.loadTrack();
    if (this.wanted) this.play().catch((err: unknown) => this.onerror(err));
  }

  async play() {
    if (!this.current) return;
    const seq = this.seq;
    this.setWanted(true);
    this.prime();
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

  // A sleep timer passes a long fade; a hidden page still stops at once.
  async pause(fadeMs = FADE_MS) {
    this.setWanted(false);
    await this.fadeTo(0, fadeMs);
    if (!this.wanted) {
      this.audio.pause();
      this.dropSpare();
      this.setLevel(this.target);
    }
  }

  private loadTrack() {
    const t = this.track;
    if (!this.current || !t) return;
    this.loaded = t;
    this.audio.loop = this.current.loops && this.current.overlap === 0;
    this.audio.src = this.srcFor(t);
  }

  // Start the waiting element once the playing copy is into its fade-out.
  private handOver() {
    const overlap = this.current?.overlap ?? 0;
    if (!this.wanted || overlap <= 0 || this.handingOver) return;
    if (this.loaded !== this.track) return;
    const a = this.audio;
    if (!(a.duration - a.currentTime <= overlap)) return;
    this.handingOver = true;
    const b = this.spare;
    if (b.src !== a.src) b.src = a.src;
    b.currentTime = 0;
    b.volume = a.volume;
    // Refused: this copy plays out and restarts itself, with the gap.
    b.play().catch(() => {});
  }

  // The playing copy has ended. The other one takes over if it started;
  // otherwise this one starts again, as a plain loop would.
  private loopOver() {
    const started = this.handingOver && !this.spare.paused;
    this.handingOver = false;
    if (started) {
      this.active = 1 - this.active;
      return;
    }
    this.audio.currentTime = 0;
    this.audio.play().catch((err: unknown) => {
      if (!this.wanted) return;
      this.setWanted(false);
      this.onerror(err);
    });
  }

  // Play the waiting element once, silently, while this call can still count
  // as the listener's tap; then it may start on its own later.
  private prime() {
    const t = this.track;
    if (this.primed || !this.current?.loops || !t) return;
    this.primed = true;
    const b = this.spare;
    b.src = this.srcFor(t);
    b.muted = true;
    b.play().then(
      () => {
        if (!this.handingOver) b.pause();
        b.muted = false;
      },
      () => {
        b.muted = false;
      },
    );
  }

  private dropSpare() {
    this.handingOver = false;
    this.spare.pause();
  }

  // Both elements follow the level, so a fade covers a handover in progress.
  private setLevel(v: number) {
    this.audio.volume = v;
    this.spare.volume = v;
  }

  private srcFor(s: Track): string {
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

  // A hidden page's timers barely run, so a lock-screen pause jumps straight
  // to the end rather than waiting on a throttled fade.
  private fadeTo(to: number, ms = FADE_MS): Promise<void> {
    this.cancelFade();
    if (document.hidden) {
      this.setLevel(to);
      return Promise.resolve();
    }
    const from = this.audio.volume;
    const start = performance.now();
    this.fadeTarget = to;
    return new Promise((resolve) => {
      this.endFade = resolve;
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / ms);
        this.setLevel(from + (this.fadeTarget - from) * t);
        if (t < 1) {
          this.fade = setTimeout(step, FADE_STEP_MS);
        } else {
          this.fade = undefined;
          this.endFade = null;
          resolve();
        }
      };
      this.fade = setTimeout(step, FADE_STEP_MS);
    });
  }

  private finishFade() {
    if (this.fade === undefined) return;
    this.setLevel(this.fadeTarget);
    this.cancelFade();
  }

  private cancelFade() {
    clearTimeout(this.fade);
    this.fade = undefined;
    this.endFade?.();
    this.endFade = null;
  }

  private updateMediaSession() {
    const t = this.track;
    if (!("mediaSession" in navigator) || !this.current || !t) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.current.loops ? this.current.label : t.title,
      artist: this.current.loops ? `${t.title} — ${t.author}` : t.author,
      album: this.current.loops
        ? "longquiet"
        : `longquiet · ${this.current.label}`,
    });
    navigator.mediaSession.setActionHandler("play", () => void this.play());
    navigator.mediaSession.setActionHandler("pause", () => void this.pause());
    navigator.mediaSession.setActionHandler(
      "nexttrack",
      this.current.loops ? null : () => void this.next(),
    );
  }
}
