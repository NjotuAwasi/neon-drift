import * as THREE from 'three';
import { ROAD_HALF, Track } from './track';
import type { Controls } from './input';
import { DEFAULT_SPEC, type CarDef, type CarSpec } from './cars';

export interface CarModel {
  root: THREE.Group;
  flames: THREE.Mesh[];
  underglow: THREE.Mesh;
  thrusterLocal: THREE.Vector3[];
  /** spun around their local x axis with forward speed */
  wheels?: THREE.Object3D[];
  /** how much the flames widen at full boost (a wide bar flame must not outgrow the body) */
  flameGrowX?: number;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
export const GLOW_TEX = glowTexture();

const neon = (c: number, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

/** Extrude a side profile (x = forward, y = up) across `width`, centred on the car's x axis. */
function extrudeProfile(s: THREE.Shape, width: number, bevel: boolean) {
  const geo = new THREE.ExtrudeGeometry(s, bevel
    ? { depth: width, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 3 }
    : { depth: width, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, 0, 0);
  return geo;
}

/** Twin rear thrusters with flames; pushes into the model's flame/thruster lists. */
function addThrusters(body: THREE.Group, glowColor: number, z: number, y: number, xs: number[], flames: THREE.Mesh[], thrusterLocal: THREE.Vector3[]) {
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 1, roughness: 0.3 });
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(glowColor).multiplyScalar(2.5), transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  for (const sx of xs) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.5, 16, 1, true), nozzleMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(sx, y, z);
    body.add(nozzle);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.24, 16), neon(0xffffff, 2));
    core.position.set(sx, y, z - 0.01);
    core.rotation.y = Math.PI;
    body.add(core);
    const fg = new THREE.ConeGeometry(0.24, 1, 16, 1, true);
    fg.translate(0, 0.5, 0); // base at nozzle, tip trailing behind after rotation
    fg.rotateX(-Math.PI / 2);
    const flame = new THREE.Mesh(fg, flameMat);
    flame.position.set(sx, y, z - 0.15);
    body.add(flame);
    flames.push(flame);
    thrusterLocal.push(new THREE.Vector3(sx, y, z - 0.25));
  }
}

/**
 * Single full-width thruster bar (matches the nose and tail light bars): a recessed slot with a glowing
 * core and one flat flame sheet that tapers to a line. Trails leave from both ends of the bar.
 */
function addThrusterBar(body: THREE.Group, glowColor: number, z: number, y: number, width: number, flames: THREE.Mesh[], thrusterLocal: THREE.Vector3[]) {
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.12, 0.2, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 1, roughness: 0.3 }),
  );
  housing.position.set(0, y, z);
  body.add(housing);
  const core = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.02), neon(0xffffff, 2));
  core.position.set(0, y, z - 0.045);
  body.add(core);

  // flame sheet: rectangle at the slot (z = 0) tapering to a narrower line behind (z = -1)
  const hw = width / 2, hh = 0.06, tw = hw * 0.55;
  const v = [
    -hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0, // slot
    -tw, 0, -1, tw, 0, -1, // tip line
  ];
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  fg.setIndex([3, 2, 5, 3, 5, 4, 0, 4, 5, 0, 5, 1, 0, 3, 4, 1, 5, 2]);
  const flame = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
    color: new THREE.Color(glowColor).multiplyScalar(2.5), transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  flame.position.set(0, y, z - 0.05);
  body.add(flame);
  flames.push(flame);
  for (const sx of [hw - 0.1, -(hw - 0.1)]) thrusterLocal.push(new THREE.Vector3(sx, y, z - 0.15));
}

function addHoverPads(body: THREE.Group, glowColor: number, px: number, pz: number) {
  for (const [x, z] of [[px, pz], [-px, pz], [px, -pz], [-px, -pz]]) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), neon(glowColor, 2));
    pad.rotation.x = Math.PI / 2;
    pad.position.set(x, 0.06, z);
    body.add(pad);
  }
}

