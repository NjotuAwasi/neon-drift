import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Track } from './track';
import { buildWorld } from './world';
import { Car, type CarEvents } from './car';
import { readControls, type Controls } from './input';
import { Hud, fmt, type Standing } from './hud';
import { AudioFx } from './audio';
import { Ghost } from './ghost';
import { Particles, Trail } from './fx';
import { autopilot } from './ai';

const LAPS = 3;
const PAD_BOOST = 1.1;

// ---------------------------------------------------------------- setup
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 6000);

const track = new Track(scene, renderer.capabilities.getMaxAnisotropy());
const world = buildWorld(scene, renderer, track);
const ghost = new Ghost(scene);
ghost.index(track);
const hud = new Hud(track);
const audio = new AudioFx();
const particles = new Particles(scene);
const carLight = new THREE.PointLight(0x22f3ff, 22, 20, 2);
scene.add(carLight);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.5, 0.72));
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- racers
interface Racer {
  name: string;
  css: string;
  car: Car;
  trails: Trail[];
  isPlayer: boolean;
  skill: number;
  lane: number;
  seeksPads: boolean;
  lap: number;
  passedHalf: boolean;
  prevIdx: number;
  finishTime: number | null;
}

const RIVALS = [
  { name: 'VEGA', accent: 0xffa21f, glow: 0xffd23f, skill: 0.985, lane: -3, pads: true },
  { name: 'NOVA', accent: 0x3dff8b, glow: 0x9dffcf, skill: 0.96, lane: 3.5, pads: false },
  { name: 'RAZOR', accent: 0xff3b3b, glow: 0xff8a5c, skill: 0.94, lane: -1, pads: true },
  { name: 'LUXE', accent: 0xb46bff, glow: 0xe3b8ff, skill: 0.92, lane: 4, pads: false },
  { name: 'KAI', accent: 0x6fb8ff, glow: 0xf4ecff, skill: 0.89, lane: -4.5, pads: true },
];
// two-wide grid, player starts at the back so there is something to chase
const GRID = [
  { idx: 46, lat: -4 }, { idx: 40, lat: 4 }, { idx: 32, lat: -4 },
  { idx: 26, lat: 4 }, { idx: 18, lat: -4 }, { idx: 12, lat: 4 },
];

function makeRacer(name: string, accent: number, glow: number, isPlayer: boolean, skill = 1, lane = 0, seeksPads = false): Racer {
  const car = new Car(scene, accent, glow);
  const tc = new THREE.Color(glow).multiplyScalar(isPlayer ? 1.6 : 1.1);
  const n = isPlayer ? 40 : 26;
  return {
    name, css: `#${new THREE.Color(accent).getHexString()}`, car, isPlayer, skill, lane, seeksPads,
    trails: [new Trail(scene, tc, n, 0.11), new Trail(scene, tc, n, 0.11)],
    lap: 1, passedHalf: false, prevIdx: 0, finishTime: null,
  };
}

const player = makeRacer('YOU', 0xff2bd6, 0x22f3ff, true);
const racers: Racer[] = [
  ...RIVALS.map((r) => makeRacer(r.name, r.accent, r.glow, false, r.skill, r.lane, r.pads)),
  player,
];
const car = player.car;

// ---------------------------------------------------------------- race state
type State = 'menu' | 'countdown' | 'racing' | 'finished';
let state: State = 'menu';
let countdown = 0;
let raceClock = 0;
let lapStart = 0;
let laps: number[] = [];
let lastLap: number | null = null;
let shake = 0;
let resultsTimer = 0;
let time = 0;

const debug = { autopilot: false };
const QUIET: CarEvents = { onBoost() {}, onImpact() {} };
const IDLE: Controls = { throttle: 0, brake: 0, steer: 0, drift: false, start: false, restart: false, mute: false };
const TIER_COLORS = [0xf4ecff, 0x22f3ff, 0xff2bd6, 0xffd23f].map((c) => new THREE.Color(c).multiplyScalar(2.5));
const SPARK = new THREE.Color(0xffc040).multiplyScalar(3);

const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const tmp = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();

function progress(r: Racer) {
  return (r.lap - 1) * track.N + r.car.trackIdx;
}

function standings(): Racer[] {
  return [...racers].sort((a, b) => {
    if (a.finishTime !== null || b.finishTime !== null) {
      if (a.finishTime === null) return 1;
      if (b.finishTime === null) return -1;
      return a.finishTime - b.finishTime;
    }
    return progress(b) - progress(a);
  });
}

