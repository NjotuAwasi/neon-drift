import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Track } from './track';
import { MEDALS, TRACKS, medalFor, nextMedal, type TrackDef } from './tracks';
import { buildCity, buildEnvironment } from './world';
import { Car, type CarEvents } from './car';
import { readControls, type Controls } from './input';
import { goFullscreen, initTouch, isTouch } from './touch';
import { Hud, fmt, ordinal } from './hud';
import { AudioFx } from './audio';
import { GhostCar, loadBest, saveBest, type GhostData } from './ghost';
import { Particles, Trail } from './fx';
import { drive } from './ai';
import { Menu, loadSettings } from './menu';
import { challengeLink, decodeChallenge, shareLink, type Challenge } from './challenge';

const LAPS = 3;
const PAD_BOOST = 1.1;
const DIFFICULTY = {
  // the AI follows near-optimal lines; Normal is tuned to roughly the original rivals' pace
  easy: { mul: 0.81, band: 0.07, aiBoost: false },
  normal: { mul: 0.91, band: 0.05, aiBoost: false },
  insane: { mul: 1.02, band: 0.025, aiBoost: true },
} as const;

// ---------------------------------------------------------------- setup
const touchDevice = isTouch();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, touchDevice ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 6000);
const env = buildEnvironment(scene, renderer);
const hud = new Hud();
const audio = new AudioFx();
const particles = new Particles(scene);
const ghost = new GhostCar(scene);
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
  outLap: boolean;
  boostCd: number;
}

const RIVALS = [
  { name: 'VEGA', accent: 0xffa21f, glow: 0xffd23f, skill: 0.985, lane: -3, pads: true },
  { name: 'NOVA', accent: 0x3dff8b, glow: 0x9dffcf, skill: 0.96, lane: 3.5, pads: false },
  { name: 'RAZOR', accent: 0xff3b3b, glow: 0xff8a5c, skill: 0.94, lane: -1, pads: true },
  { name: 'LUXE', accent: 0xb46bff, glow: 0xe3b8ff, skill: 0.92, lane: 4, pads: false },
  { name: 'KAI', accent: 0x6fb8ff, glow: 0xf4ecff, skill: 0.89, lane: -4.5, pads: true },
];
// two-wide grid (distance past the line in world units); player starts at the back
const GRID = [
  { d: 62, lat: -4 }, { d: 54, lat: 4 }, { d: 43, lat: -4 },
  { d: 35, lat: 4 }, { d: 24, lat: -4 }, { d: 16, lat: 4 },
];

function makeRacer(name: string, accent: number, glow: number, isPlayer: boolean, skill = 1, lane = 0, seeksPads = false): Racer {
  const car = new Car(scene, accent, glow);
  const tc = new THREE.Color(glow).multiplyScalar(isPlayer ? 1.6 : 1.1);
  const n = isPlayer ? 40 : 26;
  return {
    name, css: `#${new THREE.Color(accent).getHexString()}`, car, isPlayer, skill, lane, seeksPads,
    trails: [new Trail(scene, tc, n, 0.11), new Trail(scene, tc, n, 0.11)],
    lap: 1, passedHalf: false, prevIdx: 0, finishTime: null, outLap: false, boostCd: 0,
  };
}

const player = makeRacer('YOU', 0xff2bd6, 0x22f3ff, true);
const racers: Racer[] = [
  ...RIVALS.map((r) => makeRacer(r.name, r.accent, r.glow, false, r.skill, r.lane, r.pads)),
  player,
];
const car = player.car;
let field: Racer[] = racers;

// ---------------------------------------------------------------- state
type State = 'menu' | 'countdown' | 'racing' | 'finished';
let state: State = 'menu';
const settings = loadSettings();
let mode: 'race' | 'tt' = settings.mode;
let challenge: Challenge | null = null;
let ownBest: GhostData | null = null;
let shownGhost: GhostData | null = null; // the ghost being raced (own best or a challenger's)
let startMedal = -1;
let countdown = 0;
let raceClock = 0;
let lapStart = 0;
let laps: number[] = [];
let lastLap: number | null = null;
let runNewBest = false;
let runStyleBest = false;
let shake = 0;
let resultsTimer = 0;
let time = 0;
let challengeUrl: string | null = null;
const style = { total: 0, current: 0, chain: 0, chainTimer: 0, was: false };

