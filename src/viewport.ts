// src/viewport.ts
// Clicker Heroes-style viewport fit (pure math, DOM-free so it stays testable):
// the logical viewport is fitted to the CSS width (never below the
// Config.LAYOUT_MIN_* floor), a single uniform scale maps logical -> CSS
// pixels, and the logical height absorbs the remaining vertical space so the
// scene fills the screen without letterbox bars. Layout derives all rects
// from the logical size, so a phone gets the full desktop composition scaled
// down instead of a squashed sub-minimum layout.

import Config from "./config";

export interface ViewportFit {
  logical_w: number;
  logical_h: number;
  scale: number;
}

export function fit_viewport(css_w: number, css_h: number): ViewportFit {
  const logical_w = Math.max(css_w, Config.LAYOUT_MIN_WIDTH);
  const scale = css_w / logical_w;
  const logical_h = Math.max(Math.round(css_h / scale), Config.LAYOUT_MIN_HEIGHT);
  return { logical_w, logical_h, scale };
}

export default fit_viewport;
