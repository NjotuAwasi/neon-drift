import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { modelFor, type CarModel } from './car';
import { CARS, carById } from './cars';
import type { Controls } from './input';

export interface GarageCallbacks {
  pick(id: string): void;
  go(): void;
  back(): void;
}

/** Camera presets as (azimuth around the car, polar angle from straight up, distance). Car nose points +z. */
const VIEWS = [
  { id: 'hero', label: '3/4', theta: Math.PI * 0.27, phi: 1.22, r: 9.5 },
  { id: 'front', label: 'FRONT', theta: 0, phi: 1.38, r: 8.5 },
  { id: 'side', label: 'SIDE', theta: Math.PI / 2, phi: 1.45, r: 9.5 },
  { id: 'rear', label: 'REAR', theta: Math.PI, phi: 1.3, r: 8.5 },
  { id: 'rear34', label: 'REAR 3/4', theta: -Math.PI * 0.75, phi: 1.2, r: 9.5 },
  { id: 'top', label: 'TOP', theta: Math.PI / 2, phi: 0.02, r: 11 },
  { id: 'low', label: 'LOW', theta: Math.PI * 0.18, phi: 1.6, r: 6.5 },
] as const;

const TARGET = new THREE.Vector3(0, 1.0, 0);
const HOVER_Y = 0.75;
const IDLE_SPIN_DELAY = 4; // seconds of no input before the camera starts circling again

const $ = (id: string) => document.getElementById(id)!;