const debug = { autopilot: false, autoDrift: false };
const QUIET: CarEvents = { onBoost() {}, onImpact() {} };
const IDLE: Controls = { throttle: 0, brake: 0, steer: 0, drift: false, start: false, restart: false, mute: false, back: false, navX: 0, navY: 0 };
const TIER_COLORS = [0xf4ecff, 0x22f3ff, 0xff2bd6, 0xffd23f].map((c) => new THREE.Color(c).multiplyScalar(2.5));
const SPARK = new THREE.Color(0xffc040).multiplyScalar(3);

const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const tmp = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();

// ---------------------------------------------------------------- tracks
const built = new Map<string, Track>();
let track!: Track;
let def!: TrackDef;

function useTrack(id: string) {
  const d = TRACKS.find((t) => t.id === id) ?? TRACKS[0];
  if (track?.def.id === d.id) return;
  if (track) track.group.visible = false;
  let t = built.get(d.id);
  if (!t) {
    t = new Track(d, renderer.capabilities.getMaxAnisotropy());
    t.group.add(buildCity(t, d.city));
    scene.add(t.group);
    built.set(d.id, t);
  }
  t.group.visible = true;
  track = t;
  def = d;
  env.setPalette(d);
  hud.setTrack(t);
  ownBest = loadBest(d.ghostKey);
  resetGrid();
  snapMenuCamera();
  refreshMenu();
}

