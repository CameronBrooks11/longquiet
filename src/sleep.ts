// A sleep timer. It counts only while playing: one set while paused starts
// with playback, and pausing cancels it. The deadline is wall-clock time, so
// it holds however irregularly a locked phone lets the checks run.
export class SleepTimer {
  private minutes = 0;
  private deadline: number | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  get on(): boolean {
    return this.minutes > 0;
  }

  // 0 turns it off.
  set(minutes: number, playing: boolean) {
    this.minutes = minutes;
    this.deadline = null;
    if (playing) this.started();
  }

  started() {
    if (this.minutes > 0 && this.deadline === null) {
      this.deadline = this.now() + this.minutes * 60_000;
    }
  }

  cancel() {
    this.set(0, false);
  }

  // Milliseconds left, or null when off. Not counting down until playback.
  remaining(): number | null {
    if (!this.on) return null;
    if (this.deadline === null) return this.minutes * 60_000;
    return Math.max(0, this.deadline - this.now());
  }

  // True once, when the time is up; the timer is then off.
  expire(): boolean {
    if (this.deadline === null || this.now() < this.deadline) return false;
    this.cancel();
    return true;
  }
}

export function remainingLabel(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  return minutes > 1 ? `${minutes} min left` : "under a minute left";
}