function resetGrid() {
  racers.forEach((r, i) => {
    r.car.placeAt(track, GRID[i].idx, GRID[i].lat);
    r.trails.forEach((t) => t.reset());
    r.lap = 1;
    r.passedHalf = false;
    r.prevIdx = r.car.trackIdx;
    r.finishTime = null;
  });
}

function startCountdown() {
  audio.init();
  resetGrid();
  laps = [];
  raceClock = 0;
  lapStart = 0;
  ghost.startLap();
  snapCamera();
  state = 'countdown';
  countdown = 3;
  hud.showRace();
  hud.setLap(1, LAPS);
  hud.setPosition(racers.length, racers.length);
  hud.setTimes(0, ghost.bestTime, lastLap);
  hud.setDelta(null);
  hud.flash('3', 800);
  audio.tones([440], 0, 0.25);
  audio.music?.setIntensity(1);
}

const events: CarEvents = {
  onBoost(tier) {
    audio.boost(tier);
    shake = Math.max(shake, 0.2 + tier * 0.12);
    hud.flash(['', 'BOOST', 'SUPER BOOST', 'ULTRA BOOST'][tier], 700, tier === 3 ? 'gold small' : 'cyan small');
  },
  onImpact(s) {
    audio.impact(s);
    shake = Math.max(shake, Math.min(0.9, s * 0.04));
    sparks(car.model.root.position, s);
  },
};

function sparks(at: THREE.Vector3, s: number) {
  for (let i = 0; i < Math.min(40, s * 2); i++) {
    particles.spawn(at, (Math.random() - 0.5) * 20, Math.random() * 8, (Math.random() - 0.5) * 20, SPARK, 0.4 + Math.random() * 0.4);
  }
}

/** Lap bookkeeping for every racer; player additionally drives timing, ghost and HUD. */
function updateLaps(r: Racer) {
  const idx = r.car.trackIdx, N = track.N;
  if (idx > N * 0.45 && idx < N * 0.55) r.passedHalf = true;
  const crossed = r.passedHalf && r.prevIdx > N * 0.9 && idx < N * 0.1;
  r.prevIdx = idx;
  if (!crossed || r.finishTime !== null) return;
  r.passedHalf = false;
  r.lap++;
  if (r.lap > LAPS) r.finishTime = raceClock;
  if (r.isPlayer) completePlayerLap(raceClock - lapStart);
}

function completePlayerLap(t: number) {
  laps.push(t);
  lastLap = t;
  if (ghost.finishLap(t)) {
    ghost.index(track);
    hud.flash('NEW BEST LAP', 1600, 'gold small');
    audio.tones([523, 659, 784, 1047], 0.08, 0.25, 'square', 0.1);
  } else {
    hud.flash(fmt(t), 1300, 'small');
    audio.tones([660, 880], 0.08, 0.2);
  }
  lapStart = raceClock;
  ghost.startLap();
  if (player.lap > LAPS) {
    state = 'finished';
    const pos = standings().indexOf(player) + 1;
    hud.setDelta(null);
    hud.flash(pos === 1 ? 'YOU WIN!' : `${pos}${['st', 'nd', 'rd'][pos - 1] ?? 'th'} PLACE`, 2200, pos === 1 ? 'gold' : 'cyan');
    if (pos === 1) audio.tones([523, 659, 784, 1047, 1319, 1568], 0.09, 0.3, 'square', 0.1);
    audio.music?.setIntensity(1);
    resultsTimer = 1.5;
  } else if (player.lap === LAPS) {
    audio.music?.setIntensity(2);
    setTimeout(() => state === 'racing' && hud.flash('FINAL LAP', 1200), 1400);
  }
}

function showResults() {
  const rows: Standing[] = standings().map((r) => ({ name: r.name, color: r.css, isPlayer: r.isPlayer, time: r.finishTime }));
  hud.showResults(laps, ghost.bestTime, rows);
}