function loadStyleBest() {
  try { return Number(localStorage.getItem(def.styleKey)) || null; } catch { return null; }
}
function saveStyleBest(v: number) {
  try { localStorage.setItem(def.styleKey, String(Math.round(v))); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- menu & flow
const menu = new Menu(settings, {
  changed(what) {
    if (what === 'track') useTrack(settings.track);
    else refreshMenu();
  },
  start: () => startRace(),
  dismiss: () => dismissChallenge(),
});

function refreshMenu() {
  if (!def) return;
  const best = ownBest?.time ?? null;
  menu.setInfo(def, { best, medal: medalFor(def, best), next: nextMedal(def, best), style: loadStyleBest() });
}

hud.onResults({
  again: () => startRace(),
  menu: () => enterMenu(),
  challenge: () => void sendChallenge(),
});

initTouch({
  mute: () => audio.toggleMute(),
  restart: () => { if (state !== 'menu') startRace(); },
  menu: () => enterMenu(),
});

function setRacerVisible(r: Racer, v: boolean) {
  r.car.model.root.visible = v;
  r.trails.forEach((t) => (t.mesh.visible = v));
}

function resetGrid() {
  racers.forEach((r, i) => {
    r.car.placeAt(track, Math.round(GRID[i].d / track.spacing), GRID[i].lat);
    r.trails.forEach((t) => t.reset());
    r.lap = 1;
    r.passedHalf = false;
    r.prevIdx = r.car.trackIdx;
    r.finishTime = null;
    r.outLap = false;
    r.boostCd = 2 + Math.random() * 3;
  });
}

/** Time trial: start behind the line so every timed lap is a flying lap. */
function placeTimeTrial() {
  player.car.placeAt(track, track.N - Math.round(60 / track.spacing), 0);
  player.prevIdx = player.car.trackIdx;
  player.outLap = true;
}

function enterMenu() {
  state = 'menu';
  field = racers;
  racers.forEach((r) => setRacerVisible(r, true));
  resetGrid();
  ghost.hide();
  hud.hideRace();
  menu.show();
  refreshMenu();
  snapMenuCamera();
  audio.music?.setIntensity(0);
}

function startRace() {
  (document.activeElement as HTMLElement | null)?.blur?.();
  audio.init();
  if (touchDevice) goFullscreen();
  if (challenge) useTrack(challenge.trackId);
  mode = challenge ? 'tt' : settings.mode;
  field = mode === 'race' ? racers : [player];
  racers.forEach((r) => setRacerVisible(r, field.includes(r)));
  resetGrid();
  if (mode === 'tt') placeTimeTrial();

  shownGhost = challenge ? { time: challenge.time, frames: challenge.frames } : ownBest;
  ghost.setColor(challenge ? 0xffd23f : 0x22f3ff);
  ghost.setData(shownGhost, track);
  ghost.startLap();
  laps = [];
  lastLap = null;
  raceClock = 0;
  lapStart = 0;
  runNewBest = false;
  runStyleBest = false;
  Object.assign(style, { total: 0, current: 0, chain: 0, chainTimer: 0, was: false });
  startMedal = medalFor(def, ownBest?.time);
  challengeUrl = null;
  hud.setChallengeState('none');

  menu.hide();
  hud.showRace(mode);
  hud.setLap(1, LAPS);
  hud.setPosition(field.length, field.length);
  hud.setTimes(mode === 'tt' ? null : 0, shownGhost?.time ?? null, null);
  hud.setDelta(null);
  hud.setStyle(0);
  snapCamera();
  state = 'countdown';
  countdown = 3;
  hud.flash('3', 800);
  audio.tones([440], 0, 0.25);
  audio.music?.setIntensity(1);
}

// ---------------------------------------------------------------- challenges
async function loadChallengeFromHash() {
  const m = /^#c=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return;
  const ch = await decodeChallenge(m[1]);
  if (!ch) return;
  if (state !== 'menu') enterMenu();
  challenge = ch;
  useTrack(ch.trackId);
  menu.setChallenge(ch, def.name);
  refreshMenu();
}

function dismissChallenge() {
  challenge = null;
  history.replaceState(null, '', location.pathname + location.search);
  menu.setChallenge(null);
  useTrack(settings.track);
  refreshMenu();
}

async function prepareChallengeLink() {
  if (!ownBest) { hud.setChallengeState('none'); return; }
  hud.setChallengeState('pending');
  const forTrack = def, best = ownBest;
  try {
    const url = await challengeLink({ trackId: forTrack.id, name: settings.name, time: best.time, frames: best.frames });
    if (state !== 'finished' || def !== forTrack) return;
    challengeUrl = url;
    hud.setChallengeState('ready');
  } catch {
    hud.setChallengeState('none');
  }
}

async function sendChallenge() {
  if (!challengeUrl || !ownBest) return;
  const text = `${settings.name} drove ${fmt(ownBest.time)} on ${def.name} in NEON DRIFT. Beat my ghost:`;
  const res = await shareLink(challengeUrl, text);
  if (res === 'shared') hud.shareStatus('Challenge sent!', null);
  else if (res === 'copied') hud.shareStatus('Link copied. Paste it to your friend.', null);
  else if (res === 'manual') hud.shareStatus('Copy this link and send it:', challengeUrl);
}

// ---------------------------------------------------------------- race logic
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
    if (s > 9) wipeout();
  },
};

function sparks(at: THREE.Vector3, s: number) {
  for (let i = 0; i < Math.min(40, s * 2); i++) {
    particles.spawn(at, (Math.random() - 0.5) * 20, Math.random() * 8, (Math.random() - 0.5) * 20, SPARK, 0.4 + Math.random() * 0.4);
  }
}

function progress(r: Racer) {
  return (r.lap - 1) * track.N + r.car.trackIdx;
}

function standings(): Racer[] {
  return [...field].sort((a, b) => {
    if (a.finishTime !== null || b.finishTime !== null) {
      if (a.finishTime === null) return 1;
      if (b.finishTime === null) return -1;
      return a.finishTime - b.finishTime;
    }
    return progress(b) - progress(a);
  });
}

