import { readFileSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";

interface Item {
  id: string;
  label: string;
  section: string;
  title?: string;
  tracks?: { id: string; title: string }[];
  recipe?: { crossfade: number };
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
    const errors: Promise<string>[] = [];
    // An Error passed to console.error prints as a handle; ask for its text.
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      errors.push(
        Promise.all(
          m
            .args()
            .map((a) =>
              a
                .evaluate((v) =>
                  v instanceof Error
                    ? `${v.name}: ${v.message}`
                    : v instanceof MediaError
                      ? `MediaError ${v.code}: ${v.message} (audio/mpeg: "${new Audio().canPlayType("audio/mpeg")}")`
                      : String(v),
                )
                .catch(() => m.text()),
            ),
        ).then((parts) => parts.join(" ")),
      );
    });
    page.on("pageerror", (e) => errors.push(Promise.resolve(String(e))));
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        (window as unknown as { audio: HTMLMediaElement }).audio = this;
        return play.call(this);
      };
    });
    await use(page);
    expect(await Promise.all(errors), "console errors").toEqual([]);
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
    await page.getByRole("tab", { name: s.label, exact: true }).click();
    await expect(
      page.getByRole("tab", { name: s.label, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("radio")).toHaveText(
      items.filter((i) => i.section === s.id).map((i) => i.label),
    );
  }
  const files = items.reduce((n, i) => n + (i.tracks?.length ?? 1), 0);
  await expect(page.locator("#credits > li")).toHaveCount(files);
});

// A loop's copies take turns on two elements (#34): near the end of one, the
// other starts from the top, and the first plays out and stops.
test("hands a loop over to a second element at its end", async ({ page }) => {
  await page.goto("./");
  const loop = items.find((i) => !i.tracks)!;
  await page.getByRole("radio", { name: loop.label, exact: true }).click();
  await expectAdvancing(page);
  await page.evaluate((overlap) => {
    const w = window as unknown as {
      audio: HTMLMediaElement;
      first: HTMLMediaElement;
    };
    w.first = w.audio;
    w.audio.currentTime = w.audio.duration - overlap - 1;
  }, loop.recipe!.crossfade);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window as unknown as {
            audio: HTMLMediaElement;
            first: HTMLMediaElement;
          };
          // The copies overlap: the first is still playing its fade-out.
          return w.audio !== w.first && !w.audio.paused && !w.first.paused;
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
  expect(await audio(page)).toMatchObject({ file: `${loop.id}.mp3` });
  expect((await audio(page))!.time).toBeLessThan(loop.recipe!.crossfade + 2);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { first: HTMLMediaElement }).first.ended,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  await expectAdvancing(page);
  await expect(page.locator("body")).toHaveClass(/is-playing/);
});