function makeUnderglow(glowColor: number, w = 5.5, l = 8) {
  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(w, l),
    new THREE.MeshBasicMaterial({
      map: GLOW_TEX, color: new THREE.Color(glowColor).multiplyScalar(0.6), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
  );
  underglow.rotation.x = -Math.PI / 2;
  return underglow;
}

export function makeCarModel(accent = 0xff2bd6, glowColor = 0x22f3ff, paintColor = 0x3a2a66): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // wedge side profile (x = forward, y = up), extruded across the width
  const s = new THREE.Shape();
  s.moveTo(-2.3, 0.15);
  s.lineTo(2.25, 0.12);
  s.lineTo(2.45, 0.32);
  s.lineTo(0.9, 0.62);
  s.lineTo(-0.5, 1.0);
  s.lineTo(-2.0, 0.95);
  s.lineTo(-2.4, 0.55);
  s.closePath();
  const paint = new THREE.MeshStandardMaterial({ color: paintColor, metalness: 0.75, roughness: 0.25 });
  body.add(new THREE.Mesh(extrudeProfile(s, 1.9, true), paint));

  // canopy
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0b3a4a, emissive: new THREE.Color(glowColor), emissiveIntensity: 0.25,
    metalness: 1, roughness: 0.05, transparent: true, opacity: 0.9,
  });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glass);
  canopy.scale.set(0.72, 0.42, 1.35);
  canopy.position.set(0, 0.95, -0.15);
  body.add(canopy);

  // side neon strips
  for (const sx of [1, -1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 4.3), neon(accent));
    strip.position.set(sx * 1.08, 0.36, 0);
    body.add(strip);
  }
  // headlight bar
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.06), neon(0xffffff, 2.5));
  head.position.set(0, 0.3, 2.42);
  body.add(head);
  // tail light bar
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.06), neon(accent, 3.5));
  tail.position.set(0, 0.78, -2.47);
  body.add(tail);

  // rear wing
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 0.7), paint);
  wing.position.set(0, 1.35, -2.0);
  body.add(wing);
  const wingEdge = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.04, 0.05), neon(glowColor));
  wingEdge.position.set(0, 1.4, -2.34);
  body.add(wingEdge);
  for (const sx of [0.7, -0.7]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.3), paint);
    strut.position.set(sx, 1.12, -2.0);
    body.add(strut);
  }

  const flames: THREE.Mesh[] = [];
  const thrusterLocal: THREE.Vector3[] = [];
  addThrusters(body, glowColor, -2.45, 0.5, [0.6, -0.6], flames, thrusterLocal);
  addHoverPads(body, glowColor, 0.8, 1.5);
  const underglow = makeUnderglow(glowColor);
  root.add(underglow);

  return { root, flames, underglow, thrusterLocal };
}

/**
 * Faceted stainless electric pickup: flat vertical nose under a full-width light bar, one straight
 * line up to the roof apex, a long straight slope down to a tall tailgate, angular black wheel arches.
 * Proportions taken from a side-profile reference (length 5.2, apex 1.6).
 */
