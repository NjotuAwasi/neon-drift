# Neon Drift

A synthwave hover-car racer in the browser. Three.js + TypeScript + Vite, fully procedural: no image, model or audio assets.

**Play:** https://neon-drift-theta-three.vercel.app

## Features

- **Garage**: before every race, pick your car on a 3D turntable. Orbit, zoom and pan freely or jump to preset views (3/4, front, side, rear, top, low)
- **Two cars**: Neon Wedge (light, agile) or the stainless-gray Tesla Cybertruck (higher top speed, heavier, shoves rivals aside)
- **Two tracks**: Sunset Strip (flowing curves) and Downtown (tight street circuit with a chicane), each with its own city and palette
- **Race** against 5 AI rivals on Easy / Normal / Insane, or **Time Trial** solo against your best-lap ghost
- **Drift to boost**: hold drift to charge 3 boost tiers, release to fire
- **Drift score**: drifts bank style points; chaining drifts within 2.5 s multiplies up to ×5, hitting a wall mid-drift is a wipeout
- **Medals** per track: Bronze / Silver / Gold / Neon lap targets
- **Challenge links**: share your best lap; the link carries your ghost so a friend races your exact run
- **Driver view**: switch between the chase cam and a first-person cockpit with a live dash screen and a wheel that turns with you
- Boost pads, live position, minimap, synthesized engine/drift/boost audio and soundtrack
- Keyboard, gamepad (Xbox/PlayStation) and touch controls (auto-throttle on phones)

## Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Accelerate | W / ↑ | RT | automatic |
| Brake / reverse | S / ↓ | LT | BRAKE |
| Steer | A D / ← → | Left stick | ◀ ▶ |
| Drift (hold) | Space / Shift | X / B / RB | DRIFT |
| Start / confirm | Enter | A / Start | tap |
| Driver / chase camera | C | LB | 👁 |
| Restart | R | Y | ↻ |
| Menu | Esc | Back | ✕ |
| Garage: change car / view | ← → / ↑ ↓ | D-pad | ◀ ▶ / view buttons |
| Garage: orbit camera | mouse drag, wheel zoom, right-drag pan | right stick | drag, pinch |
| Mute | M | | ♪ |

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
npx vercel --prod  # deploy
```

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm run typecheck` and `npm run build` to make sure everything compiles. For larger changes, open an issue first so we can talk through the idea.

## License

[MIT](LICENSE) © Njotu Awasi