function updateLaps(r: Racer) {
  const idx = r.car.trackIdx, N = track.N;
  if (idx > N * 0.45 && idx < N * 0.55) r.passedHalf = true;
  const crossed = r.prevIdx > N * 0.85 && idx < N * 0.15;
  r.prevIdx = idx;
  if (!crossed) return;
  if (r.outLap) {
    // time trial run-up done: the clock starts now
    r.outLap = false;
    r.passedHalf = false;
    lapStart = raceClock;
    ghost.startLap();
    hud.flash('LAP 1', 800, 'cyan small');
    return;
  }
  if (!r.passedHalf || r.finishTime !== null) return;
  r.passedHalf = false;
  r.lap++;
  if (r.lap > LAPS) r.finishTime = raceClock;
  if (r.isPlayer) completePlayerLap(raceClock - lapStart);
}

function completePlayerLap(t: number) {
  laps.push(t);
  lastLap = t;
  const lap = ghost.takeRecording(t);
  let msg = fmt(t), cls = 'small', fanfare = false;
  if (!ownBest || t < ownBest.time) {
    ownBest = lap;
    saveBest(def.ghostKey, lap);
    runNewBest = true;
    if (!challenge) {
      shownGhost = lap;
      ghost.setData(lap, track);
    }
    msg = 'NEW BEST LAP';
    cls = 'gold small';
    fanfare = true;
  }
  const m = medalFor(def, t);
  if (m > startMedal) {
    startMedal = m;
    msg = `${MEDALS[m]} MEDAL!`;
    cls = 'gold small';
    fanfare = true;
  }
  hud.flash(msg, 1600, cls);
  if (fanfare) audio.tones([523, 659, 784, 1047], 0.08, 0.25, 'square', 0.1);
  else audio.tones([660, 880], 0.08, 0.2);
  lapStart = raceClock;
  ghost.startLap();
  if (player.lap > LAPS) finishRace();
  else if (player.lap === LAPS) {
    audio.music?.setIntensity(2);
    setTimeout(() => state === 'racing' && hud.flash('FINAL LAP', 1200), 1400);
  }
}

function finishRace() {
  state = 'finished';
  bankStyle();
  const prev = loadStyleBest();
  if (style.total > 0 && style.total > (prev ?? 0)) {
    saveStyleBest(style.total);
    runStyleBest = true;
  }
  hud.setDelta(null);
  audio.music?.setIntensity(1);
  if (mode === 'race') {
    const pos = standings().indexOf(player) + 1;
    hud.flash(pos === 1 ? 'YOU WIN!' : `${ordinal(pos).toUpperCase()} PLACE`, 2200, pos === 1 ? 'gold' : 'cyan');
    if (pos === 1) audio.tones([523, 659, 784, 1047, 1319, 1568], 0.09, 0.3, 'square', 0.1);
  } else {
    hud.flash('FINISH', 1800, 'cyan');
  }
  resultsTimer = 1.5;
  void prepareChallengeLink();
}

function showResults() {
  const best = laps.length ? Math.min(...laps) : null;
  const pos = standings().indexOf(player) + 1;
  let text: string | null = null;
  let won = false;
  if (challenge && best !== null) {
    const d = best - challenge.time;
    won = d < 0;
    text = won ? `You beat ${challenge.name} by ${Math.abs(d).toFixed(3)}s!` : `${challenge.name} still leads by ${d.toFixed(3)}s`;
  }
  hud.showResults({
    mode,
    title: mode === 'race' ? (pos === 1 ? 'YOU WIN!' : `${ordinal(pos).toUpperCase()} PLACE`) : challenge ? (won ? 'CHALLENGE WON' : 'CHALLENGE LOST') : 'TIME TRIAL',
    standings: standings().map((r) => ({ name: r.name, color: r.css, isPlayer: r.isPlayer, time: r.finishTime })),
    laps,
    bestLap: best,
    newBest: runNewBest,
    medal: medalFor(def, best),
    style: style.total,
    styleBest: runStyleBest,
    challengeText: text,
    challengeWon: won,
  });
}

