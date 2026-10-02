// src/pixelart.ts
// Story 4.1 port: sprites as pure data. Each sprite is a 16x16 char grid plus
// a palette (char -> RGBA, '.' = transparent). build() flattens a grid into a
// row-major RGBA byte buffer. createSpriteCanvas() is the browser-only echo of
// LÖVE's lazily-cached texture path (returns undefined when there is no DOM).

export type Rgba = readonly [number, number, number, number];

export interface SpriteDef {
  grid: string[];
  palette: Record<string, Rgba>;
}

export interface BuiltSprite {
  size: number;
  rgba: Uint8ClampedArray;
}

export const SPRITES: Record<string, SpriteDef> = {
  // Placeholder Slime — classic dome, twin eyes, highlight glint.
  // B body  b shadow  W eye white  K pupil
  mon_slime: {
    palette: {
      B: [100, 200, 100, 255],
      b: [60, 140, 70, 255],
      W: [255, 255, 255, 255],
      K: [25, 25, 25, 255],
    },
    grid: [
      "................",
      "................",
      "................",
      "................",
      "......BBBB......",
      "....BBBBBBBB....",
      "...BBBBBBBBBB...",
      "..BBWWBBBBWWBB..",
      "..BBWKBBBBWKBB..",
      ".BBBBBBBBBBBBBB.",
      ".BBBBBBBBBBBBBB.",
      "BBBBbBBBBBBbBBBB",
      "BbBBBBBBBBBBBbBB",
      ".bBBBBBBBBBBBb..",
      "..bbbbbbbbbb....",
      "................",
    ],
  },

  // Placeholder Goblin — big ear tips, scowling eyes, tiny clipboard arm.
  // S skin  s shade  W eye white  K pupil
  mon_goblin: {
    palette: {
      S: [180, 120, 80, 255],
      s: [130, 85, 55, 255],
      W: [255, 255, 255, 255],
      K: [30, 20, 12, 255],
    },
    grid: [
      "................",
      "................",
      "..S..........S..",
      "..SS........SS..",
      "...SSSSSSSSSS...",
      "...SSSSSSSSSS...",
      "..KSSWWSSWWSSK..",
      "..SSSKSSSKSSSS..",
      "...SSSSSSSSSS...",
      "....SSKKKKSS....",
      ".....SSSSSS.....",
      "....SSSSSSSS....",
      "...SSsSSSSsSS...",
      "....SSSSSSSS....",
      "....SS....SS....",
      "................",
    ],
  },
  // Spreadsheet Skeleton — skull, ribcage, two legs. Bone ivory keeps the
  // monster color as the card identity. B bone  K eye socket / shadow gap
  mon_skeleton: {
    palette: {
      B: [235, 235, 225, 255],
      K: [45, 35, 60, 255],
    },
    grid: [
      "................",
      "................",
      "....BBBBBB......",
      "...BKKBBKKB.....",
      "...BBBBBBBB.....",
      "....BBKKBB......",
      ".....KBBK.......",
      "......BB........",
      "....BBBBBB......",
      "...KBBBBBBK.....",
      "...KBKKBBK......",
      "....BBBBBB......",
      "....KBBBKK......",
      ".....BB.BB......",
      ".....BB.BB......",
      "................",
    ],
  },

  // Compliance Cyclops — one huge judgmental eye, horn bumps, clipboard.
  // R body  r shade  W eye white  K pupil/lid
  mon_cyclops: {
    palette: {
      R: [231, 76, 60, 255],
      r: [170, 50, 40, 255],
      W: [255, 255, 255, 255],
      K: [30, 12, 12, 255],
    },
    grid: [
      "................",
      "................",
      "....RR....RR....",
      "..RRRRRRRRRRRR..",
      ".RRRRRRRRRRRRRR.",
      ".RRWWWWWWWWWWRR.",
      ".RRWWWWKKWWWWRR.",
      ".RRWWWWKKWWWWRR.",
      ".RRRWWWWWWWWRRR.",
      ".rrRRRRRRRRRRrr.",
      "...RRRRRRRRRR...",
      "...RRKKKKKKKRR..",
      "....RRRRRRRR....",
      "....RR....RR....",
      "...rrr....rrr...",
      "................",
    ],
  },
  // Middle-Manager Mimic — treasure chest with lid seam, lock plate and
  // knowing eyes on the lid. W wood  w dark wood  G gold band  K keyhole/eye
  mon_mimic: {
    palette: {
      W: [166, 110, 60, 255],
      w: [115, 72, 38, 255],
      G: [243, 156, 18, 255],
      K: [25, 20, 15, 255],
    },
    grid: [
      "................",
      "................",
      "..GGGGGGGGGGGG..",
      "..WWWWWWWWWWWW..",
      "..WWKWWWWWWKWW..",
      "..WWKKWWWWKKWW..",
      "..wwwwwwwwwwww..",
      "..GGGGGGGGGGGG..",
      "..WWWWGGGGGWWWW.",
      "..WWWWGKKKGWWWW.",
      "..WWWWGKKKGWWWW.",
      "..WWWWGGGGGWWWW.",
      "..WWWWWWWWWWWW..",
      "..wwwwwwwwwwww..",
      "..GGGGGGGGGGGG..",
      "................",
    ],
  },

  // The waifus. Neutral gray palette so the modulate-color draw path tints
  // each card/reveal with its personality color:
  // H hair  F face  E eye  A outfit  a outfit shade  S shoes
  // Face rows: E pixels must form exactly two symmetric runs per row (the
  // eyes). A third solo E reads as a third eye — guarded by tests.
  "Karen the Accountant": {
    palette: {
      H: [190, 190, 190, 255],
      F: [245, 240, 235, 255],
      E: [20, 20, 20, 255],
      A: [215, 215, 215, 255],
      a: [150, 150, 150, 255],
      S: [90, 90, 95, 255],
    },
    grid: [
      "................",
      "................",
      "....HHHHHHHH....",
      "...HHHHHHHHHH...",
      "...HFFFFFFFH....",
      "...HFEEFFEEFH...",
      "...HFFFFFFFH....",
      "...HHFFFFHHHH...",
      "..aAAAAAAAAAa...",
      "..aAAAAAAAAAa...",
      "..aAaaaaaaAAa...",
      "...aAAAAAAAa....",
      "....aaa..aaa....",
      "....FF....FF....",
      "...SSSS..SSSS...",
      "................",
    ],
  },

  "Steve the HR Rep": {
    palette: {
      H: [165, 165, 165, 255],
      F: [245, 240, 235, 255],
      E: [20, 20, 20, 255],
      A: [215, 215, 215, 255],
      a: [150, 150, 150, 255],
      S: [90, 90, 95, 255],
    },
    grid: [
      "................",
      "................",
      "....HHHHHHHH....",
      "...HHHHHHHHHH...",
      "...FFFFFFFFF....",
      "...FEEFFFEEF....",
      "...FFFFFFFFF....",
      "....FFFFFFF.....",
      "..aAAAAAAAAAa...",
      "..aAAaaaaaAAa...",
      "..aAAAaaAAaAa...",
      "...aAAAAAAAa....",
      "....aaa..aaa....",
      "....aa....aa....",
      "...SSSS..SSSS...",
      "................",
    ],
  },
  "Linda the Middle Manager": {
    palette: {
      H: [200, 200, 200, 255],
      F: [245, 240, 235, 255],
      E: [20, 20, 20, 255],
      A: [215, 215, 215, 255],
      a: [150, 150, 150, 255],
      S: [90, 90, 95, 255],
    },
    grid: [
      "................",
      "................",
      "....HHHHHHHH....",
      "...HHHHHHHHHH...",
      "..HHFFFFFFFHH...",
      "..HFEEFFFEEFH...",
      "..HFFFFFFFFFH...",
      "..HHFFFFFFHHH...",
      "..aAAAAAAAAAa...",
      "..aAaAAAAAaAa...",
      "..aAAAAAAAAAa...",
      "...aAAAAAAAa....",
      "....aaa..aaa....",
      "....aa....aa....",
      "...SSSS..SSSS...",
      "................",
    ],
  },

  // Dave from IT: crew cut + rectangular glasses (G frames over the eyes).
  "Dave from IT": {
    palette: {
      H: [150, 150, 158, 255],
      F: [240, 232, 226, 255],
      E: [20, 20, 20, 255],
      G: [70, 78, 92, 255],
      A: [205, 208, 215, 255],
      a: [140, 144, 152, 255],
      S: [85, 86, 92, 255],
    },
    grid: [
      "................",
      "................",
      "...HHHHHHHHHH...",
      "...HHHHHHHHHH...",
      "...FFFFFFFFF....",
      "...GGEEGEEGG....",
      "...GGEEGEEGG....",
      "....FFFFFFF.....",
      "..aAAAAAAAAAa...",
      "..aAAaaaaaAAa...",
      "..aAAAAAAAAAa...",
      "...aAAAAAAAa....",
      "....aaa..aaa....",
      "....aa....aa....",
      "...SSSS..SSSS...",
      "................",
    ],
  },

  // Priya from Payroll: ponytail on the side, neat blazer.
  "Priya from Payroll": {
    palette: {
      H: [175, 178, 185, 255],
      F: [245, 240, 235, 255],
      E: [20, 20, 20, 255],
      A: [212, 216, 220, 255],
      a: [148, 152, 158, 255],
      S: [88, 90, 96, 255],
    },
    grid: [
      "................",
      "................",
      "....HHHHHHHH....",
      "...HHHHHHHHHH...",
      "..HHFFFFFFFHH...",
      ".HHFEEFFFEEFH...",
      ".HHFFFFFFFFFH...",
      ".HHHFFFFFFHHH...",
      "..aAAAAAAAAAa...",
      "..aAAAAAAAAAa...",
      "..aAaAAAAAaAa...",
      "...aAAAAAAAa....",
      "....aaa..aaa....",
      "....FF....FF....",
      "...SSSS..SSSS...",
      "................",
    ],
  },

  // Tina from Temp Agencies: top bun, always moving.
  "Tina from Temp Agencies": {
    palette: {
      H: [185, 178, 172, 255],
      F: [245, 240, 235, 255],
      E: [20, 20, 20, 255],
      A: [218, 214, 210, 255],
      a: [152, 148, 144, 255],
      S: [92, 88, 86, 255],
    },
    grid: [
      "................",
      "......HHHH......",
      "....HHHHHHHH....",
      "...HHHHHHHHHH...",
      "...HFFFFFFFH....",
      "...HFEEFFEEFH...",
      "...HFFFFFFFH....",
      "...HHFFFFHHHH...",
      "..aAAAAAAAAAa...",
      "..aAaaaaaaAAa...",
      "..aAAAAAAAAAa...",
      "...aAAAAAAAa....",
      "....aaa..aaa....",
      "....aa....aa....",
      "...SSSS..SSSS...",
      "................",
    ],
  },

  // Gus from Facilities: work cap, broad shoulders.
  "Gus from Facilities": {
    palette: {
      H: [160, 162, 168, 255],
      F: [238, 230, 222, 255],
      E: [20, 20, 20, 255],
      A: [208, 210, 216, 255],
      a: [142, 144, 150, 255],
      S: [86, 86, 90, 255],
    },
    grid: [
      "................",
      "................",
      "..HHHHHHHHHHHH..",
      "..HHHHHHHHHHHH..",
      "...FFFFFFFFF....",
      "...FEEFFFEEF....",
      "...FFFFFFFFF....",
      "....FFFFFFF.....",
      ".aAAAAAAAAAAAa..",
      ".aAAaaaaaaAAa...",
      ".aAAAAAAAAAAAa..",
      "..aAAAAAAAAAa...",
      "....aaa..aaa....",
      "....aa....aa....",
      "...SSSS..SSSS...",
      "................",
    ],
  },
};