export function makeTruckModel(accent: number, glowColor: number, paintColor: number): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const W = 2.2;
  const HW = W / 2;

  const NOSE = { x: 2.62, y: 0.95 };  // top edge of the flat front face
  const APEX = { x: 0.62, y: 1.6 };   // roof peak, ~40% back from the nose
  const TAIL = { x: -2.6, y: 1.26 };  // top of the tailgate
  const BASE = 0.25;
  // wheel arches: [front edge, rear edge] at the sill, inset 0.22 at the flat top
  const ARCH_TOP = 0.9;
  const ARCHES = [{ f: 2.43, r: 1.43 }, { f: -1.0, r: -2.04 }];
  const WHEEL_R = 0.43;

  // ---- main shell: side profile with the arch notches cut into the bottom edge
  const s = new THREE.Shape();
  s.moveTo(2.6, 0.3);
  for (const a of ARCHES) {
    s.lineTo(a.f, BASE);
    s.lineTo(a.f - 0.24, ARCH_TOP);
    s.lineTo(a.r + 0.24, ARCH_TOP);
    s.lineTo(a.r, BASE);
  }
  s.lineTo(TAIL.x, 0.3);
  s.lineTo(TAIL.x, TAIL.y);
  s.lineTo(APEX.x, APEX.y);
  s.lineTo(NOSE.x, NOSE.y);
  s.closePath();
  // brushed stainless: mostly diffuse grey with a dimmed sky reflection, so it stays grey under the neon sky
  // a neutral emissive floor keeps it reading grey even under the pink sunset light
  const paint = new THREE.MeshStandardMaterial({
    color: paintColor, metalness: 0.35, roughness: 0.42, envMapIntensity: 0.45, flatShading: true,
    emissive: 0x3c3f45, emissiveIntensity: 1,
  });
  body.add(new THREE.Mesh(extrudeProfile(s, W, false), paint));

  const black = new THREE.MeshStandardMaterial({ color: 0x141418, metalness: 0.2, roughness: 0.75 });
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    m.position.set(x, y, z);
    body.add(m);
    return m;
  };
  const sides = [1, -1];

  // ---- black lower trim: front bumper, rear bumper, rocker panels between the arches
  box(W + 0.08, 0.34, 0.3, 0, 0.4, 2.55, black);
  box(W + 0.04, 0.06, 0.04, 0, 0.42, 2.71, new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 1 })); // grille slot
  box(W + 0.08, 0.3, 0.4, 0, 0.42, -2.45, black);
  for (const sx of sides) box(0.08, 0.16, ARCHES[0].r - ARCHES[1].f - 0.04, sx * (HW + 0.02), BASE + 0.07, (ARCHES[0].r + ARCHES[1].f) / 2, black);

  // ---- angular arch flares (black band around each notch, standing proud of the side)
  for (const a of ARCHES) {
    const t = 0.13;
    const band = new THREE.Shape();
    band.moveTo(a.f + t, BASE);
    band.lineTo(a.f - 0.24 + t * 0.4, ARCH_TOP + t);
    band.lineTo(a.r + 0.24 - t * 0.4, ARCH_TOP + t);
    band.lineTo(a.r - t, BASE);
    band.lineTo(a.r, BASE);
    band.lineTo(a.r + 0.24, ARCH_TOP);
    band.lineTo(a.f - 0.24, ARCH_TOP);
    band.lineTo(a.f, BASE);
    band.closePath();
    const g = new THREE.ExtrudeGeometry(band, { depth: 0.08, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    for (const sx of sides) {
      const m = new THREE.Mesh(g, black);
      m.position.x = sx > 0 ? HW + 0.08 : -HW;
      body.add(m);
    }
    // dark wheel well so you can't see through the notch to the other side
    box(W - 0.7, ARCH_TOP - BASE, a.f - a.r - 0.3, 0, (ARCH_TOP + BASE) / 2, (a.f + a.r) / 2, black);
  }

  // ---- wheels: chunky tyres, hex aero hubs, a thin neon rim; they spin with speed
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 0.8, roughness: 0.4, flatShading: true });
  const rimMat = neon(glowColor, 2);
  const wheels: THREE.Object3D[] = [];
  for (const a of ARCHES) {
    const wz = (a.f + a.r) / 2;
    for (const sx of sides) {
      const w = new THREE.Group();
      w.position.set(sx * (HW - 0.14), WHEEL_R - 0.02, wz);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.34, 20), tyre);
      t.rotation.z = Math.PI / 2;
      w.add(t);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.36, 6), hubMat);
      hub.rotation.z = Math.PI / 2;
      w.add(hub);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 6, 24), rimMat);
      rim.rotation.y = Math.PI / 2;
      rim.position.x = sx * 0.18;
      w.add(rim);
      body.add(w);
      wheels.push(w);
    }
  }

  // ---- glass
  const glass = new THREE.MeshStandardMaterial({
    color: 0x07070a, emissive: new THREE.Color(glowColor), emissiveIntensity: 0.06,
    metalness: 1, roughness: 0.04, side: THREE.DoubleSide,
  });
  const roofFront = (x: number) => NOSE.y + ((NOSE.x - x) / (NOSE.x - APEX.x)) * (APEX.y - NOSE.y);
  const roofRear = (x: number) => APEX.y - ((APEX.x - x) / (APEX.x - TAIL.x)) * (APEX.y - TAIL.y);
  const BELT = 1.19;
  const sideWindow = (pts: [number, number][]) => {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) sh.lineTo(x, y);
    sh.closePath();
    const g = new THREE.ShapeGeometry(sh);
    g.rotateY(-Math.PI / 2);
    for (const sx of sides) {
      const m = new THREE.Mesh(g, glass);
      m.position.x = sx * (HW + 0.006);
      body.add(m);
    }
  };
  // front door glass: the leading edge runs along the windshield line, B-pillar left in body colour
  const xFront = NOSE.x - ((BELT + 0.02 - NOSE.y) / (APEX.y - NOSE.y)) * (NOSE.x - APEX.x);
  sideWindow([[xFront, BELT], [APEX.x - 0.1, roofFront(APEX.x - 0.1) - 0.07], [APEX.x - 0.1, roofRear(0.2) - 0.07], [0.22, roofRear(0.22) - 0.07], [0.22, BELT]]);
  // rear door glass, rear edge raked back like the reference
  sideWindow([[0.1, BELT], [0.1, roofRear(0.1) - 0.07], [-0.72, roofRear(-0.72) - 0.08], [-0.6, BELT]]);

  // windshield + glass roof laid on the two slopes
  const slopeF = Math.atan((APEX.y - NOSE.y) / (NOSE.x - APEX.x));
  const slopeR = Math.atan((APEX.y - TAIL.y) / (APEX.x - TAIL.x));
  const panel = (x0: number, x1: number, w: number, angle: number, roof: (x: number) => number) => {
    const len = Math.abs(x0 - x1) / Math.cos(angle);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, len), glass);
    m.rotation.x = angle;
    m.position.set(0, (roof(x0) + roof(x1)) / 2 + 0.012, (x0 + x1) / 2);
    body.add(m);
  };
  panel(1.75, APEX.x + 0.04, W - 0.22, slopeF, roofFront);
  panel(APEX.x - 0.04, -0.45, W - 0.5, -slopeR, roofRear);

  // ---- panel seams on the flat sides (door cut lines) and the side mirrors
  const seam = new THREE.MeshBasicMaterial({ color: 0x1a1a1f });
  for (const z of [1.3, 0.16, -0.95]) {
    for (const sx of sides) box(0.01, BELT - BASE - 0.2, 0.018, sx * (HW + 0.004), (BELT + BASE + 0.2) / 2, z, seam);
  }
  for (const sx of sides) {
    // shoulder crease along the beltline
    box(0.01, 0.014, 3.0, sx * (HW + 0.004), BELT - 0.02, 0.35, seam);
    const mirror = box(0.2, 0.1, 0.16, sx * (HW + 0.1), BELT + 0.05, 1.62, black);
    mirror.rotation.y = sx * 0.15;
  }

  // ---- lights: full-width white bar along the nose edge, red bar across the tailgate
  box(W + 0.02, 0.035, 0.05, 0, NOSE.y - 0.02, NOSE.x + 0.01, neon(0xffffff, 3));
  box(W + 0.02, 0.05, 0.05, 0, TAIL.y - 0.07, TAIL.x - 0.02, neon(0xff2a3c, 3));
  // subtle neon line under the rockers so it still belongs in the game
  for (const sx of sides) box(0.04, 0.03, ARCHES[0].r - ARCHES[1].f - 0.1, sx * (HW + 0.06), BASE - 0.02, (ARCHES[0].r + ARCHES[1].f) / 2, neon(accent, 1.3));

  const flames: THREE.Mesh[] = [];
  const thrusterLocal: THREE.Vector3[] = [];
  addThrusterBar(body, glowColor, -2.66, 0.45, W - 0.5, flames, thrusterLocal);
  addHoverPads(body, glowColor, 0.7, 1.75);
  const underglow = makeUnderglow(glowColor, 6, 8.5);
  root.add(underglow);

  return { root, flames, underglow, thrusterLocal, wheels, flameGrowX: 0.05 };
}

