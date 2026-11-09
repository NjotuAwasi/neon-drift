# Neon Drift

A synthwave hover-car time-trial in the browser. Built with Three.js + TypeScript + Vite. Everything is procedural: no image, model or audio assets.

- 3-lap races on a neon circuit through a procedural city
- Hold drift to charge, release to boost (3 tiers)
- Ghost of your best lap with a live ± delta
- Best lap is saved in the browser
- Keyboard and gamepad (Xbox/PlayStation) support
- Synthesized engine, drift and boost audio

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Accelerate | W / ↑ | RT |
| Brake / reverse | S / ↓ | LT |
| Steer | A D / ← → | Left stick |
| Drift (hold) | Space / Shift | X / B / RB |
| Start | Enter | A / Start |
| Restart | R | Y |
| Mute | M | |

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```
