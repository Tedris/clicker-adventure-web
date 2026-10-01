// tests/viewport.test.ts
// Pure fit math for the browser host (Clicker Heroes style): the logical
// viewport is fitted to the CSS width (never below Config.LAYOUT_MIN_*),
// scaled uniformly, and the logical height absorbs the remaining vertical
// space so the scene always fills the screen — no letterbox bars, no
// overlapping/clipped fixed-pixel layout on narrow phones.

import { describe, it, expect } from "vitest";
import Config from "../src/config";
import { fit_viewport } from "../src/viewport";

describe("fit_viewport", () => {
  it("is an identity fit at and above the design size", () => {
    const v = fit_viewport(800, 600);
    expect(800).toEqual(v.logical_w);
    expect(600).toEqual(v.logical_h);
    expect(1).toEqual(v.scale);
    const big = fit_viewport(1920, 1080);
    expect(1).toEqual(big.scale);
    expect(1920).toEqual(big.logical_w);
  });

  it("fits a narrow phone width by scaling below 1, never below the min width", () => {
    // Typical phone CSS width ~390: logical width clamps to the 520 min,
    // scale = 390/520 = 0.75, height fills the rest: 844 / 0.75 = 1125.
    const v = fit_viewport(390, 844);
    expect(Config.LAYOUT_MIN_WIDTH).toEqual(v.logical_w);
    expect(390 / Config.LAYOUT_MIN_WIDTH).toEqual(v.scale);
    expect(Math.round(844 / v.scale)).toEqual(Math.round(v.logical_h));
  });

  it("the scaled canvas always fills the CSS viewport exactly", () => {
    for (const [cw, ch] of [[390, 844], [360, 640], [740, 360], [520, 360], [1280, 720]]) {
      const v = fit_viewport(cw, ch);
      expect(v.scale <= 1).toBe(true);
      expect(v.logical_w >= Config.LAYOUT_MIN_WIDTH).toBe(true);
      expect(v.logical_h >= Config.LAYOUT_MIN_HEIGHT).toBe(true);
      // width fit is exact; height fills at least the viewport (no bars)
      expect(Math.abs(v.logical_w * v.scale - cw) < 0.5).toBe(true);
      expect(v.logical_h * v.scale >= ch - 0.5).toBe(true);
    }
  });

  it("maps pointer space: logical coords = css coords / scale", () => {
    const v = fit_viewport(390, 844);
    // right edge of the screen maps to the logical width
    expect(Math.round(390 / v.scale)).toEqual(v.logical_w);
  });
});
