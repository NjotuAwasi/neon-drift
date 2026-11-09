import * as THREE from 'three';
import { ROAD_HALF, Track } from './track';

export const FOG_COLOR = new THREE.Color(0.32, 0.06, 0.26);
export const SUN_DIR = new THREE.Vector3(0.35, 0.11, -1).normalize();

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFrag = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 fogCol;
  uniform float time;
  uniform float sunStrength;
  varying vec3 vDir;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 top = vec3(0.015, 0.008, 0.05);
    vec3 mid = vec3(0.20, 0.02, 0.28);
    vec3 hor = vec3(1.0, 0.22, 0.48);
    vec3 col = mix(mid, top, smoothstep(0.05, 0.55, h));
    col = mix(hor, col, smoothstep(-0.01, 0.22, h));
    if (h < 0.0) col = fogCol;

    // stars
    vec3 g = floor(d * 220.0);
    float s = hash(g);
    float tw = 0.6 + 0.4 * sin(time * 2.0 + s * 60.0);
    if (s > 0.9965) col += vec3(0.85, 0.8, 1.0) * tw * smoothstep(0.12, 0.45, h);

    // synthwave sun
    float a = acos(clamp(dot(d, sunDir), -1.0, 1.0));
    float r = 0.17;
    col += hor * exp(-a * 5.0) * 0.55;
    if (a < r) {
      float t = clamp((d.y - (sunDir.y - r)) / (2.0 * r), 0.0, 1.0);
      vec3 sc = mix(vec3(1.0, 0.08, 0.55), vec3(1.0, 0.86, 0.25), t);
      float band = fract(t * 11.0 - time * 0.15);
      float gap = (0.55 - t) * 1.1;
      float on = t > 0.55 ? 1.0 : step(gap, band);
      float edge = smoothstep(r, r - 0.006, a);
      col = mix(col, sc * sunStrength, on * edge);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const groundVert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const groundFrag = /* glsl */ `
  uniform vec3 fogCol;
  uniform float time;
  varying vec3 vW;
  void main() {
    vec2 g = vW.xz / 24.0;
    vec2 gr = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    float line = 1.0 - min(min(gr.x, gr.y), 1.0);
    float dist = length(vW.xz - cameraPosition.xz);
    float pulse = 0.75 + 0.25 * sin(dist * 0.02 - time * 2.0);
    vec3 base = vec3(0.012, 0.0, 0.03);
    vec3 lc = vec3(1.0, 0.12, 0.75) * 1.8 * pulse;
    vec3 col = base + lc * line * exp(-dist * 0.0022);
    col = mix(fogCol, col, exp(-dist * 0.0011));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface World {
  update(dt: number, time: number, camera: THREE.Camera): void;
}

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer, track: Track): World {
  scene.background = FOG_COLOR.clone();
  scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), 0.0014);

  // ---- sky ----
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: { sunDir: { value: SUN_DIR }, fogCol: { value: FOG_COLOR }, time: { value: 0 }, sunStrength: { value: 2.4 } },
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // environment map from the sky so metal & wet road reflect the neon horizon
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  // dimmed sun in reflections, otherwise metal surfaces facing it blow out under bloom
  const envMat = skyMat.clone();
  envMat.uniforms.sunStrength.value = 0.5;
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat));
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.7;
  envMat.dispose();

  // ---- lights ----
  scene.add(new THREE.HemisphereLight(0x7a44ff, 0x14001f, 0.7));
  const sun = new THREE.DirectionalLight(0xff6fb0, 0.35);
  sun.position.copy(SUN_DIR).multiplyScalar(500);
  scene.add(sun);

  // ---- ground ----
  const groundMat = new THREE.ShaderMaterial({
    vertexShader: groundVert,
    fragmentShader: groundFrag,
    uniforms: { fogCol: { value: FOG_COLOR }, time: { value: 0 } },
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  buildCity(scene, track);
  buildMountains(scene);

  return {
    update(_dt, time, camera) {
      sky.position.copy(camera.position);
      skyMat.uniforms.time.value = time;
      groundMat.uniforms.time.value = time;
    },
  };
}

// ---------------------------------------------------------------- city

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function windowCanvas(rows: number, cols: number, rand: () => number) {
  const cw = 8, ch = 10;
  const c = document.createElement('canvas');
  c.width = cols * cw; c.height = rows * ch;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05030a';
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const r = rand();
      if (r < 0.55) continue;
      const v = r > 0.93 ? 255 : 120 + rand() * 110;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 5);
    }
  return c;
}

function buildCity(scene: THREE.Scene, track: Track) {
  const rand = rng(1337);
  const b = track.bounds;
  const pad = 650;
  const palette = [0xff4fd8, 0x4ff3ff, 0xb56bff, 0xffb347, 0xff6f91, 0x7d8bff].map((c) => new THREE.Color(c));
  const classes = [
    { count: 520, h: [14, 40], w: [10, 24], rows: 6 },
    { count: 260, h: [45, 95], w: [14, 28], rows: 14 },
    { count: 90, h: [110, 210], w: [18, 34], rows: 28 },
  ];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const tops: { x: number; z: number; y: number; w: number; d: number; c: THREE.Color }[] = [];

  for (const cl of classes) {
    const tex = new THREE.CanvasTexture(windowCanvas(cl.rows, 6, rand));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const mesh = new THREE.InstancedMesh(geo, mat, cl.count);
    let n = 0, guard = 0;
    while (n < cl.count && guard++ < cl.count * 40) {
      const x = b.minX - pad + rand() * (b.maxX - b.minX + pad * 2);
      const z = b.minZ - pad + rand() * (b.maxZ - b.minZ + pad * 2);
      const w = cl.w[0] + rand() * (cl.w[1] - cl.w[0]);
      const d = cl.w[0] + rand() * (cl.w[1] - cl.w[0]);
      const clearance = ROAD_HALF + 10 + Math.max(w, d) * 0.75;
      const dist = track.distance(x, z);
      if (dist < clearance) continue;
      // tall towers stay back from the road so they frame rather than block the view
      if (cl.h[0] > 100 && dist < 140) continue;
      const h = cl.h[0] + rand() * (cl.h[1] - cl.h[0]);
      pos.set(x, 0, z);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() < 0.5 ? 0 : Math.PI / 2);
      sc.set(w, h, d);
      m.compose(pos, q, sc);
      mesh.setMatrixAt(n, m);
      const c = palette[Math.floor(rand() * palette.length)];
      mesh.setColorAt(n, c);
      if (rand() < 0.45) tops.push({ x, z, y: h, w, d, c });
      n++;
    }
    mesh.count = n;
    scene.add(mesh);
  }

  // neon rooftop rims
  const rimGeo = new THREE.BoxGeometry(1, 1, 1);
  const rimMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const rims = new THREE.InstancedMesh(rimGeo, rimMat, tops.length);
  tops.forEach((t, i) => {
    pos.set(t.x, t.y + 0.4, t.z);
    q.identity();
    sc.set(t.w + 0.6, 0.8, t.d + 0.6);
    m.compose(pos, q, sc);
    rims.setMatrixAt(i, m);
    rims.setColorAt(i, t.c.clone().multiplyScalar(2.2));
  });
  scene.add(rims);
}

function buildMountains(scene: THREE.Scene) {
  const rand = rng(99);
  const seg = 160, R = 2300;
  const pos: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const h = 60 + rand() * 220 * (0.5 + 0.5 * Math.sin(a * 3.0) ** 2);
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    pos.push(x, 0, z, x * 0.97, h, z * 0.97);
  }
  const idx: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const solid = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x0c0218, side: THREE.DoubleSide, fog: false }));
  const wire = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb02bff).multiplyScalar(1.4), wireframe: true, fog: false, toneMapped: false, transparent: true, opacity: 0.5 }),
  );
  scene.add(solid, wire);
}
