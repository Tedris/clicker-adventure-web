// src/main.ts
// Browser entry point: canvas setup + thin event dispatch to Game/MainScene.
// Mirrors main.lua: every browser event forwards one step, no game logic.

import Config from "./config";
import Game from "./game";

const canvas = document.createElement("canvas");
const app = document.getElementById("app");
if (!app) throw new Error("missing #app mount point");
app.appendChild(canvas);
const ctx = canvas.getContext("2d")!; // narrowed once; closures see non-null
if (!ctx) throw new Error("canvas 2d context unavailable");

const game = new Game();

// DPR-aware sizing: CSS pixels drive layout math (matching Config.WINDOW_*
// design size), the backing store multiplies by devicePixelRatio so text and
// pixel art stay crisp on phones. Same-size repeats are cheap no-ops, which
// mirrors the Lua font-cache rebuild guard.
let last_dpr = 0;
function resize(): void {
  const w = window.innerWidth || Config.WINDOW_WIDTH;
  const h = window.innerHeight || Config.WINDOW_HEIGHT;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  if (dpr !== last_dpr || canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    last_dpr = dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.main_scene.resize(w, h);
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
  const w = window.innerWidth || Config.WINDOW_WIDTH;
  const h = window.innerHeight || Config.WINDOW_HEIGHT;
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

function css_coords(e: PointerEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
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
  game.main_scene.wheelmoved(e.deltaX, e.deltaY, e.clientX - rect.left, e.clientY - rect.top);
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