export class Garage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 400);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly root = $('garage');
  private readonly stand = new THREE.Group(); // holds the car on the turntable
  private readonly models = new Map<string, CarModel>();
  private readonly ring: THREE.Mesh;
  private current: CarModel | null = null;
  private carId = CARS[0].id;
  private view = 0;
  private idle = 0;
  private t = 0;
  private drop = 0; // car-swap drop-in animation, 1 -> 0
  private tween: { from: THREE.Spherical; to: THREE.Spherical; k: number } | null = null;
  private visible = false;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly cb: GarageCallbacks) {
    this.buildShowroom();

    this.camera.position.setFromSpherical(this.spherical(VIEWS[0])).add(TARGET);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    const c = this.controls;
    c.target.copy(TARGET);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 3.2;
    c.maxDistance = 18;
    c.minPolarAngle = 0.01;      // straight down from above
    c.maxPolarAngle = 1.66;      // a touch below the car's mid-line for low shots
    c.screenSpacePanning = true;
    c.autoRotateSpeed = 0.9;
    c.enabled = false;
    c.addEventListener('start', () => { this.idle = 0; this.tween = null; c.autoRotate = false; });
    c.update();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 0.8));
    this.composer.addPass(new OutputPass());

    this.ring = this.scene.getObjectByName('ring') as THREE.Mesh;

    // ---- UI
    $('gPrev').addEventListener('click', () => this.cycle(-1));
    $('gNext').addEventListener('click', () => this.cycle(1));
    $('gBack').addEventListener('click', () => this.cb.back());
    // keyboard "clicks" (detail 0) are ignored: Enter is handled by the game input instead
    $('gGo').addEventListener('click', (e) => { if (e.detail !== 0) this.cb.go(); });
    const views = $('gViews');
    VIEWS.forEach((v, i) => {
      const b = document.createElement('button');
      b.className = 'vbtn';
      b.textContent = v.label;
      b.addEventListener('click', () => this.setView(i));
      views.appendChild(b);
    });

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.composer.setSize(innerWidth, innerHeight);
    });
  }

  private buildShowroom() {
    const s = this.scene;
    s.background = new THREE.Color(0x06030c);
    s.fog = new THREE.Fog(0x06030c, 18, 48);
    // neutral studio reflections so paint reads as its true colour
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.4;
    pmrem.dispose();

    s.add(new THREE.HemisphereLight(0xdfe6ff, 0x120818, 0.3));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(6, 10, 7);
    s.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.3);
    fill.position.set(-8, 5, -4);
    s.add(fill);
    for (const [x, z, col] of [[-6, 4, 0xff2bd6], [6, -5, 0x22f3ff]] as const) {
      const l = new THREE.PointLight(col, 22, 16, 2);
      l.position.set(x, 2.5, z);
      s.add(l);
    }

    // floor: dark glossy concrete with a faint polar grid
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: 0x0b0814, metalness: 0.5, roughness: 0.45 }),
    );
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const grid = new THREE.PolarGridHelper(26, 16, 10, 64, 0x3a1a5a, 0x241038);
    grid.position.y = 0.005;
    s.add(grid);

    // turntable with neon rings
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.4, 0.16, 72),
      new THREE.MeshStandardMaterial({ color: 0x17141f, metalness: 0.85, roughness: 0.3 }),
    );
    table.position.y = 0.08;
    s.add(table);
    const neon = (c: number, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.035, 8, 128), neon(0x22f3ff, 2.4));
    ring.name = 'ring';
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.17;
    s.add(ring);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.02, 8, 128), neon(0xff2bd6, 2));
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 0.17;
    s.add(inner);

    // tall light columns around the room, alternating pink / cyan
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.18, 7, 0.18), neon(i % 2 ? 0x22f3ff : 0xff2bd6, 1.6));
      col.position.set(Math.sin(a) * 17, 3.5, Math.cos(a) * 17);
      s.add(col);
    }

    this.stand.position.y = HOVER_Y;
    s.add(this.stand);
  }

  private spherical(v: { theta: number; phi: number; r: number }) {
    return new THREE.Spherical(v.r, v.phi, v.theta);
  }

  private model(id: string) {
    let m = this.models.get(id);
    if (!m) {
      m = modelFor(carById(id));
      m.underglow.position.y = -HOVER_Y + 0.2;
      for (const f of m.flames) f.scale.set(1, 1, 0.45);
      this.models.set(id, m);
    }
    return m;
  }

  private setCar(id: string, animate: boolean) {
    this.carId = id;
    const m = this.model(id);
    if (this.current !== m) {
      if (this.current) this.stand.remove(this.current.root);
      this.stand.add(m.root);
      this.current = m;
      if (animate) this.drop = 1;
    }
    const def = carById(id);
    const idx = CARS.indexOf(def);
    $('gName').textContent = def.name;
    $('gCount').textContent = `${idx + 1} / ${CARS.length}`;
    $('gBlurb').textContent = def.blurb;
    const bar = (label: string, n: number) =>
      `<span class="stat"><b>${label}</b><i>${'<u class="on"></u>'.repeat(n)}${'<u></u>'.repeat(5 - n)}</i></span>`;
    const st = def.stats;
    $('gStats').innerHTML = bar('SPEED', st.speed) + bar('ACCEL', st.accel) + bar('GRIP', st.grip) + bar('MASS', st.mass);
    (this.ring.material as THREE.MeshBasicMaterial).color.set(def.glow).multiplyScalar(2.4);
  }

  private cycle(dir: number) {
    const i = CARS.findIndex((c) => c.id === this.carId);
    const next = CARS[(i + dir + CARS.length) % CARS.length].id;
    this.setCar(next, true);
    this.cb.pick(next);
    this.idle = 0;
  }

  /** Glide the camera to a preset; the user can grab it again at any point. */
  setView(i: number) {
    this.view = (i + VIEWS.length) % VIEWS.length;
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const to = this.spherical(VIEWS[this.view]);
    // take the short way round
    while (to.theta - from.theta > Math.PI) to.theta -= Math.PI * 2;
    while (to.theta - from.theta < -Math.PI) to.theta += Math.PI * 2;
    this.tween = { from, to, k: 0 };
    this.controls.autoRotate = false;
    this.idle = 0;
    document.querySelectorAll('#gViews .vbtn').forEach((b, j) => b.classList.toggle('on', j === this.view));
  }

  show(carId: string, goLabel: string) {
    this.visible = true;
    this.root.classList.remove('hidden');
    $('gGo').textContent = goLabel;
    this.setCar(carId, false);
    this.controls.target.copy(TARGET);
    this.camera.position.setFromSpherical(this.spherical(VIEWS[0])).add(TARGET);
    this.setView(0);
    this.tween = null;
    document.querySelectorAll('#gViews .vbtn').forEach((b, j) => b.classList.toggle('on', j === 0));
    this.controls.enabled = true;
    this.controls.update();
  }

  hide() {
    this.visible = false;
    this.root.classList.add('hidden');
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  get shown() { return this.visible; }

  update(dt: number, c: Controls) {
    this.t += dt;
    if (c.navX) this.cycle(c.navX);
    if (c.navY) this.setView(this.view + c.navY);

    // gamepad right stick orbits / zooms
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const rx = pad.axes[2] ?? 0, ry = pad.axes[3] ?? 0;
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      if (dz(rx) || dz(ry)) {
        const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
        sph.theta -= dz(rx) * 2.2 * dt;
        sph.phi = THREE.MathUtils.clamp(sph.phi + dz(ry) * 1.5 * dt, this.controls.minPolarAngle, this.controls.maxPolarAngle);
        this.camera.position.setFromSpherical(sph).add(this.controls.target);
        this.tween = null;
        this.controls.autoRotate = false;
        this.idle = 0;
      }
    }

    if (this.tween) {
      const tw = this.tween;
      tw.k = Math.min(1, tw.k + dt / 0.9);
      const e = tw.k < 0.5 ? 4 * tw.k ** 3 : 1 - (-2 * tw.k + 2) ** 3 / 2;
      const sph = new THREE.Spherical(
        THREE.MathUtils.lerp(tw.from.radius, tw.to.radius, e),
        THREE.MathUtils.lerp(tw.from.phi, tw.to.phi, e),
        THREE.MathUtils.lerp(tw.from.theta, tw.to.theta, e),
      );
      this.controls.target.lerp(TARGET, e);
      this.camera.position.setFromSpherical(sph).add(this.controls.target);
      if (tw.k >= 1) this.tween = null;
    } else {
      this.idle += dt;
      // resume a slow showroom spin after a while, except in the top-down view
      if (this.idle > IDLE_SPIN_DELAY && VIEWS[this.view].id !== 'top') this.controls.autoRotate = true;
    }
    this.controls.update(dt);
    // keep the pan target near the car and the camera above the floor
    this.controls.target.clampLength(0, 3.5);
    if (this.camera.position.y < 0.25) this.camera.position.y = 0.25;

    // car hover + drop-in on swap
    this.drop = Math.max(0, this.drop - dt * 2.5);
    const d = this.drop * this.drop;
    this.stand.position.y = HOVER_Y + Math.sin(this.t * 2.4) * 0.05 + d * 2.2;
    this.stand.rotation.y = d * 0.6;
    if (this.current) {
      const flicker = 0.4 + Math.random() * 0.12;
      for (const f of this.current.flames) f.scale.z = flicker;
      this.current.underglow.position.y = -this.stand.position.y + 0.2;
    }
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