// Flatten a sprite grid into row-major RGBA bytes. Unknown chars (including
// '.') fall through to fully transparent, matching the Lua "\0\0\0\0" path.
export function build(name: string): BuiltSprite | undefined {
  const def = SPRITES[name];
  if (!def) return undefined;
  const height = def.grid.length;
  const width = def.grid[0].length;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let i = 0;
  for (const row of def.grid) {
    for (const ch of row) {
      const color = def.palette[ch];
      if (color) {
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = color[3];
      }
      i += 4; // zero-filled gap == transparent when char is undeclared
    }
  }
  return { size: width, rgba };
}

// Browser-only echo of PixelArt.get_image: build an offscreen canvas from the
// sprite with nearest-neighbour smoothing off. Returns undefined when there is
// no document (mirrors the Lua nil-return when love.image is absent). Never
// called at module scope.
export function createSpriteCanvas(
  name: string,
  scale: number,
): HTMLCanvasElement | undefined {
  if (typeof document === "undefined") return undefined;
  const built = build(name);
  if (!built) return undefined;
  const size = built.size;
  const canvas = document.createElement("canvas");
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.imageSmoothingEnabled = false;
  const base = document.createElement("canvas");
  base.width = size;
  base.height = size;
  const baseCtx = base.getContext("2d");
  if (!baseCtx) return undefined;
  baseCtx.putImageData(
    new ImageData(new Uint8ClampedArray(built.rgba), size, size),
    0,
    0,
  );
  ctx.drawImage(base, 0, 0, size * scale, size * scale);
  return canvas;
}

export default SPRITES;