// ---------------------------------------------------------------- drift score
function updateStyle(dt: number) {
  if (state !== 'racing') { style.was = false; return; }
  if (car.drifting) {
    if (!style.was && style.chainTimer <= 0) style.chain = 0;
    style.current += dt * car.speed * Math.min(1.6, 0.35 + Math.abs(car.lateral) / 12) * 9;
  } else if (style.was) {
    bankStyle();
    style.chainTimer = 2.5;
  } else if (style.chainTimer > 0) {
    style.chainTimer -= dt;
    if (style.chainTimer <= 0) style.chain = 0;
  }
  style.was = car.drifting;
  hud.setStyle(style.total);
}

/** Cash in the current drift; consecutive drifts within 2.5 s chain up to ×5. */
function bankStyle() {
  if (style.current < 50) { style.current = 0; return; }
  style.chain = Math.min(5, style.chain + 1);
  const gained = Math.round(style.current * style.chain);
  style.total += gained;
  style.current = 0;
  hud.styleFlash(`+${gained.toLocaleString('en-US')}${style.chain > 1 ? ` ×${style.chain}` : ''}`);
}

function wipeout() {
  if (state !== 'racing' || !car.drifting || style.current < 150) return;
  style.current = 0;
  style.chain = 0;
  hud.styleFlash('WIPEOUT', true);
}

// ---------------------------------------------------------------- AI & collisions
function cornerExit(c: Car) {
  const p = track.profile, i = c.trackIdx;
  return c.speed > 30 && p[i] < 80 && p[track.wrap(i + Math.round(50 / track.spacing))] > 95;
}

function aiControls(r: Racer, inMenu: boolean, dt: number): Controls {
  const d = DIFFICULTY[settings.diff];
  let skill = r.skill;
  if (!r.isPlayer) {
    if (inMenu) skill *= 0.85;
    else {
      skill *= d.mul;
      // gentle rubber band keeps the pack within reach
      const gap = (progress(r) - progress(player)) * track.spacing;
      skill += THREE.MathUtils.clamp(-gap / 700, -d.band, d.band * 0.8);
      // insane rivals cash in "drift boosts" out of corners, like a good player would
      r.boostCd -= dt;
      if (d.aiBoost && state === 'racing' && r.boostCd <= 0 && cornerExit(r.car)) {
        r.car.padBoost(0.8 + Math.random() * 0.7);
        r.boostCd = 3 + Math.random() * 3;
      }
    }
  }
  let lane = r.isPlayer ? 0 : r.lane + Math.sin(time * 0.35 + r.skill * 40) * 1.5;
  if (r.seeksPads || r.isPlayer || (!inMenu && d.aiBoost)) {
    const pad = track.padAhead(r.car.trackIdx, Math.round(100 / track.spacing));
    if (pad) lane = pad.lat;
  }
  return drive(r.car, track, Math.min(1.04, skill), lane);
}

/** Circle-vs-circle bumps between hovercars. */
function collideCars() {
  const R = 3.0;
  for (let i = 0; i < field.length; i++) {
    for (let j = i + 1; j < field.length; j++) {
      const a = field[i].car, b = field[j].car;
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
      if ((field[i].isPlayer || field[j].isPlayer) && -rel > 3) {
        audio.impact(-rel);
        shake = Math.max(shake, Math.min(0.7, -rel * 0.05));
        tmp.set((a.pos.x + b.pos.x) / 2, 0.8, (a.pos.z + b.pos.z) / 2);
        sparks(tmp, -rel);
        if (-rel > 6) wipeout();
      }
    }
  }
}

// ---------------------------------------------------------------- camera
function snapCamera() {
  const h = car.heading;
  fwd.set(Math.sin(h), 0, Math.cos(h));
  camPos.copy(car.pos).addScaledVector(fwd, -10.5).setY(4.2);
  camera.position.copy(camPos);
  camera.lookAt(tmp.copy(car.pos).addScaledVector(fwd, 6).setY(1.4));
}