export function modelFor(def: CarDef): CarModel {
  return def.body === 'truck'
    ? makeTruckModel(def.accent, def.glow, def.paint)
    : makeCarModel(def.accent, def.glow, def.paint);
}

export interface CarEvents {
  onBoost(tier: number): void;
  onImpact(strength: number): void;
}

const TIERS = [0.7, 1.6, 2.7];
const BOOST_TIME = [0.8, 1.4, 2.2];

export class Car {
  model: CarModel;
  spec: CarSpec = DEFAULT_SPEC;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector2(); // world (x, z)
  heading = 0;
  trackIdx = -1;
  drifting = false;
  driftDir = 0;
  driftCharge = 0;
  boostTime = 0;
  boost = 0; // smoothed 0..1
  throttle = 0;
  steerVis = 0;
  /** sideways slip speed (u/s), used for drift scoring */
  lateral = 0;
  private roll = 0;
  private pitch = 0;
  private prevVf = 0;
  private hoverT = Math.random() * 10;

  private readonly models = new Map<string, CarModel>();

  constructor(private readonly scene: THREE.Scene, accent = 0xff2bd6, glow = 0x22f3ff) {
    this.model = makeCarModel(accent, glow);
    this.model.root.rotation.order = 'YXZ';
    scene.add(this.model.root);
  }

