# Clicker Adventure (Web)

Web port of the LÖVE2D clicker/idle game (`../clicker-adventure-love2d`). TypeScript + Canvas, playable on desktop and mobile browsers; deploys as static files.

## Commands

- `npm test` — run the Vitest suite (logic modules + layout lint + UI hit-testing/draw smoke)
- `npm run dev` / `npm run build` — dev server / production build (`dist/`)

## Layout

- `src/config.ts` — all constants and balancing numbers
- `src/state.ts` — single source of truth for game state
- `src/game.ts` — container wiring + boot (save load, offline, daily)
- `src/systems/` — pure logic modules (no DOM calls)
- `src/ui/` — Canvas rendering + pointer/touch input; geometry from `src/ui/layout.ts`
- `tests/` — one Vitest file per module

Save/load uses localStorage under the keys in `src/config.ts`. Design spec: `../clicker-adventure-love2d/docs/superpowers/specs/2026-10-01-clicker-adventure-web-design.md`.
