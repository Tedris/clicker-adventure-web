// tests/pixelart.test.ts
// Vitest port of tests/test_pixelart.lua (busted -> vitest).
// The code-drawn sprites are pure data: every map must be square, only use
// declared palette chars, stay non-degenerate, and build() must produce a
// valid RGBA byte buffer. Waifu faces get the two-eye-runs regression guard.

import { describe, it, expect } from "vitest";
import { SPRITES, build, createSpriteCanvas } from "../src/pixelart";
import { Clicker } from "../src/systems/clicker";
import Config from "../src/config";

function allSprites(): [string, (typeof SPRITES)[string]][] {
  return Object.entries(SPRITES);
}

describe("PixelArt maps - shape consistency", () => {
  it("every map is square with equal-length rows of 16", () => {
    for (const [name, def] of allSprites()) {
      expect(Array.isArray(def.grid), `${name} has no rows`).toBe(true);
      expect(def.palette, `${name} has no palette`).toBeTruthy();
      expect(def.grid.length, `${name} row count`).toBe(16);
      def.grid.forEach((row, i) => {
        expect(row.length, `${name} row ${i + 1} length: ${row}`).toBe(16);
      });
    }
  });

  it("only '.' plus declared palette chars appear in each map", () => {
    for (const [name, def] of allSprites()) {
      for (const row of def.grid) {
        for (const ch of row) {
          if (ch !== ".") {
            expect(
              def.palette[ch],
              `${name} uses undeclared char '${ch}'`,
            ).toBeTruthy();
          }
        }
      }
    }
  });

  it("every declared palette color is RGBA and actually used", () => {
    for (const [name, def] of allSprites()) {
      const used = new Set(def.grid.join("").split(""));
      for (const [ch, rgba] of Object.entries(def.palette)) {
        expect(used.has(ch), `${name} palette char '${ch}' unused`).toBe(true);
        expect(rgba.length, `${name} color for '${ch}' not RGBA`).toBe(4);
      }
    }
  });

  it("maps are not degenerate (enough opaque pixels to read as a sprite)", () => {
    for (const [name, def] of allSprites()) {
      const body = def.grid.join("");
      const opaque = body.length - (body.match(/\./g) ?? []).length;
      expect(opaque >= 60, `${name} only ${opaque} opaque pixels`).toBe(true);
      expect(
        /[^\x2E]/.test(def.grid[0]),
        `${name} top row should be empty padding`,
      ).toBe(false);
      expect(
        /[^\x2E]/.test(def.grid[15]),
        `${name} bottom row should be empty padding`,
      ).toBe(false);
    }
  });
});

describe("PixelArt waifu faces - two eyes only", () => {
  // Regression: Steve/Linda shipped with three evenly-spaced eye pixels and
  // read as triple-eyed. On any row, eye pixels must form 0 or exactly 2
  // contiguous runs (the two eyes), never 3.
  function eyeRuns(row: string, eyeCh: string): number {
    let runs = 0;
    let inRun = false;
    for (const ch of row) {
      if (ch === eyeCh) {
        if (!inRun) {
          runs += 1;
          inRun = true;
        }
      } else {
        inRun = false;
      }
    }
    return runs;
  }

  const waifuNames = [
    "Karen the Accountant",
    "Steve the HR Rep",
    "Linda the Middle Manager",
  ];

  for (const name of waifuNames) {
    it(`${name} has at most two eye runs per row and a real eye row`, () => {
      const def = SPRITES[name];
      expect(def, `missing waifu map for ${name}`).toBeTruthy();
      let eyeRowFound = false;
      def.grid.forEach((row, i) => {
        const runs = eyeRuns(row, "E");
        expect(
          runs === 0 || runs === 2,
          `${name} row ${i + 1} has ${runs} eye runs: ${row}`,
        ).toBe(true);
        if (runs === 2) eyeRowFound = true;
      });
      expect(eyeRowFound, `${name} has no row with two eyes`).toBe(true);
    });
  }
});

describe("PixelArt.build - byte buffers", () => {
  it("returns size and 4 bytes per pixel with alpha from '.'", () => {
    for (const [name, def] of allSprites()) {
      const built = build(name);
      expect(built, `${name} failed to build`).toBeTruthy();
      const { size, rgba } = built!;
      expect(size, name).toBe(16);
      expect(def.grid.length, name).toBe(size);
      expect(rgba.length, `${name} byte length`).toBe(size * size * 4);
      // top-left pixel is '.' => fully transparent
      expect(rgba[3]).toBe(0);
      // and at least one fully opaque pixel exists
      let anyOpaque = false;
      for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] === 255) {
          anyOpaque = true;
          break;
        }
      }
      expect(anyOpaque, `${name} fully transparent?`).toBe(true);
    }
  });
});

describe("PixelArt registry", () => {
  it("covers every monster sprite_key in the clicker and every waifu pool name", () => {
    const clicker = new Clicker();
    for (const m of clicker.monsters) {
      expect(SPRITES[m.sprite_key], `missing map for ${m.sprite_key}`).toBeTruthy();
    }
    for (const w of Config.WAIFU_POOL) {
      expect(SPRITES[w.name], `missing waifu map for ${w.name}`).toBeTruthy();
    }
  });
});

describe("PixelArt.createSpriteCanvas - environment guard", () => {
  it("returns undefined without a document, or a canvas with one (no throw)", () => {
    const out = createSpriteCanvas("mon_slime", 2);
    expect(out === undefined || typeof out === "object").toBe(true);
  });
});
