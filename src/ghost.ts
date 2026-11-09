import * as THREE from 'three';
import { makeCarModel } from './car';
import type { Track } from './track';

const STEP = 1 / 20; // record at 20 Hz, interpolate on playback

/** flat [x, z, heading, roll]* sampled every STEP seconds of lap time */
export interface GhostData {
  time: number;
  frames: number[];
}

export function loadBest(key: string): GhostData | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as GhostData;
    return typeof d?.time === 'number' && Array.isArray(d.frames) && d.frames.length >= 8 ? d : null;
  } catch {
    return null;
  }
}

export function saveBest(key: string, d: GhostData) {
  try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* storage unavailable */ }
}

export class GhostCar {
  data: GhostData | null = null;
  private rec: number[] = [];
  private recT = 0;
  private timeAtIdx: Float32Array | null = null;
  private readonly root: THREE.Group;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    const m = makeCarModel(0x22f3ff, 0x22f3ff);
    this.mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.setColor(0x22f3ff);
    m.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== m.underglow) o.material = this.mat;
    });
    m.underglow.visible = false;
    for (const f of m.flames) f.scale.set(1, 1, 0.8);
    m.root.rotation.order = 'YXZ';
    m.root.visible = false;
    this.root = m.root;
    scene.add(this.root);
  }

  setColor(hex: number) {
    this.mat.color.set(hex).multiplyScalar(0.6);
  }

  setData(d: GhostData | null, track: Track) {
    this.data = d;
    this.index(track);
  }

  startLap() {
    this.rec = [];
    this.recT = 0;
  }

  record(t: number, x: number, z: number, heading: number, roll: number) {
    while (this.recT <= t) {
      this.rec.push(+x.toFixed(2), +z.toFixed(2), +heading.toFixed(3), +roll.toFixed(3));
      this.recT += STEP;
    }
  }

  /** The lap just driven, as ghost data. */
  takeRecording(time: number): GhostData {
    return { time, frames: this.rec };
  }

  /** Track-index → ghost-time lookup, for the live delta. */
  private index(track: Track) {
    const f = this.data?.frames;
    if (!f) { this.timeAtIdx = null; return; }
    const arr = new Float32Array(track.N).fill(-1);
    let hint = -1;
    for (let k = 0; k < f.length / 4; k++) {
      const n = track.nearest(f[k * 4], f[k * 4 + 1], hint);
      hint = n.idx;
      if (arr[n.idx] < 0) arr[n.idx] = k * STEP;
    }
    let last = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < 0) arr[i] = last;
      else last = arr[i];
    }
    this.timeAtIdx = arr;
  }

  timeAt(idx: number) {
    return this.timeAtIdx ? this.timeAtIdx[idx] : null;
  }

  hide() {
    this.root.visible = false;
  }

  /** Position the ghost at lap-time t; returns its (x,z) or null when hidden. */
  play(t: number, visible: boolean) {
    const f = this.data?.frames;
    if (!visible || !f || f.length < 8) { this.root.visible = false; return null; }
    const n = f.length / 4;
    const ft = t / STEP;
    const i = Math.min(n - 2, Math.floor(ft));
    if (i < 0) { this.root.visible = false; return null; }
    const a = Math.min(1, ft - i);
    const o = i * 4, p = o + 4;
    const x = f[o] + (f[p] - f[o]) * a;
    const z = f[o + 1] + (f[p + 1] - f[o + 1]) * a;
    let dh = f[p + 2] - f[o + 2];
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const h = f[o + 2] + dh * a;
    const roll = f[o + 3] + (f[p + 3] - f[o + 3]) * a;
    this.root.visible = true;
    this.root.position.set(x, 0.75, z);
    this.root.rotation.set(0, h, roll);
    return { x, z };
  }
}