  /** Swap body + handling to another car definition (models are cached per id). */
  setDef(def: CarDef) {
    let m = this.models.get(def.id);
    if (!m) {
      m = modelFor(def);
      m.root.rotation.order = 'YXZ';
      this.models.set(def.id, m);
    }
    this.spec = def.spec;
    if (m === this.model) return;
    const visible = this.model.root.visible;
    this.scene.remove(this.model.root);
    this.model = m;
    m.root.visible = visible;
    this.scene.add(m.root);
    this.syncModel(0);
  }

  get speed() { return this.vel.length(); }
  get forwardSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.y * Math.cos(this.heading); }
  get driftTier() {
    let t = 0;
    for (let i = 0; i < TIERS.length; i++) if (this.driftCharge >= TIERS[i]) t = i + 1;
    return t;
  }
  get driftFraction() { return Math.min(1, this.driftCharge / TIERS[2]); }

  /** Boost pad / external boost. Returns true if this started a new boost. */
  padBoost(seconds: number) {
    const fresh = this.boostTime < 0.2;
    this.boostTime = Math.max(this.boostTime, seconds);
    return fresh;
  }

  placeAt(track: Track, idx: number, lat = 0) {
    const k = track.wrap(idx);
    const p = track.pts[k], t = track.tan[k], s = track.side[k];
    this.pos.set(p.x + s.x * lat, 0, p.z + s.z * lat);
    this.heading = Math.atan2(t.x, t.z);
    this.vel.set(0, 0);
    this.trackIdx = k;
    this.drifting = false;
    this.driftCharge = 0;
    this.boostTime = 0;
    this.boost = 0;
    this.prevVf = 0;
    this.syncModel(0);
  }

  update(dt: number, c: Controls, track: Track, ev: CarEvents) {
    const h = this.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = -Math.cos(h), rz = Math.sin(h);
    let vf = this.vel.x * fx + this.vel.y * fz;
    let vl = this.vel.x * rx + this.vel.y * rz;

    const boosting = this.boostTime > 0;
    const sp = this.spec;
    const maxV = boosting ? sp.boostV : sp.maxV;
    const acc = boosting ? sp.boostAcc : sp.acc;

    // throttle / brake / drag
    if (c.throttle > 0 && vf < maxV) vf += c.throttle * acc * (1 - Math.max(0, vf) / maxV) * dt;
    if (boosting) vf += 30 * dt;
    if (vf > maxV) vf -= (vf - maxV) * 1.2 * dt;
    if (c.brake > 0) {
      if (vf > 1) vf -= c.brake * 85 * dt;
      else vf = Math.max(-22, vf - c.brake * 30 * dt);
    }
    if (c.throttle === 0 && c.brake === 0) vf *= Math.exp(-0.45 * dt);

    // drift state machine: hold drift + steer at speed; release to cash in charge as boost
    if (!this.drifting && c.drift && Math.abs(c.steer) > 0.25 && vf > 22) {
      this.drifting = true;
      this.driftDir = Math.sign(c.steer);
      this.driftCharge = 0;
    }
    if (this.drifting && (!c.drift || vf < 12)) {
      const tier = this.driftTier;
      if (tier > 0 && vf >= 12) {
        this.boostTime = Math.max(this.boostTime, BOOST_TIME[tier - 1]);
        ev.onBoost(tier);
      }
      this.drifting = false;
      this.driftCharge = 0;
    }
    if (this.drifting) this.driftCharge += dt * (0.55 + Math.min(1, Math.abs(vl) / 14));

    // steering
    const speedF = THREE.MathUtils.clamp(vf / 14, -1, 1);
    let turn = this.drifting ? sp.driftTurn : sp.turn;
    turn *= 1 - 0.3 * THREE.MathUtils.clamp(vf / 120, 0, 1);
    const steer = this.drifting ? this.driftDir * 0.6 + c.steer * 0.55 : c.steer;
    this.steerVis = THREE.MathUtils.lerp(this.steerVis, steer, 1 - Math.exp(-10 * dt));

    // lateral grip: low when drifting so the tail slides out
    const grip = this.drifting ? sp.driftGrip : c.brake > 0.5 && vf > 30 ? 4 : sp.grip;
    vl *= Math.exp(-grip * dt);
    this.lateral = vl;

    this.vel.set(fx * vf + rx * vl, fz * vf + rz * vl);
    this.heading += steer * turn * speedF * dt;

    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;

    // walls
    const n = track.nearest(this.pos.x, this.pos.z, this.trackIdx);
    this.trackIdx = n.idx;
    const limit = ROAD_HALF - 1.3;
    if (Math.abs(n.lat) > limit) {
      const sgn = Math.sign(n.lat);
      const s = track.side[n.idx];
      const over = Math.abs(n.lat) - limit;
      this.pos.x -= s.x * over * sgn;
      this.pos.z -= s.z * over * sgn;
      const nx = s.x * sgn, nz = s.z * sgn;
      const vn = this.vel.x * nx + this.vel.y * nz;
      if (vn > 0) {
        this.vel.x -= nx * vn * 1.35;
        this.vel.y -= nz * vn * 1.35;
        this.vel.multiplyScalar(1 - Math.min(0.2, vn * 0.008));
        if (vn > 4) ev.onImpact(vn);
      }
    }

    this.boostTime = Math.max(0, this.boostTime - dt);
    this.boost = THREE.MathUtils.lerp(this.boost, boosting ? 1 : 0, 1 - Math.exp(-6 * dt));
    this.throttle = c.throttle;

    const accel = (vf - this.prevVf) / Math.max(dt, 1e-4);
    this.prevVf = vf;
    this.roll = THREE.MathUtils.lerp(this.roll, -this.steerVis * 0.16 - vl * 0.006, 1 - Math.exp(-8 * dt));
    this.pitch = THREE.MathUtils.lerp(this.pitch, THREE.MathUtils.clamp(-accel * 0.0018, -0.06, 0.08), 1 - Math.exp(-5 * dt));
    this.syncModel(dt);
  }

  private syncModel(dt: number) {
    this.hoverT += dt;
    const m = this.model;
    const y = 0.7 + Math.sin(this.hoverT * 3.2) * 0.07;
    m.root.position.set(this.pos.x, y, this.pos.z);
    m.root.rotation.set(this.pitch, this.heading, this.roll);
    m.underglow.position.y = -y + 0.06;
    m.underglow.rotation.set(-Math.PI / 2 - this.pitch, 0, 0);
    const flicker = 0.85 + Math.random() * 0.3;
    const len = (0.35 + this.throttle * 0.9 + this.boost * 2.4) * flicker;
    for (const f of m.flames) {
      f.scale.set(1 + this.boost * (m.flameGrowX ?? 0.4), 1 + this.boost * 0.4, len);
    }
    if (m.wheels) for (const w of m.wheels) w.rotation.x += this.forwardSpeed * dt / 0.43;
  }
}
