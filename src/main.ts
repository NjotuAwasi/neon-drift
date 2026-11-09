import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Track } from './track';
import { buildWorld } from './world';
import { Car, type CarEvents } from './car';
import { readControls, type Controls } from './input';
import { Hud, fmt } from './hud';
import { AudioFx } from './audio';
import { Ghost } from './ghost';
import { Particles, Trail } from './fx';

const LAPS = 3;
const START_IDX = 10;

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
const car = new Car(scene);
const ghost = new Ghost(scene);
ghost.index(track);
const hud = new Hud(track);
const audio = new AudioFx();
const particles = new Particles(scene);
const trailColor = new THREE.Color(0x22f3ff).multiplyScalar(2.2);
const trails = [new Trail(scene, trailColor), new Trail(scene, trailColor)];
const carLight = new THREE.PointLight(0x22f3ff, 60, 20, 2);
scene.add(carLight);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.95, 0.55, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- race state
type State = 'menu' | 'countdown' | 'racing' | 'finished';
let state: State = 'menu';
let countdown = 0;
let raceClock = 0;
let lapStart = 0;
let lap = 1;
let laps: number[] = [];
let lastLap: number | null = null;
let passedHalf = false;
let prevIdx = START_IDX;
let shake = 0;

const IDLE: Controls = { throttle: 0, brake: 0, steer: 0, drift: false, start: false, restart: false, mute: false };
const TIER_COLORS = [0xf4ecff, 0x22f3ff, 0xff2bd6, 0xffd23f].map((c) => new THREE.Color(c).multiplyScalar(2.5));
const SPARK = new THREE.Color(0xffc040).multiplyScalar(3);

const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const tmp = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();

function resetRace() {
  car.placeAt(track, START_IDX);
  trails.forEach((t) => t.reset());
  lap = 1;
  laps = [];
  passedHalf = false;
  prevIdx = START_IDX;
  raceClock = 0;
  lapStart = 0;
  ghost.startLap();
  snapCamera();
}

function startCountdown() {
  audio.init();
  resetRace();
  state = 'countdown';
  countdown = 3;
  hud.showRace();
  hud.setLap(1, LAPS);
  hud.setTimes(0, ghost.bestTime, lastLap);
  hud.setDelta(null);
  hud.flash('3', 800);
  audio.tones([440], 0, 0.25);
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
    for (let i = 0; i < Math.min(40, s * 2); i++) {
      particles.spawn(car.model.root.position, (Math.random() - 0.5) * 20, Math.random() * 8, (Math.random() - 0.5) * 20, SPARK, 0.4 + Math.random() * 0.4);
    }
  },
};

function completeLap(t: number) {
  laps.push(t);
  lastLap = t;
  const isBest = ghost.finishLap(t);
  if (isBest) {
    ghost.index(track);
    hud.flash('NEW BEST LAP', 1600, 'gold small');
    audio.tones([523, 659, 784, 1047], 0.08, 0.25, 'square', 0.1);
  } else {
    hud.flash(fmt(t), 1300, 'small');
    audio.tones([660, 880], 0.08, 0.2);
  }
  lapStart = raceClock;
  passedHalf = false;
  ghost.startLap();
  lap++;
  if (lap > LAPS) {
    state = 'finished';
    hud.setDelta(null);
    hud.showResults(laps, ghost.bestTime);
  } else if (lap === LAPS) {
    setTimeout(() => state === 'racing' && hud.flash('FINAL LAP', 1200), 1400);
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

function updateCamera(dt: number, time: number) {
  if (state === 'menu') {
    const a = time * 0.22;
    camera.position.set(car.pos.x + Math.sin(a) * 13, 3.2 + Math.sin(time * 0.4) * 0.8, car.pos.z + Math.cos(a) * 13);
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
function updateEffects(dt: number) {
  const h = car.heading;
  right.set(-Math.cos(h), 0, Math.sin(h));
  fwd.set(Math.sin(h), 0, Math.cos(h));
  const root = car.model.root;
  const intensity = THREE.MathUtils.clamp((car.speed - 8) / 50, 0, 1) * (1 + car.boost);

  car.model.thrusterLocal.forEach((local, i) => {
    tmp.copy(local);
    root.localToWorld(tmp);
    trails[i].push(tmp, right, intensity);
    if (car.boost > 0.25) {
      for (let k = 0; k < 2; k++) {
        particles.spawn(tmp, -fwd.x * 25 + (Math.random() - 0.5) * 4, Math.random() * 2, -fwd.z * 25 + (Math.random() - 0.5) * 4, TIER_COLORS[1], 0.35);
      }
    }
  });

  if (car.drifting) {
    const col = TIER_COLORS[car.driftTier];
    for (const sx of [1.1, -1.1]) {
      tmp.set(sx, -0.5, -1.9);
      root.localToWorld(tmp);
      const out = sx * car.driftDir > 0 ? -1 : 1;
      particles.spawn(tmp, right.x * out * 6 + (Math.random() - 0.5) * 3, 2 + Math.random() * 3, right.z * out * 6 + (Math.random() - 0.5) * 3, col, 0.3 + Math.random() * 0.25);
    }
  }
  particles.update(dt);

  carLight.position.set(car.pos.x, 1.2, car.pos.z);
  carLight.intensity = 50 + car.boost * 80;
}

// ---------------------------------------------------------------- loop
car.placeAt(track, START_IDX);
hud.showMenu(ghost.bestTime);

let last = performance.now();
let time = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
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

  const driving = state === 'racing' || state === 'finished';
  car.update(dt, driving ? c : IDLE, track, events);

  let ghostPos: { x: number; z: number } | null = null;
  if (state === 'racing') {
    raceClock += dt;
    const lapT = raceClock - lapStart;
    ghost.record(lapT, car.pos.x, car.pos.z, car.heading, car.model.root.rotation.z);
    const idx = car.trackIdx, N = track.N;
    if (idx > N * 0.45 && idx < N * 0.55) passedHalf = true;
    if (passedHalf && prevIdx > N * 0.9 && idx < N * 0.1) completeLap(lapT);
    prevIdx = idx;

    if (state === 'racing') {
      const t = raceClock - lapStart;
      hud.setLap(lap, LAPS);
      hud.setTimes(t, ghost.bestTime, lastLap);
      const gt = ghost.timeAt(car.trackIdx);
      hud.setDelta(gt !== null && idx > N * 0.03 && idx < N * 0.97 && t > 1 ? t - gt : null);
      ghostPos = ghost.play(t, true);
    }
  }
  if (state !== 'racing') ghost.play(0, false);

  updateEffects(dt);
  updateCamera(dt, time);
  audio.update(car.speed, driving ? c.throttle : 0, car.drifting, car.boost, driving);

  hud.setSpeed(car.speed * 3, car.speed / 140, car.boost > 0.3);
  hud.setDrift(car.drifting ? car.driftFraction : 0, car.driftTier, car.drifting);
  hud.drawMap(car.pos, ghostPos);

  world.update(dt, time, camera);
  composer.render(dt);
}
requestAnimationFrame(frame);
