import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Every built file but the audio and the worker itself, as paths relative
// to the site, written into the worker for it to save on install. Audio is
// saved only on request, sound by sound.
function shellList(): Plugin {
  let outDir = "dist";
  return {
    name: "shell-list",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = readdirSync(outDir, {
        recursive: true,
        withFileTypes: true,
      })
        .filter((d) => d.isFile())
        .map((d) =>
          relative(outDir, join(d.parentPath, d.name)).split("\\").join("/"),
        )
        .filter((f) => !f.startsWith("audio/") && f !== "sw.js")
        .sort();
      const sw = join(outDir, "sw.js");
      const code = readFileSync(sw, "utf8");
      const token = "__SHELL__";
      if (code.split(token).length !== 2) {
        throw new Error(`sw.js: expected ${token} exactly once`);
      }
      // Escaped for the string literal the token sits in.
      const literal = JSON.stringify(JSON.stringify(files)).slice(1, -1);
      writeFileSync(sw, code.replace(token, literal));
    },
  };
}

// GitHub Pages serves the project site under /longquiet/.
export default defineConfig({
  base: "/longquiet/",
  plugins: [shellList()],
  build: {
    rollupOptions: {
      input: { main: "index.html", sw: "src/sw/sw.ts" },
      // The worker keeps one name, so a release replaces it in place.
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
