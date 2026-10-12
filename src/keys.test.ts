import { describe, expect, it } from "vitest";
import { moveIndex, tabStop } from "./keys";

describe("moveIndex", () => {
  it.each([
    ["ArrowRight", 1, 2],
    ["ArrowDown", 1, 2],
    ["ArrowLeft", 1, 0],
    ["ArrowUp", 1, 0],
    ["Home", 2, 0],
    ["End", 0, 3],
  ])("%s from %i goes to %i", (key, from, to) => {
    expect(moveIndex(from, key, 4)).toBe(to);
  });

  it("wraps at both ends", () => {
    expect(moveIndex(3, "ArrowRight", 4)).toBe(0);
    expect(moveIndex(0, "ArrowLeft", 4)).toBe(3);
  });

  it("ignores other keys", () => {
    expect(moveIndex(1, "Enter", 4)).toBeNull();
    expect(moveIndex(1, " ", 4)).toBeNull();
    expect(moveIndex(1, "Tab", 4)).toBeNull();
  });
});

describe("moveIndex in a horizontal tab list", () => {
  it("moves on Left and Right only", () => {
    expect(moveIndex(1, "ArrowRight", 4, false)).toBe(2);
    expect(moveIndex(1, "ArrowLeft", 4, false)).toBe(0);
    expect(moveIndex(1, "ArrowDown", 4, false)).toBeNull();
    expect(moveIndex(1, "ArrowUp", 4, false)).toBeNull();
    expect(moveIndex(1, "End", 4, false)).toBe(3);
  });
});

describe("tabStop", () => {
  it("stays on the selected item when it is shown", () => {
    expect(tabStop(["a", "b", "c"], "b")).toBe("b");
  });

  it("falls back to the first shown when the selected one is elsewhere", () => {
    expect(tabStop(["d", "e"], "b")).toBe("d");
    expect(tabStop(["d", "e"], null)).toBe("d");
  });

  it("has none to give for an empty group", () => {
    expect(tabStop([], "b")).toBeNull();
  });
});
