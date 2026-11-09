/** On-screen controls for phones/tablets. Gas is automatic; left thumb steers, right thumb drifts/brakes. */
export const touch = { active: false, left: false, right: false, brake: false, drift: false };

export function isTouch() {
  return matchMedia('(pointer: coarse)').matches;
}

type Action = 'mute' | 'restart' | 'menu';

export function initTouch(actions: Record<Action, () => void>) {
  const enable = () => {
    if (touch.active) return;
    touch.active = true;
    document.body.classList.add('touch');
  };
  if (isTouch()) enable();
  window.addEventListener('touchstart', enable, { passive: true });

  // steering pad: which side of the gap between the two arrows the finger is on
  const steer = document.getElementById('tSteer')!;
  const halves = steer.querySelectorAll<HTMLElement>('.half');
  const sides = new Map<number, number>();
  const sideOf = (x: number) => {
    const a = halves[0].getBoundingClientRect(), b = halves[1].getBoundingClientRect();
    return x < (a.right + b.left) / 2 ? -1 : 1;
  };
  const sync = () => {
    const v = [...sides.values()];
    touch.left = v.includes(-1);
    touch.right = v.includes(1);
    halves[0].classList.toggle('on', touch.left);
    halves[1].classList.toggle('on', touch.right);
  };
  steer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    steer.setPointerCapture(e.pointerId);
    sides.set(e.pointerId, sideOf(e.clientX));
    sync();
  });
  steer.addEventListener('pointermove', (e) => {
    if (!sides.has(e.pointerId)) return;
    sides.set(e.pointerId, sideOf(e.clientX));
    sync();
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    steer.addEventListener(t, (e) => { sides.delete(e.pointerId); sync(); });
  }

  hold(document.getElementById('tBrake')!, (v) => (touch.brake = v));
  hold(document.getElementById('tDrift')!, (v) => (touch.drift = v));

  document.querySelectorAll<HTMLButtonElement>('#tButtons button').forEach((b) =>
    b.addEventListener('click', () => actions[b.dataset.act as Action]?.()));
}

function hold(el: HTMLElement, set: (v: boolean) => void) {
  const ids = new Set<number>();
  const update = () => {
    set(ids.size > 0);
    el.classList.toggle('on', ids.size > 0);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    ids.add(e.pointerId);
    update();
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    el.addEventListener(t, (e) => { ids.delete(e.pointerId); update(); });
  }
}

/** Fullscreen + landscape lock where supported (Android Chrome); silently ignored elsewhere (iOS). */
export function goFullscreen() {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  document.documentElement
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => { /* not allowed here */ });
}
