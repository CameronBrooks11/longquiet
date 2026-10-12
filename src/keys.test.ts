import { describe, expect, it } from "vitest";
import { moveIndex } from "./keys";

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
