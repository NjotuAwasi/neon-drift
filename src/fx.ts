import * as THREE from 'three';
import { GLOW_TEX } from './car';

/** Flat ribbon light-trail that follows a moving point. */
export class Trail {
  private readonly pts: THREE.Vector3[] = [];
  private readonly rights: THREE.Vector3[] = [];
  private readonly geo = new THREE.BufferGeometry();
  private readonly posArr: Float32Array;
  private readonly colArr: Float32Array;
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, private readonly color: THREE.Color, private readonly max = 60, private readonly width = 0.24) {
    this.posArr = new Float32Array(max * 2 * 3);
    this.colArr = new Float32Array(max * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colArr, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  reset() {
    this.pts.length = 0;
    this.rights.length = 0;
  }

  push(p: THREE.Vector3, right: THREE.Vector3, intensity: number) {
    this.pts.unshift(p.clone());
    this.rights.unshift(right.clone());
    if (this.pts.length > this.max) { this.pts.pop(); this.rights.pop(); }
    const n = this.pts.length;
    for (let i = 0; i < this.max; i++) {
      const k = Math.min(i, n - 1);
      const q = this.pts[k] ?? p, r = this.rights[k] ?? right;
      const w = this.width * (1 - i / this.max);
      const o = i * 6;
      this.posArr[o] = q.x + r.x * w; this.posArr[o + 1] = q.y; this.posArr[o + 2] = q.z + r.z * w;
      this.posArr[o + 3] = q.x - r.x * w; this.posArr[o + 4] = q.y; this.posArr[o + 5] = q.z - r.z * w;
      const f = i < n ? (1 - i / this.max) ** 1.6 * intensity : 0;
      for (const off of [0, 3]) {
        this.colArr[o + off] = this.color.r * f;
        this.colArr[o + off + 1] = this.color.g * f;
        this.colArr[o + off + 2] = this.color.b * f;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

/** Pooled additive point particles (sparks, boost exhaust). */
export class Particles {
  private readonly max = 900;
  private readonly pos = new Float32Array(this.max * 3);
  private readonly col = new Float32Array(this.max * 3);
  private readonly base = new Float32Array(this.max * 3);
  private readonly vel = new Float32Array(this.max * 3);
  private readonly life = new Float32Array(this.max);
  private readonly maxLife = new Float32Array(this.max);
  private head = 0;
  private readonly geo = new THREE.BufferGeometry();

  constructor(scene: THREE.Scene) {
    this.pos.fill(-9999);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const pts = new THREE.Points(this.geo, new THREE.PointsMaterial({
      size: 0.7, map: GLOW_TEX, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    pts.frustumCulled = false;
    scene.add(pts);
  }

  spawn(p: THREE.Vector3, vx: number, vy: number, vz: number, c: THREE.Color, life: number) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const o = i * 3;
    this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.base[o] = c.r; this.base[o + 1] = c.g; this.base[o + 2] = c.b;
    this.life[i] = this.maxLife[i] = life;
  }

  update(dt: number) {
    const drag = Math.exp(-2.5 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) {
        this.pos[o + 1] = -9999;
        this.col[o] = this.col[o + 1] = this.col[o + 2] = 0;
        continue;
      }
      this.vel[o] *= drag; this.vel[o + 1] = this.vel[o + 1] * drag - 6 * dt; this.vel[o + 2] *= drag;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] = Math.max(0.05, this.pos[o + 1] + this.vel[o + 1] * dt);
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[o] = this.base[o] * f; this.col[o + 1] = this.base[o + 1] * f; this.col[o + 2] = this.base[o + 2] * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
