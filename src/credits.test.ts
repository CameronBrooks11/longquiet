import { readFileSync } from "node:fs";
import { format } from "prettier";
import { expect, it } from "vitest";
import { playlistSummary, sections, soundscapes } from "./catalogue";
import { creditsMarkdown } from "./credits";

// Formatted as `just fmt` would, so the file passes the format check. A
// mismatch means sounds.json changed: run `just credits`.
it("sounds/CREDITS.md is generated from sounds.json", async () => {
  const md = await format(creditsMarkdown(sections, soundscapes), {
    parser: "markdown",
    proseWrap: "preserve",
  });
  await expect(md).toMatchFileSnapshot("../sounds/CREDITS.md");
});

// The README's counts and lengths, so a new sound cannot leave them stale.
it("the README's counts match the catalogue", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const loops = soundscapes.filter((s) => s.loops);
  expect(readme).toContain(`**Nature:** ${loops.length} recordings`);
  for (const s of soundscapes.filter((x) => !x.loops)) {
    const [pieces, minutes] = playlistSummary(s).split(" · ");
    expect(readme).toContain(`${s.label}: ${pieces}, ${minutes}`);
  }
});
