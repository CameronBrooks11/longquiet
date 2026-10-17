import { describe, expect, it } from "vitest";
import { remainingLabel, SleepTimer } from "./sleep";

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

describe("SleepTimer", () => {
  it("is off until set", () => {
    const t = new SleepTimer(clock().now);
    expect(t.on).toBe(false);
    expect(t.waiting).toBe(false);
    expect(t.remaining()).toBeNull();
    expect(t.expire()).toBe(false);
  });

  it("counts down from when it is set during playback", () => {
    const c = clock();
    const t = new SleepTimer(c.now);
    t.set(15, true);
    c.t += 5 * 60_000;
    expect(t.remaining()).toBe(10 * 60_000);
    expect(t.expire()).toBe(false);
  });

  it("expires once at the deadline, then is off", () => {
    const c = clock();
    const t = new SleepTimer(c.now);
    t.set(15, true);
    c.t += 15 * 60_000 - 1;
    expect(t.expire()).toBe(false);
    c.t += 1;
    expect(t.expire()).toBe(true);
    expect(t.on).toBe(false);
    expect(t.expire()).toBe(false);
  });

  it("expires late checks at once, however long the gap", () => {
    const c = clock();
    const t = new SleepTimer(c.now);
    t.set(30, true);
    c.t += 4 * 60 * 60_000; // a locked phone ran no checks for hours
    expect(t.remaining()).toBe(0);
    expect(t.expire()).toBe(true);
  });

  it("set while paused waits for playback to start counting", () => {
    const c = clock();
    const t = new SleepTimer(c.now);
    t.set(30, false);
    expect(t.waiting).toBe(true);
    c.t += 20 * 60_000;
    expect(t.remaining()).toBe(30 * 60_000);
    expect(t.expire()).toBe(false);
    t.started();
    expect(t.waiting).toBe(false);
    c.t += 30 * 60_000;
    expect(t.expire()).toBe(true);
  });

  it("does not restart the countdown when playback resumes", () => {
    const c = clock();
    const t = new SleepTimer(c.now);
    t.set(15, true);
    c.t += 10 * 60_000;
    t.started();
    expect(t.remaining()).toBe(5 * 60_000);
  });

  it("choosing another length restarts from now; 0 or cancel turns it off", () => {
    const c = clock();
    const t = new SleepTimer(c.now);
    t.set(15, true);
    c.t += 10 * 60_000;
    t.set(60, true);
    expect(t.remaining()).toBe(60 * 60_000);
    t.set(0, true);
    expect(t.on).toBe(false);
    t.set(15, true);
    t.cancel();
    expect(t.on).toBe(false);
    c.t += 15 * 60_000;
    expect(t.expire()).toBe(false);
  });
});

describe("remainingLabel", () => {
  it("rounds up to whole minutes", () => {
    expect(remainingLabel(15 * 60_000)).toBe("15 min left");
    expect(remainingLabel(14 * 60_000 + 1)).toBe("15 min left");
    expect(remainingLabel(2 * 60_000)).toBe("2 min left");
  });

  it("shows the last minute as 1 min, never 0", () => {
    expect(remainingLabel(60_000)).toBe("1 min left");
    expect(remainingLabel(1)).toBe("1 min left");
    expect(remainingLabel(0)).toBe("1 min left");
  });
});