/** Circle-vs-circle bumps between hovercars. */
function collideCars() {
  const R = 3.0;
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i].car, b = racers[j].car;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const push = (R - d) / 2;
      a.pos.x -= nx * push; a.pos.z -= nz * push;
      b.pos.x += nx * push; b.pos.z += nz * push;
      const rel = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * nz;
      if (rel >= 0) continue;
      const jImp = (-(1 + 0.35) * rel) / 2;
      a.vel.x -= nx * jImp; a.vel.y -= nz * jImp;
      b.vel.x += nx * jImp; b.vel.y += nz * jImp;
      if ((racers[i].isPlayer || racers[j].isPlayer) && -rel > 3) {
        audio.impact(-rel);
        shake = Math.max(shake, Math.min(0.7, -rel * 0.05));
        tmp.set((a.pos.x + b.pos.x) / 2, 0.8, (a.pos.z + b.pos.z) / 2);
        sparks(tmp, -rel);
      }
    }
  }
}

function aiControls(r: Racer, menu: boolean): Controls {
  const c = r.car;
  let skill = r.skill;
  if (!menu && !r.isPlayer) {
    // gentle rubber band keeps the pack within reach without being obvious
    const gap = (progress(r) - progress(player)) * (track.length / track.N);
    skill += THREE.MathUtils.clamp(-gap / 700, -0.06, 0.05);
  }
  if (menu) skill *= 0.85;
  let lane = r.isPlayer ? 0 : r.lane + Math.sin(time * 0.35 + r.skill * 40) * 1.5;
  if (r.seeksPads || r.isPlayer) {
    const pad = track.padAhead(c.trackIdx, 110);
    if (pad) lane = pad.lat;
  }
  return autopilot(c, track, Math.min(1.02, skill), lane);
}

// ---------------------------------------------------------------- camera
function snapCamera() {
  const h = car.heading;
  fwd.set(Math.sin(h), 0, Math.cos(h));
  camPos.copy(car.pos).addScaledVector(fwd, -10.5).setY(4.2);
  camera.position.copy(camPos);
  camera.lookAt(tmp.copy(car.pos).addScaledVector(fwd, 6).setY(1.4));
}

