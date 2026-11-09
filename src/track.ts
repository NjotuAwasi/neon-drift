import * as THREE from 'three';

export const ROAD_HALF = 10;
const SCALE = 1.8;

// Hand-designed closed circuit (x, z). Start/finish is the first point, heading +x.
const LAYOUT: [number, number][] = [
  [0, 0], [150, 0], [230, -60], [240, -160], [170, -230], [80, -190],
  [10, -240], [-90, -280], [-190, -230], [-220, -120], [-150, -70],
  [-180, 20], [-120, 90], [-85, 35], [-50, 0],
];

export interface Nearest {
  idx: number;
  /** signed lateral offset from the centre line (positive = towards `side`) */
  lat: number;
}

export class Track {
  readonly N = 2000;
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly pts: THREE.Vector3[] = [];
  readonly tan: THREE.Vector3[] = [];
  readonly side: THREE.Vector3[] = [];
  readonly bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  private readonly result: Nearest = { idx: 0, lat: 0 };

  constructor(scene: THREE.Scene, maxAniso: number) {
    const ctrl = LAYOUT.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE));
    this.curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
    this.length = this.curve.getLength();

    for (let i = 0; i < this.N; i++) {
      const u = i / this.N;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).setY(0).normalize();
      this.pts.push(p);
      this.tan.push(t);
      this.side.push(new THREE.Vector3(-t.z, 0, t.x));
      const b = this.bounds;
      b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
      b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z);
    }

    scene.add(this.buildRoad(maxAniso));
    scene.add(this.buildFlatRibbon(ROAD_HALF - 0.2, 0.35, 0.03, new THREE.Color(0xff2bd6).multiplyScalar(3)));
    scene.add(this.buildFlatRibbon(-ROAD_HALF + 0.2, 0.35, 0.03, new THREE.Color(0x22f3ff).multiplyScalar(3)));
    scene.add(this.buildWall(ROAD_HALF, 1.6, new THREE.Color(0xff2bd6)));
    scene.add(this.buildWall(-ROAD_HALF, 1.6, new THREE.Color(0x22f3ff)));
    scene.add(this.buildPylons());
    scene.add(this.buildStartGate(maxAniso));
  }

  wrap(i: number) {
    return ((i % this.N) + this.N) % this.N;
  }

  /** Nearest centre-line sample. Pass the previous index as a hint for a cheap local search, or -1 for a full scan. */
  nearest(x: number, z: number, hint: number): Nearest {
    let best = 0;
    let bd = Infinity;
    const from = hint < 0 ? 0 : hint - 60;
    const to = hint < 0 ? this.N - 1 : hint + 60;
    for (let i = from; i <= to; i++) {
      const k = this.wrap(i);
      const p = this.pts[k];
      const dx = x - p.x, dz = z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = k; }
    }
    const p = this.pts[best], s = this.side[best];
    this.result.idx = best;
    this.result.lat = (x - p.x) * s.x + (z - p.z) * s.z;
    return this.result;
  }

  /** Brute-force distance to the centre line (used for scenery placement). */
  distance(x: number, z: number) {
    let bd = Infinity;
    for (let i = 0; i < this.N; i += 4) {
      const p = this.pts[i];
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < bd) bd = d;
    }
    return Math.sqrt(bd);
  }

  private buildRoad(maxAniso: number) {
    const N = this.N;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const step = this.length / N;
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const p = this.pts[k], s = this.side[k];
      pos.push(p.x + s.x * ROAD_HALF, 0, p.z + s.z * ROAD_HALF);
      pos.push(p.x - s.x * ROAD_HALF, 0, p.z - s.z * ROAD_HALF);
      const v = (i * step) / 24;
      uv.push(0, v, 1, v);
    }
    for (let i = 0; i < N; i++) {
      const a = 2 * i, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();

    const tex = new THREE.CanvasTexture(roadCanvas());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = maxAniso;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.5 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildFlatRibbon(offset: number, width: number, y: number, color: THREE.Color) {
    const N = this.N;
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const p = this.pts[k], s = this.side[k];
      const a = offset + width / 2, b = offset - width / 2;
      pos.push(p.x + s.x * a, y, p.z + s.z * a, p.x + s.x * b, y, p.z + s.z * b);
    }
    for (let i = 0; i < N; i++) {
      const a = 2 * i;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide });
    return new THREE.Mesh(g, m);
  }

  /** Glowing translucent barrier: bright at the bottom, fading upward (additive). */
  private buildWall(offset: number, height: number, color: THREE.Color) {
    const N = this.N;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const bright = color.clone().multiplyScalar(0.9);
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const p = this.pts[k], s = this.side[k];
      const x = p.x + s.x * offset, z = p.z + s.z * offset;
      pos.push(x, 0, z, x, height, z);
      col.push(bright.r, bright.g, bright.b, 0, 0, 0);
    }
    for (let i = 0; i < N; i++) {
      const a = 2 * i;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    return new THREE.Mesh(g, m);
  }

  private buildPylons() {
    const spacing = Math.round(28 / (this.length / this.N));
    const count = Math.floor(this.N / spacing) * 2;
    const geo = new THREE.BoxGeometry(0.45, 2.6, 0.45);
    geo.translate(0, 1.3, 0);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const pink = new THREE.Color(0xff2bd6).multiplyScalar(2.5);
    const cyan = new THREE.Color(0x22f3ff).multiplyScalar(2.5);
    let n = 0;
    for (let i = 0; i < this.N && n < count; i += spacing) {
      const p = this.pts[i], s = this.side[i];
      for (const sign of [1, -1]) {
        const o = (ROAD_HALF + 0.9) * sign;
        m.makeTranslation(p.x + s.x * o, 0, p.z + s.z * o);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, sign > 0 ? pink : cyan);
        n++;
      }
    }
    mesh.count = n;
    return mesh;
  }

  private buildStartGate(maxAniso: number) {
    const g = new THREE.Group();
    const p = this.pts[0], t = this.tan[0];
    g.position.copy(p);
    g.rotation.y = Math.atan2(t.x, t.z);

    const checkerTex = new THREE.CanvasTexture(checkerCanvas());
    checkerTex.anisotropy = maxAniso;
    checkerTex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2, 3),
      new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.4, metalness: 0.3 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.02;
    g.add(line);

    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.2), toneMapped: false });
    const pink = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(3), toneMapped: false });
    const frame = new THREE.MeshStandardMaterial({ color: 0x120a22, metalness: 0.9, roughness: 0.3 });
    for (const sx of [1, -1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 11, 1.2), frame);
      pillar.position.set(sx * (ROAD_HALF + 1.6), 5.5, 0);
      g.add(pillar);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 11, 1.25), pink);
      strip.position.set(sx * (ROAD_HALF + 1.6) - sx * 0.6, 5.5, 0);
      g.add(strip);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 4.4, 1.6, 1.2), frame);
    bar.position.set(0, 11, 0);
    g.add(bar);
    const barGlow = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 3, 0.3, 1.25), glow);
    barGlow.position.set(0, 10.2, 0);
    g.add(barGlow);
    return g;
  }
}

function roadCanvas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0812';
  g.fillRect(0, 0, 256, 512);
  // asphalt speckle
  for (let i = 0; i < 5000; i++) {
    const v = 10 + Math.random() * 22;
    g.fillStyle = `rgb(${v},${v * 0.9},${v * 1.3})`;
    g.fillRect(Math.random() * 256, Math.random() * 512, 1.5, 1.5);
  }
  // subtle lane seams
  g.fillStyle = 'rgba(160,120,255,0.10)';
  g.fillRect(84, 0, 2, 512);
  g.fillRect(170, 0, 2, 512);
  // centre dash
  g.fillStyle = 'rgba(240,230,255,0.55)';
  g.fillRect(124, 0, 8, 256);
  return c;
}

function checkerCanvas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d')!;
  const s = 16;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 32; x++) {
      g.fillStyle = (x + y) % 2 ? '#f4ecff' : '#0a0812';
      g.fillRect(x * s, y * s, s, s);
    }
  return c;
}
