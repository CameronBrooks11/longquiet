import { expect, test } from "@playwright/test";

// The README's pictures of the page on a phone, in each theme. CI uploads
// them on every run (the "screenshots" artifact); they are committed to
// docs/ by hand when the layout changes.
for (const scheme of ["light", "dark"] as const) {
  test(`README screenshot, ${scheme}`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "one engine is enough for a picture");
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("./");
    await expect(page.getByRole("radio").first()).toBeVisible();
    await page.screenshot({
      path: `screenshots/phone-${scheme}.png`,
      animations: "disabled",
    });
  });
}
