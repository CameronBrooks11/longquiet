import { readFileSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";

interface Item {
  id: string;
  label: string;
  section: string;
  tracks?: { id: string; title: string }[];
}
const manifest = JSON.parse(
  readFileSync(new URL("../sounds/sounds.json", import.meta.url), "utf8"),
) as { sections: { id: string; label: string }[]; sounds: Item[] };
const items = manifest.sounds;
const sections = manifest.sections.filter((s) =>
  items.some((i) => i.section === s.id),
);
const playlist = items.find((i) => i.tracks)!;
const playlistSection = sections.find((s) => s.id === playlist.section)!;

// Every test's page keeps a handle on the player's element, which is never
// in the DOM, and fails the test on any console error or uncaught exception.
const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        (window as unknown as { audio: HTMLMediaElement }).audio = this;
        return play.call(this);
      };
    });
    await use(page);
    expect(errors, "console errors").toEqual([]);
  },
});

function audio(page: Page) {
  return page.evaluate(() => {
    const a = (window as unknown as { audio?: HTMLMediaElement }).audio;
    if (!a) return null;
    return {
      file: a.src.split("/").pop()!.split("?")[0],
      time: a.currentTime,
      duration: a.duration,
      paused: a.paused,
      loop: a.loop,
    };
  });
}

// Sound coming out: the element plays and its clock moves.
async function expectAdvancing(page: Page) {
  const start = (await audio(page))?.time ?? 0;
  await expect
    .poll(async () => (await audio(page))?.time ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(start + 1);
  expect((await audio(page))?.paused).toBe(false);
}

test("shows every populated section, its sounds and every credit", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByRole("tab")).toHaveText(sections.map((s) => s.label));
  for (const s of sections) {
    await page.getByRole("tab", { name: s.label }).click();
    await expect(page.getByRole("tab", { name: s.label })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("radio")).toHaveText(
      items.filter((i) => i.section === s.id).map((i) => i.label),
    );
  }
  const files = items.reduce((n, i) => n + (i.tracks?.length ?? 1), 0);
  await expect(page.locator("#credits > li")).toHaveCount(files);
});

test("plays a loop, switches sound while playing, and pauses", async ({
  page,
}) => {
  await page.goto("./");
  const [first, second] = items.filter((i) => !i.tracks);
  await page.getByRole("radio", { name: first.label }).click();
  await page.locator("#play").click();
  await expect(page.locator("body")).toHaveClass(/is-playing/);
  await expectAdvancing(page);
  expect(await audio(page)).toMatchObject({
    file: `${first.id}.mp3`,
    loop: true,
  });

  await page.getByRole("radio", { name: second.label }).click();
  await expect
    .poll(async () => (await audio(page))?.file)
    .toBe(`${second.id}.mp3`);
  await expectAdvancing(page);

  await page.locator("#play").click();
  await expect(page.locator("body")).not.toHaveClass(/is-playing/);
  await expect.poll(async () => (await audio(page))?.paused).toBe(true);
});

test("a playlist moves on to its next piece at the end of one", async ({
  page,
}) => {
  const [one, two] = playlist.tracks!;
  await page.goto("./");
  await page.getByRole("tab", { name: playlistSection.label }).click();
  await page.getByRole("radio", { name: playlist.label }).click();
  await page.locator("#play").click();
  await expectAdvancing(page);
  expect(await audio(page)).toMatchObject({
    file: `${one.id}.mp3`,
    loop: false,
  });
  await expect(page.locator("#now")).toContainText(one.title);

  await page.evaluate(() => {
    const a = (window as unknown as { audio: HTMLMediaElement }).audio;
    a.currentTime = a.duration - 1.5;
  });
  await expect
    .poll(async () => (await audio(page))?.file, { timeout: 20_000 })
    .toBe(`${two.id}.mp3`);
  await expectAdvancing(page);
  await expect(page.locator("#now")).toContainText(two.title);
  await expect(page.locator("body")).toHaveClass(/is-playing/);
});

test("arrow keys move through sounds and sections", async ({ page }) => {
  await page.goto("./");
  const nature = items.filter((i) => i.section === sections[0].id);
  await page.getByRole("radio", { name: nature[0].label }).click();
  await page.keyboard.press("ArrowRight");
  const next = page.getByRole("radio", { name: nature[1].label });
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute("aria-checked", "true");

  await page.getByRole("tab", { name: sections[0].label }).focus();
  await page.keyboard.press("ArrowRight");
  const tab = page.getByRole("tab", { name: sections[1].label });
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute("aria-selected", "true");
});

test("remembers the chosen sound across a reload", async ({ page }) => {
  await page.goto("./");
  const pick = items.filter((i) => !i.tracks)[2];
  await page.getByRole("radio", { name: pick.label }).click();
  await page.reload();
  await expect(page.getByRole("radio", { name: pick.label })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("fits a 320 px phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("./");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  for (const r of await page.getByRole("radio").all()) {
    const box = (await r.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});