function updateCamera(dt: number) {
  if (state === 'menu') {
    const a = time * 0.18;
    tmp.set(car.pos.x + Math.sin(a) * 14, 3 + Math.sin(time * 0.4) * 1.2, car.pos.z + Math.cos(a) * 14);
    camPos.lerp(tmp, 1 - Math.exp(-3 * dt));
    camera.position.copy(camPos);
    camera.lookAt(car.pos.x, 1.2, car.pos.z);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  const h = car.heading;
  fwd.set(Math.sin(h), 0, Math.cos(h));
  if (car.speed > 6) {
    tmp.set(car.vel.x, 0, car.vel.y).normalize();
    fwd.lerp(tmp, 0.35).normalize();
  }
  const sp = THREE.MathUtils.clamp(car.speed / 140, 0, 1);
  tmp.copy(car.pos).addScaledVector(fwd, -(10.5 + sp * 2.5)).setY(4.2 - sp * 0.7);
  camPos.lerp(tmp, 1 - Math.exp(-7 * dt));
  camera.position.copy(camPos);
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
  }
  shake *= Math.exp(-5 * dt);
  lookAt.copy(car.pos).addScaledVector(fwd, 6).setY(1.4);
  camera.lookAt(lookAt);
  const fov = 66 + sp * 20 + car.boost * 8;
  camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- effects
function updateEffects(r: Racer) {
  const c = r.car;
  const h = c.heading;
  right.set(-Math.cos(h), 0, Math.sin(h));
  fwd.set(Math.sin(h), 0, Math.cos(h));
  const root = c.model.root;
  const intensity = THREE.MathUtils.clamp((c.speed - 8) / 50, 0, 1) * (0.7 + c.boost * 0.8);

  c.model.thrusterLocal.forEach((local, i) => {
    tmp.copy(local);
    root.localToWorld(tmp);
    r.trails[i].push(tmp, right, intensity);
    if (c.boost > 0.25 && (r.isPlayer || Math.random() < 0.4)) {
      particles.spawn(tmp, -fwd.x * 25 + (Math.random() - 0.5) * 4, Math.random() * 2, -fwd.z * 25 + (Math.random() - 0.5) * 4, TIER_COLORS[1], 0.35);
    }
  });

  if (r.isPlayer && c.drifting) {
    const col = TIER_COLORS[c.driftTier];
    for (const sx of [1.1, -1.1]) {
      tmp.set(sx, -0.5, -1.9);
      root.localToWorld(tmp);
      const out = sx * c.driftDir > 0 ? -1 : 1;
      particles.spawn(tmp, right.x * out * 6 + (Math.random() - 0.5) * 3, 2 + Math.random() * 3, right.z * out * 6 + (Math.random() - 0.5) * 3, col, 0.3 + Math.random() * 0.25);
    }
  }
}

// ---------------------------------------------------------------- loop
resetGrid();
hud.showMenu(ghost.bestTime);

let last = performance.now();

function frame(now: number) {
  requestAnimationFrame(frame);
  // rAF timestamps can precede `last` on the first frame; never let dt go negative
  const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.05);
  last = now;
  time += dt;

  const c = readControls(dt);
  if (c.mute) audio.toggleMute();

  if (state === 'menu') {
    if (c.start) startCountdown();
  } else if (state === 'countdown') {
    const before = Math.ceil(countdown);
    countdown -= dt;
    const after = Math.ceil(countdown);
    if (after !== before && after > 0) {
      hud.flash(String(after), 800);
      audio.tones([440], 0, 0.25);
    }
    if (countdown <= 0) {
      state = 'racing';
      hud.flash('GO!', 900, 'cyan');
      audio.tones([880, 1320], 0.06, 0.4);
      raceClock = 0;
      lapStart = 0;
      ghost.startLap();
    }
  } else if (c.restart || (state === 'finished' && c.start)) {
    startCountdown();
  }

  const menu = state === 'menu';
  const live = state === 'racing' || state === 'finished';
  if (live) raceClock += dt;

  for (const r of racers) {
    let input: Controls;
    if (state === 'countdown') input = IDLE;
    else if (r.isPlayer && state === 'racing' && !debug.autopilot) input = c;
    else input = aiControls(r, menu);
    r.car.update(dt, input, track, r.isPlayer && !menu ? events : QUIET);

    const n = track.nearest(r.car.pos.x, r.car.pos.z, r.car.trackIdx);
    if (track.padAt(n.idx, n.lat) && r.car.padBoost(PAD_BOOST) && r.isPlayer && !menu) {
      audio.pad();
      shake = Math.max(shake, 0.25);
    }
    if (live) updateLaps(r);
  }
  collideCars();

  let ghostPos: { x: number; z: number } | null = null;
  if (state === 'racing') {
    const t = raceClock - lapStart;
    ghost.record(t, car.pos.x, car.pos.z, car.heading, car.model.root.rotation.z);
    const idx = car.trackIdx, N = track.N;
    hud.setLap(player.lap, LAPS);
    hud.setTimes(t, ghost.bestTime, lastLap);
    hud.setPosition(standings().indexOf(player) + 1, racers.length);
    const gt = ghost.timeAt(idx);
    hud.setDelta(gt !== null && idx > N * 0.03 && idx < N * 0.97 && t > 1 ? t - gt : null);
    ghostPos = ghost.play(t, true);
  } else {
    ghost.play(0, false);
  }

  if (state === 'finished') {
    resultsTimer -= dt;
    if (resultsTimer <= 0) {
      showResults();
      resultsTimer = 0.5; // refresh as rivals cross the line
    }
  }

  for (const r of racers) updateEffects(r);
  particles.update(dt);
  carLight.position.set(car.pos.x, 1.2, car.pos.z);
  carLight.intensity = 22 + car.boost * 50;

  updateCamera(dt);
  audio.update(car.speed, live ? (state === 'racing' ? c.throttle : 0.6) : 0, car.drifting, car.boost, live);

  hud.setSpeed(car.speed * 3, car.speed / 140, car.boost > 0.3);
  hud.setDrift(car.drifting ? car.driftFraction : 0, car.driftTier, car.drifting);
  hud.drawMap(car.pos, ghostPos, racers.filter((r) => !r.isPlayer).map((r) => ({ x: r.car.pos.x, z: r.car.pos.z, color: r.css })));

  track.update(dt);
  world.update(dt, time, camera);
  composer.render(dt);
}
requestAnimationFrame(frame);

// debug handle for automated checks
(window as unknown as { __nd: unknown }).__nd = {
  car, track, debug, racers,
  get state() { return state; },
  get lat() { return track.nearest(car.pos.x, car.pos.z, car.trackIdx).lat; },
  get standings() { return standings().map((r) => `${r.name}:${r.lap}:${r.finishTime?.toFixed(2) ?? '-'}`).join(' '); },
};
