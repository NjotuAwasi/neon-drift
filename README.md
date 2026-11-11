# Neon Drift

A synthwave hover-car racer in the browser. Three.js + TypeScript + Vite, fully procedural: no image, model or audio assets.

**Play:** https://neon-drift-theta-three.vercel.app

## Features

- **Two tracks**: Sunset Strip (flowing curves) and Downtown (tight street circuit with a chicane), each with its own city and palette
- **Race** against 5 AI rivals on Easy / Normal / Insane, or **Time Trial** solo against your best-lap ghost
- **Drift to boost**: hold drift to charge 3 boost tiers, release to fire
- **Drift score**: drifts bank style points; chaining drifts within 2.5 s multiplies up to ×5, hitting a wall mid-drift is a wipeout
- **Medals** per track: Bronze / Silver / Gold / Neon lap targets
- **Challenge links**: share your best lap; the link carries your ghost so a friend races your exact run
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
| Restart | R | Y | ↻ |
| Menu | Esc | Back | ✕ |
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
