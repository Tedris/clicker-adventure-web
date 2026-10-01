// src/main.ts
// Browser entry point: canvas setup + thin event dispatch to Game/MainScene.
// Mirrors main.lua: every browser event forwards one step, no game logic.

import Config from "./config";
import { fit_viewport } from "./viewport";
import Game from "./game";

const canvas = document.createElement("canvas");
const mount = document.getElementById("app");
if (!mount) throw new Error("missing #app mount point");
const app: HTMLElement = mount; // narrowed once; closures see non-null
app.appendChild(canvas);
const ctx = canvas.getContext("2d")!; // narrowed once; closures see non-null
if (!ctx) throw new Error("canvas 2d context unavailable");

const game = new Game();

// Clicker Heroes-style sizing: fit_viewport derives a logical viewport that
// is at least the Config.LAYOUT_MIN_* size, scaled uniformly into the CSS
// viewport by width. The scene draws in logical space (so the layout clamp in
// ui/layout.ts sees a size it was designed for instead of a squashed phone
// width), the backing store multiplies by devicePixelRatio for crisp text and
// pixel art, and any leftover height (minimum-height clamp only) stays
// reachable through the #app scroller. Same-size repeats are cheap no-ops,
// which mirrors the Lua font-cache rebuild guard.
let last_k = 0;
let fit = fit_viewport(Config.WINDOW_WIDTH, Config.WINDOW_HEIGHT);
function resize(): void {
  const css_w = window.innerWidth || Config.WINDOW_WIDTH;
  const css_h = window.innerHeight || Config.WINDOW_HEIGHT;
  const dpr = window.devicePixelRatio || 1;
  fit = fit_viewport(css_w, css_h);
  const cw = Math.round(fit.logical_w * fit.scale);
  const ch = Math.round(fit.logical_h * fit.scale);
  canvas.style.width = cw + "px";
  canvas.style.height = ch + "px";
  app.style.overflowY = ch > css_h ? "auto" : "hidden";
  const k = fit.scale * dpr;
  if (k !== last_k || canvas.width !== Math.round(fit.logical_w * k)) {
    canvas.width = Math.round(fit.logical_w * k);
    canvas.height = Math.round(fit.logical_h * k);
    last_k = k;
  }
  ctx.setTransform(k, 0, 0, k, 0, 0);
  game.main_scene.resize(fit.logical_w, fit.logical_h);
}
window.addEventListener("resize", resize);
resize();

// --- frame loop -------------------------------------------------------------
// The clamp lives inside Game.update; the loop only feeds wall-clock deltas.
let last_time = performance.now();
function frame(now: number): void {
  const dt = Math.max(0, (now - last_time) / 1000);
  last_time = now;
  game.update(dt);
  const w = fit.logical_w;
  const h = fit.logical_h;
  const bg = Config.BG_COLOR;
  ctx.fillStyle = `rgb(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])})`;
  ctx.fillRect(0, 0, w, h);
  game.main_scene.draw(ctx, game.state, w, h);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- pointer lane -----------------------------------------------------------
// Mouse: press/hover/wheel forward one step each. Touch: tap-vs-drag is
// resolved HERE (a drag beyond TOUCH_DRAG_THRESHOLD_PX becomes a wheel
// scroll, otherwise the release fires a tap), and a second tap within
// TOUCH_TAP_DEBOUNCE_S is swallowed so synthesized double-clicks on hybrid
// touch devices cannot double-buy.
let touch_start: { x: number; y: number; lx: number; ly: number; dragging: boolean } | null = null;
let last_tap_s = -Infinity;

// Pointer space == logical space: divide the CSS offset by the current fit
// scale so hit-test rects (derived from the logical size) match the drawing.
function css_coords(e: PointerEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [(e.clientX - rect.left) / fit.scale, (e.clientY - rect.top) / fit.scale];
}

canvas.addEventListener("pointerdown", (e: PointerEvent) => {
  const [x, y] = css_coords(e);
  if (e.pointerType === "mouse") {
    game.main_scene.mousepressed(x, y);
    return;
  }
  touch_start = { x, y, lx: x, ly: y, dragging: false };
});

canvas.addEventListener("pointermove", (e: PointerEvent) => {
  const [x, y] = css_coords(e);
  if (e.pointerType !== "mouse") {
    if (!touch_start) return;
    const dx = x - touch_start.lx;
    const dy = y - touch_start.ly;
    if (!touch_start.dragging &&
        Math.abs(x - touch_start.x) + Math.abs(y - touch_start.y) > Config.TOUCH_DRAG_THRESHOLD_PX) {
      touch_start.dragging = true;
    }
    if (touch_start.dragging) {
      game.main_scene.wheelmoved(dx, dy, x, y);
      if (app.scrollHeight > app.clientHeight) app.scrollTop -= dy;
    }
    touch_start.lx = x;
    touch_start.ly = y;
    return;
  }
  game.main_scene.mousemoved(x, y);
});

canvas.addEventListener("pointerup", (e: PointerEvent) => {
  if (e.pointerType === "mouse" || !touch_start) {
    touch_start = null;
    return;
  }
  const [x, y] = css_coords(e);
  const dragging = touch_start.dragging;
  touch_start = null;
  if (dragging) return;
  const now_s = performance.now() / 1000;
  if (now_s - last_tap_s < Config.TOUCH_TAP_DEBOUNCE_S) return;
  last_tap_s = now_s;
  game.main_scene.mousepressed(x, y);
});

canvas.addEventListener("wheel", (e: WheelEvent) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  game.main_scene.wheelmoved(e.deltaX, e.deltaY,
    (e.clientX - rect.left) / fit.scale, (e.clientY - rect.top) / fit.scale);
  // Leftover-height fallback: ride the #app scroller when the canvas is
  // taller than the viewport (minimum-height clamp on very short screens).
  if (app.scrollHeight > app.clientHeight) {
    app.scrollTop += e.deltaY;
  }
}, { passive: false });

// --- keyboard / lifecycle ---------------------------------------------------
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "f1") {
    Config.DEBUG_MODE = !Config.DEBUG_MODE;
    console.log("[INFO] [MAIN] Debug mode: " + String(Config.DEBUG_MODE));
  }
  game.main_scene.keypressed(e.key);
});

// Flush unsaved gains when the tab hides or closes; dirty-gated so a no-op
// quit never rotates the backup file.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    game.save.flush_if_dirty(game.state, game.upgrades);
  }
});
window.addEventListener("pagehide", () => game.save.flush_if_dirty(game.state, game.upgrades));

