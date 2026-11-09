export interface Controls {
  throttle: number;
  brake: number;
  /** +1 = left, -1 = right */
  steer: number;
  drift: boolean;
  start: boolean; // edge-triggered
  restart: boolean; // edge-triggered
  mute: boolean; // edge-triggered
}

const keys = new Set<string>();
const pressed = new Set<string>();
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

window.addEventListener('keydown', (e) => {
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

let kbSteer = 0;
let prevPad: boolean[] = [];

const any = (...codes: string[]) => codes.some((c) => keys.has(c));
const tapped = (...codes: string[]) => codes.some((c) => pressed.has(c));

export function readControls(dt: number): Controls {
  const target = (any('KeyA', 'ArrowLeft') ? 1 : 0) - (any('KeyD', 'ArrowRight') ? 1 : 0);
  const rate = target === 0 ? 8 : Math.sign(target) !== Math.sign(kbSteer) ? 10 : 5;
  kbSteer += Math.sign(target - kbSteer) * Math.min(Math.abs(target - kbSteer), rate * dt);

  const c: Controls = {
    throttle: any('KeyW', 'ArrowUp') ? 1 : 0,
    brake: any('KeyS', 'ArrowDown') ? 1 : 0,
    steer: kbSteer,
    drift: any('Space', 'ShiftLeft', 'ShiftRight'),
    start: tapped('Enter', 'NumpadEnter'),
    restart: tapped('KeyR'),
    mute: tapped('KeyM'),
  };
  pressed.clear();

  const pad = navigator.getGamepads?.().find((p) => p && p.connected);
  if (pad) {
    const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
    const val = (i: number) => pad.buttons[i]?.value ?? 0;
    const ax = pad.axes[0] ?? 0;
    const dz = 0.12;
    const stick = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
    if (Math.abs(stick) > Math.abs(c.steer)) c.steer = -stick;
    c.throttle = Math.max(c.throttle, val(7));
    c.brake = Math.max(c.brake, val(6));
    c.drift ||= btn(2) || btn(5) || btn(1);
    const edge = (i: number) => btn(i) && !prevPad[i];
    c.start ||= edge(0) || edge(9);
    c.restart ||= edge(3);
    prevPad = pad.buttons.map((b) => b.pressed);
  }
  return c;
}
