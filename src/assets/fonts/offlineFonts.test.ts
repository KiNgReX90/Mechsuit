/**
 * Offline-fonts guard.
 *
 * The app must NEVER reach the network for type: fonts are vendored .woff2 files
 * in this directory, referenced by relative `url()`s. These tests fail loudly if
 * a remote font URL (CDN, Google Fonts, any http(s) src or @import) ever sneaks
 * into the app CSS, or if a referenced font file goes missing — so the offline
 * guarantee can't silently regress.
 *
 * Reads CSS straight off disk with node:fs (the test runs in Node) rather than a
 * Vite glob, because Vitest does not process CSS by default and `?raw` imports
 * come back empty.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "../..");

/** Every .css file under src/, read as text. */
function allCssSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) out.push({ file: full, text: readFileSync(full, "utf8") });
    }
  };
  walk(srcRoot);
  return out;
}

describe("offline fonts", () => {
  it("references no remote font URLs anywhere in the app CSS", () => {
    for (const { file, text } of allCssSources()) {
      expect(text, `${file} must not contain http(s):// URLs`).not.toMatch(/https?:\/\//i);
      expect(text, `${file} must not @import a URL`).not.toMatch(/@import\s+url\(/i);
      expect(text, `${file} must not reference Google-hosted fonts`).not.toMatch(
        /fonts\.(googleapis|gstatic)\.com/i,
      );
    }
  });

  it("declares @font-face only with local relative woff2 sources that exist on disk", () => {
    const css = readFileSync(resolve(here, "fonts.css"), "utf8");
    const srcs = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);

    const onDisk = new Set(readdirSync(here));
    for (const src of srcs) {
      expect(src, `font src must be a relative local path: ${src}`).toMatch(/^\.\//);
      expect(src, `font src must be a woff2: ${src}`).toMatch(/\.woff2$/);
      const fileName = src.replace(/^\.\//, "");
      expect(onDisk.has(fileName), `vendored font missing on disk: ${fileName}`).toBe(true);
    }
  });
});
