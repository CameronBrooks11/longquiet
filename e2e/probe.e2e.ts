import { devices, test } from "@playwright/test";

// Temporary: logs the layout under iPhone emulation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone } = devices["iPhone 15"];
test.use(iphone);

test("probe phone layout", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit");
  await page.goto("./");
  const report = await page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return `${sel} top=${r.top.toFixed(1)} bottom=${r.bottom.toFixed(1)}`;
    };
    const pills = [...document.querySelectorAll(".scapes button")]
      .filter((b) => !(b as HTMLElement).hidden)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return `${b.textContent} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`;
      });
    return [
      `inner ${innerWidth}x${innerHeight}`,
      `font ${getComputedStyle(document.body).fontFamily}`,
      box("header"),
      box(".sections"),
      box(".scapes"),
      box("#play"),
      box("#now"),
      ...pills,
    ].join("\n");
  });
  console.log(report);
});
