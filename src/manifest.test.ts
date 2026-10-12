import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicDir = new URL("../public/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("manifest.webmanifest", publicDir), "utf8"),
) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; purpose: string }[];
};

// Width and height from a PNG's IHDR chunk.
function pngSize(path: URL): string {
  const b = readFileSync(path);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

describe("web app manifest", () => {
  it("is linked from the page, with the touch icon", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(html).toMatch(
      /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/,
    );
  });

  it("names the app and pins its identity", () => {
    expect(manifest.name).toBe("longquiet");
    expect(manifest.short_name).toBe("longquiet");
    expect(manifest.id).toBe("./");
  });

  it("stays inside the site's subpath and opens standalone", () => {
    // Relative, so they resolve under /longquiet/ wherever it is hosted.
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    expect(manifest.display).toBe("standalone");
  });

  it.each(manifest.icons)("ships $src at $sizes", (icon) => {
    expect(pngSize(new URL(icon.src, publicDir))).toBe(icon.sizes);
  });

  it("has the icons phones ask for", () => {
    const any = manifest.icons.filter((i) => i.purpose === "any");
    expect(any.map((i) => i.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(pngSize(new URL("icons/apple-touch-icon.png", publicDir))).toBe(
      "180x180",
    );
  });
});