test("plays a loop, switches sound while playing, and pauses", async ({
  page,
}) => {
  await page.goto("./");
  const [first, second] = items.filter((i) => !i.tracks);
  await page.getByRole("radio", { name: first.label, exact: true }).click();
  await expect(page.locator("body")).toHaveClass(/is-playing/);
  await expectAdvancing(page);
  expect(await audio(page)).toMatchObject({
    file: `${first.id}.mp3`,
    loop: false,
  });

  await page.getByRole("radio", { name: second.label, exact: true }).click();
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
  await page
    .getByRole("tab", { name: playlistSection.label, exact: true })
    .click();
  await page.getByRole("radio", { name: playlist.label, exact: true }).click();
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

test("tapping a sound plays it; arrow keys only select", async ({ page }) => {
  await page.goto("./");
  const [first, second, third] = items.filter((i) => !i.tracks);
  await page.getByRole("radio", { name: first.label, exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: second.label, exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("body")).not.toHaveClass(/is-playing/);
  expect(await audio(page)).toBeNull();

  await page.getByRole("radio", { name: third.label, exact: true }).click();
  await expect(page.locator("body")).toHaveClass(/is-playing/);
  await expectAdvancing(page);
  expect((await audio(page))?.file).toBe(`${third.id}.mp3`);

  // Tapping the sound already playing leaves it playing.
  await page.getByRole("radio", { name: third.label, exact: true }).click();
  await expectAdvancing(page);
  await expect(page.locator("body")).toHaveClass(/is-playing/);
});

test("the page names what is playing from either section", async ({ page }) => {
  const loop = items.find((i) => !i.tracks && i.section !== playlist.section)!;
  const loopTab = page.getByRole("tab", {
    name: sections.find((s) => s.id === loop.section)!.label,
    exact: true,
  });
  const listTab = page.getByRole("tab", {
    name: playlistSection.label,
    exact: true,
  });
  const now = page.locator("#now");
  await page.goto("./");
  await page.getByRole("radio", { name: loop.label, exact: true }).click();
  await expectAdvancing(page);
  // The sound's name, not the upload's title, which is in the credits.
  await expect(now).toContainText(loop.label);
  await expect(now).not.toContainText(loop.title!);

  await listTab.click();
  await expect(now).toContainText(loop.label);
  await expect(loopTab).toHaveAttribute("data-playing", "true");
  await expect(listTab).not.toHaveAttribute("data-playing", "true");

  await page.getByRole("radio", { name: playlist.label, exact: true }).click();
  await expectAdvancing(page);
  await expect(now).toContainText(playlist.label);
  await expect(now).toContainText(playlist.tracks![0].title);
  await expect(listTab).toHaveAttribute("data-playing", "true");
  await expect(loopTab).not.toHaveAttribute("data-playing", "true");
  await expect(
    page.getByRole("button", { name: `Next piece in ${playlist.label}` }),
  ).toBeVisible();
});

test("arrow keys move through sounds and sections", async ({ page }) => {
  await page.goto("./");
  const nature = items.filter((i) => i.section === sections[0].id);
  await page.getByRole("radio", { name: nature[0].label, exact: true }).click();
  await page.keyboard.press("ArrowRight");
  const next = page.getByRole("radio", { name: nature[1].label, exact: true });
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute("aria-checked", "true");

  await page.getByRole("tab", { name: sections[0].label, exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const tab = page.getByRole("tab", { name: sections[1].label, exact: true });
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute("aria-selected", "true");
});

test("remembers the chosen sound across a reload", async ({ page }) => {
  await page.goto("./");
  const pick = items.filter((i) => !i.tracks)[2];
  await page.getByRole("radio", { name: pick.label, exact: true }).click();
  // The tap starts it; reloading mid-start would abort that play().
  await expectAdvancing(page);
  await page.reload();
  await expect(
    page.getByRole("radio", { name: pick.label, exact: true }),
  ).toHaveAttribute("aria-checked", "true");
});

test("fits a 320 px phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("./");
  for (const s of sections) {
    await page.getByRole("tab", { name: s.label, exact: true }).click();
    // Choose the section's first item, so a playlist shows its next button.
    await page.getByRole("radio").first().click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, s.label).toBeLessThanOrEqual(0);
    for (const r of await page.getByRole("radio").all()) {
      const box = (await r.boundingBox())!;
      expect(box.x, s.label).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, s.label).toBeLessThanOrEqual(320);
    }
    const next = page.getByRole("button", { name: "Next piece" });
    if (await next.isVisible()) {
      const box = (await next.boundingBox())!;
      expect(box.x + box.width, `${s.label} next`).toBeLessThanOrEqual(320);
    }
  }
});

test("the tabs stay put when switching sections", async ({ page }) => {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("./");
    const tabs = page.getByRole("tablist");
    const at = (await tabs.boundingBox())!.y;
    for (const s of [...sections, sections[0]]) {
      await page.getByRole("tab", { name: s.label, exact: true }).click();
      expect(
        (await tabs.boundingBox())!.y,
        `${size.width} px, ${s.label}`,
      ).toBe(at);
    }
  }
});

test("a sleep timer fades the sound out and pauses on time", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("./");
  const loop = items.find((i) => !i.tracks)!;
  await page.getByLabel("Sleep timer").selectOption("15");
  await expect(page.locator("#timer-left")).toHaveText("15 min left");
  await page.getByRole("radio", { name: loop.label, exact: true }).click();
  await expectAdvancing(page);

  await page.clock.fastForward("10:00");
  await expect(page.locator("#timer-left")).toHaveText("5 min left");
  await expect(page.locator("body")).toHaveClass(/is-playing/);
  await page.clock.fastForward("05:01");
  await expect(page.locator("body")).not.toHaveClass(/is-playing/);
  await expect(page.getByLabel("Sleep timer")).toHaveValue("0");
  await expect(page.locator("#timer-left")).toHaveText("");
  expect((await audio(page))?.paused).toBe(false); // fading out

  await page.clock.fastForward("00:31");
  await expect.poll(async () => (await audio(page))?.paused).toBe(true);
});

test("pausing by hand cancels the sleep timer", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Sleep timer").selectOption("30");
  await expect(page.locator("#timer-left")).toHaveText("30 min left");
  await page.locator("#play").click();
  await expect(page.locator("body")).toHaveClass(/is-playing/);
  await page.locator("#play").click();
  await expect(page.locator("body")).not.toHaveClass(/is-playing/);
  await expect(page.getByLabel("Sleep timer")).toHaveValue("0");
  await expect(page.locator("#timer-left")).toHaveText("");
});

test("a timer set while paused survives a change of sound and starts on play", async ({
  page,
}) => {
  await page.goto("./");
  const [first, second] = items.filter((i) => !i.tracks);
  await page.getByLabel("Sleep timer").selectOption("30");
  await page.getByRole("radio", { name: first.label, exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: second.label, exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.locator("#play").click();
  await expect(page.locator("body")).toHaveClass(/is-playing/);
  await expect(page.getByLabel("Sleep timer")).toHaveValue("30");
  await expect(page.locator("#timer-left")).toHaveText("30 min left");
});

test("the next button skips through a playlist and is hidden for loops", async ({
  page,
}) => {
  const [one, two] = playlist.tracks!;
  await page.goto("./");
  const next = page.getByRole("button", { name: "Next piece" });
  await expect(next).toBeHidden();
  await page
    .getByRole("tab", { name: playlistSection.label, exact: true })
    .click();
  await page.getByRole("radio", { name: playlist.label, exact: true }).click();
  await expect(next).toBeVisible();
  await expectAdvancing(page);
  expect((await audio(page))?.file).toBe(`${one.id}.mp3`);

  await next.click();
  await expect(page.locator("#now")).toContainText(two.title);
  await expect
    .poll(async () => (await audio(page))?.file)
    .toBe(`${two.id}.mp3`);
  await expectAdvancing(page);
  await expect(page.locator("body")).toHaveClass(/is-playing/);

  await page.getByRole("tab", { name: sections[0].label, exact: true }).click();
  const loop = items.find((i) => !i.tracks)!;
  await page.getByRole("radio", { name: loop.label, exact: true }).click();
  await expect(next).toBeHidden();
});
