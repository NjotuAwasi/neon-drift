import * as THREE from 'three';
import { ROAD_HALF, Track } from './track';
import type { Controls } from './input';

export interface CarModel {
  root: THREE.Group;
  flames: THREE.Mesh[];
  underglow: THREE.Mesh;
  thrusterLocal: THREE.Vector3[];
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

export function makeCarModel(accent = 0xff2bd6, glowColor = 0x22f3ff): CarModel {
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
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1.9, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 3 });
  geo.rotateY(-Math.PI / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, 0, 0);
  const paint = new THREE.MeshStandardMaterial({ color: 0x1a0f2e, metalness: 0.85, roughness: 0.22 });
  body.add(new THREE.Mesh(geo, paint));

  // canopy
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0b3a4a, emissive: new THREE.Color(glowColor), emissiveIntensity: 0.25,
    metalness: 1, roughness: 0.05, transparent: true, opacity: 0.9,
  });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glass);
  canopy.scale.set(0.72, 0.42, 1.35);
  canopy.position.set(0, 0.95, -0.15);
  body.add(canopy);

  const neon = (c: number, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

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

  // thrusters + flames
  const flames: THREE.Mesh[] = [];
  const thrusterLocal: THREE.Vector3[] = [];
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 1, roughness: 0.3 });
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(glowColor).multiplyScalar(2.5), transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  for (const sx of [0.6, -0.6]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.5, 16, 1, true), nozzleMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(sx, 0.5, -2.45);
    body.add(nozzle);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.24, 16), neon(0xffffff, 2));
    core.position.set(sx, 0.5, -2.46);
    core.rotation.y = Math.PI;
    body.add(core);
    const fg = new THREE.ConeGeometry(0.24, 1, 16, 1, true);
    fg.translate(0, 0.5, 0); // base at nozzle, tip trailing behind after rotation
    fg.rotateX(-Math.PI / 2);
    const flame = new THREE.Mesh(fg, flameMat);
    flame.position.set(sx, 0.5, -2.6);
    body.add(flame);
    flames.push(flame);
    thrusterLocal.push(new THREE.Vector3(sx, 0.5, -2.7));
  }

  // hover pads
  for (const [px, pz] of [[0.8, 1.5], [-0.8, 1.5], [0.8, -1.5], [-0.8, -1.5]]) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), neon(glowColor, 2));
    pad.rotation.x = Math.PI / 2;
    pad.position.set(px, 0.06, pz);
    body.add(pad);
  }

  // underglow pool on the road
  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(5.5, 8),
    new THREE.MeshBasicMaterial({
      map: GLOW_TEX, color: new THREE.Color(glowColor).multiplyScalar(1.2), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
  );
  underglow.rotation.x = -Math.PI / 2;
  root.add(underglow);

  return { root, flames, underglow, thrusterLocal };
}

export interface CarEvents {
  onBoost(tier: number): void;
  onImpact(strength: number): void;
}

const TIERS = [0.7, 1.6, 2.7];
const BOOST_TIME = [0.8, 1.4, 2.2];

export class Car {
  readonly model: CarModel;
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
  private roll = 0;
  private pitch = 0;
  private prevVf = 0;
  private hoverT = Math.random() * 10;

  constructor(scene: THREE.Scene) {
    this.model = makeCarModel();
    this.model.root.rotation.order = 'YXZ';
    scene.add(this.model.root);
  }

  get speed() { return this.vel.length(); }
  get forwardSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.y * Math.cos(this.heading); }
  get driftTier() {
    let t = 0;
    for (let i = 0; i < TIERS.length; i++) if (this.driftCharge >= TIERS[i]) t = i + 1;
    return t;
  }
  get driftFraction() { return Math.min(1, this.driftCharge / TIERS[2]); }

  placeAt(track: Track, idx: number) {
    const p = track.pts[track.wrap(idx)], t = track.tan[track.wrap(idx)];
    this.pos.set(p.x, 0, p.z);
    this.heading = Math.atan2(t.x, t.z);
    this.vel.set(0, 0);
    this.trackIdx = track.wrap(idx);
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
    const maxV = boosting ? 140 : 96;
    const acc = boosting ? 120 : 64;

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
    let turn = this.drifting ? 2.35 : 1.85;
    turn *= 1 - 0.3 * THREE.MathUtils.clamp(vf / 120, 0, 1);
    const steer = this.drifting ? this.driftDir * 0.6 + c.steer * 0.55 : c.steer;
    this.steerVis = THREE.MathUtils.lerp(this.steerVis, steer, 1 - Math.exp(-10 * dt));

    // lateral grip: low when drifting so the tail slides out
    const grip = this.drifting ? 1.5 : c.brake > 0.5 && vf > 30 ? 4 : 9;
    vl *= Math.exp(-grip * dt);

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
      f.scale.set(1 + this.boost * 0.4, 1 + this.boost * 0.4, len);
    }
  }
}