function snapMenuCamera() {
  camPos.set(car.pos.x + 14, 3, car.pos.z);
  camera.position.copy(camPos);
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
useTrack(settings.track);
enterMenu();
void loadChallengeFromHash();
addEventListener('hashchange', () => void loadChallengeFromHash());

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
    if (c.navX || c.navY) menu.nav(c.navX, c.navY);
    if (c.start) startRace();
  } else if (c.back) {
    enterMenu();
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
    startRace();
  }

  const inMenu = state === 'menu';
  const live = state === 'racing' || state === 'finished';
  if (live) raceClock += dt;

  for (const r of field) {
    let input: Controls;
    if (state === 'countdown') input = IDLE;
    else if (r.isPlayer && state === 'racing' && !debug.autopilot) input = c;
    else {
      input = aiControls(r, inMenu, dt);
      if (r.isPlayer && debug.autoDrift && state === 'racing') input.drift = Math.abs(input.steer) > 0.3 && r.car.speed > 35;
    }
    r.car.update(dt, input, track, r.isPlayer && !inMenu ? events : QUIET);

    const n = track.nearest(r.car.pos.x, r.car.pos.z, r.car.trackIdx);
    if (track.padAt(n.idx, n.lat) && r.car.padBoost(PAD_BOOST) && r.isPlayer && !inMenu) {
      audio.pad();
      shake = Math.max(shake, 0.25);
    }
    if (live) updateLaps(r);
  }
  collideCars();
  updateStyle(dt);

  let ghostPos: { x: number; z: number } | null = null;
  if (state === 'racing') {
    const idx = car.trackIdx, N = track.N;
    hud.setLap(player.lap, LAPS);
    if (mode === 'race') hud.setPosition(standings().indexOf(player) + 1, field.length);
    if (player.outLap) {
      hud.setTimes(null, shownGhost?.time ?? null, lastLap);
      ghost.play(0, false);
    } else {
      const t = raceClock - lapStart;
      ghost.record(t, car.pos.x, car.pos.z, car.heading, car.model.root.rotation.z);
      hud.setTimes(t, shownGhost?.time ?? null, lastLap);
      const gt = ghost.timeAt(idx);
      hud.setDelta(gt !== null && idx > N * 0.03 && idx < N * 0.97 && t > 1 ? t - gt : null, challenge ? challenge.name : 'ghost');
      ghostPos = ghost.play(t, true);
    }
  } else {
    ghost.play(0, false);
  }

  if (state === 'finished') {
    resultsTimer -= dt;
    if (resultsTimer <= 0) {
      showResults();
      resultsTimer = mode === 'race' ? 0.5 : 1e9; // race: refresh as rivals cross the line
    }
  }

  for (const r of field) updateEffects(r);
  particles.update(dt);
  carLight.position.set(car.pos.x, 1.2, car.pos.z);
  carLight.intensity = 22 + car.boost * 50;

  updateCamera(dt);
  audio.update(car.speed, live ? (state === 'racing' ? c.throttle : 0.6) : 0, car.drifting, car.boost, live);

  hud.setSpeed(car.speed * 3, car.speed / 140, car.boost > 0.3);
  hud.setDrift(car.drifting ? car.driftFraction : 0, car.driftTier, car.drifting && state === 'racing', style.current, Math.min(5, style.chain + 1));
  hud.drawMap(car.pos, ghostPos, field.filter((r) => !r.isPlayer).map((r) => ({ x: r.car.pos.x, z: r.car.pos.z, color: r.css })));

  track.update(dt);
  env.update(time, camera);
  composer.render(dt);
}
requestAnimationFrame(frame);

// debug handle for automated checks
(window as unknown as { __nd: unknown }).__nd = {
  car, debug, racers, settings, useTrack, startRace, enterMenu,
  get track() { return track; },
  get state() { return state; },
  get mode() { return mode; },
  get style() { return { ...style }; },
  get laps() { return laps; },
  get ownBest() { return ownBest; },
  get lat() { return track.nearest(car.pos.x, car.pos.z, car.trackIdx).lat; },
  get standings() { return standings().map((r) => `${r.name}:${r.lap}:${r.finishTime?.toFixed(2) ?? '-'}`).join(' '); },
  challengeLink,
  decodeChallenge,
};
