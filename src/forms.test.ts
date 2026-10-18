import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../.github/ISSUE_TEMPLATE/", import.meta.url);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// The issue forms the page links to, and the label each applies.
const forms = [
  ["bug.yml", "bug"],
  ["feature.yml", "enhancement"],
  ["sound.yml", "sound request"],
] as const;

describe("issue forms", () => {
  it.each(forms)("%s applies the %s label", (file, label) => {
    const url = new URL(file, dir);
    expect(existsSync(url)).toBe(true);
    const yml = readFileSync(url, "utf8");
    expect(yml).toMatch(new RegExp(`^labels: \\["${label}"\\]$`, "m"));
  });

  it.each(forms)("the page links to %s", (file) => {
    expect(html).toContain(
      `https://github.com/CameronBrooks11/longquiet/issues/new?template=${file}`,
    );
  });

  it("offers no blank issue", () => {
    const url = new URL("config.yml", dir);
    expect(existsSync(url)).toBe(true);
    expect(readFileSync(url, "utf8")).toMatch(/^blank_issues_enabled: false$/m);
  });
});
