import { touch } from './touch';

export interface Controls {
  throttle: number;
  brake: number;
  /** +1 = left, -1 = right */
  steer: number;
  drift: boolean;
  start: boolean; // edge-triggered
  restart: boolean; // edge-triggered
  mute: boolean; // edge-triggered
  back: boolean; // edge-triggered
  camera: boolean; // edge-triggered: chase <-> driver view
  navX: number; // edge-triggered menu navigation, -1/0/1
  navY: number;
}

const keys = new Set<string>();
const pressed = new Set<string>();
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'];

const typing = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
};

window.addEventListener('keydown', (e) => {
  if (typing(e)) return;
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  // also stops Space/Enter from "clicking" whichever button has focus
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

let kbSteer = 0;
let prevPad: boolean[] = [];
let prevStickX = 0;
let prevStickY = 0;

const any = (...codes: string[]) => codes.some((c) => keys.has(c));
const tapped = (...codes: string[]) => codes.some((c) => pressed.has(c));

export function readControls(dt: number): Controls {
  const left = any('KeyA', 'ArrowLeft') || touch.left;
  const right = any('KeyD', 'ArrowRight') || touch.right;
  const target = (left ? 1 : 0) - (right ? 1 : 0);
  const rate = target === 0 ? 8 : Math.sign(target) !== Math.sign(kbSteer) ? 10 : 5;
  kbSteer += Math.sign(target - kbSteer) * Math.min(Math.abs(target - kbSteer), rate * dt);

  const c: Controls = {
    // touch screens accelerate automatically unless braking
    throttle: any('KeyW', 'ArrowUp') || (touch.active && !touch.brake) ? 1 : 0,
    brake: any('KeyS', 'ArrowDown') || touch.brake ? 1 : 0,
    steer: kbSteer,
    drift: any('Space', 'ShiftLeft', 'ShiftRight') || touch.drift,
    start: tapped('Enter', 'NumpadEnter'),
    restart: tapped('KeyR'),
    mute: tapped('KeyM'),
    back: tapped('Escape'),
    camera: tapped('KeyC', 'KeyV'),
    navX: (tapped('ArrowRight', 'KeyD') ? 1 : 0) - (tapped('ArrowLeft', 'KeyA') ? 1 : 0),
    navY: (tapped('ArrowDown', 'KeyS') ? 1 : 0) - (tapped('ArrowUp', 'KeyW') ? 1 : 0),
  };
  pressed.clear();

  const pad = navigator.getGamepads?.().find((p) => p && p.connected);
  if (pad) {
    const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
    const val = (i: number) => pad.buttons[i]?.value ?? 0;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const dz = 0.12;
    const stick = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
    if (Math.abs(stick) > Math.abs(c.steer)) c.steer = -stick;
    c.throttle = Math.max(c.throttle, val(7));
    c.brake = Math.max(c.brake, val(6));
    c.drift ||= btn(2) || btn(5) || btn(1);
    const edge = (i: number) => btn(i) && !prevPad[i];
    c.start ||= edge(0) || edge(9);
    c.restart ||= edge(3);
    c.back ||= edge(8);
    c.camera ||= edge(4); // LB
    // menu navigation: d-pad, or flicking the stick
    const sx = Math.abs(ax) > 0.6 ? Math.sign(ax) : 0;
    const sy = Math.abs(ay) > 0.6 ? Math.sign(ay) : 0;
    if (!c.navX) c.navX = (edge(15) ? 1 : 0) - (edge(14) ? 1 : 0) || (sx !== prevStickX ? sx : 0);
    if (!c.navY) c.navY = (edge(13) ? 1 : 0) - (edge(12) ? 1 : 0) || (sy !== prevStickY ? sy : 0);
    prevStickX = sx;
    prevStickY = sy;
    prevPad = pad.buttons.map((b) => b.pressed);
  }
  return c;
}
