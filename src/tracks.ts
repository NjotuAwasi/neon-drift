import * as THREE from 'three';

export interface Palette {
  fog: THREE.Color;
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  horizon: THREE.Color;
  sunLow: THREE.Color;
  sunHigh: THREE.Color;
  sunDir: THREE.Vector3;
  grid: THREE.Color;
  mountain: number;
  hemiSky: number;
  hemiGround: number;
  sunLight: number;
}

export interface CityOpts {
  seed: number;
  counts: [number, number, number]; // low, mid, tower buildings
  towerDist: number; // towers stay at least this far from the road centre
  pad: number; // how far the city extends past the track bounds
}

export interface PadSpec {
  x: number;
  z: number;
  lat: number;
}

export interface TrackDef {
  id: string;
  name: string;
  blurb: string;
  ghostKey: string;
  styleKey: string;
  points: THREE.Vector3[];
  arcDivisions?: number;
  pads?: PadSpec[];
  palette: Palette;
  city: CityOpts;
  /** bronze, silver, gold, neon lap targets (seconds) */
  medals: [number, number, number, number];
}

export const MEDALS = ['BRONZE', 'SILVER', 'GOLD', 'NEON'] as const;

/** Highest medal index earned by a lap time, or -1. */
export function medalFor(def: TrackDef, t: number | null | undefined) {
  if (t == null) return -1;
  let m = -1;
  def.medals.forEach((limit, i) => {
    if (t <= limit) m = i;
  });
  return m;
}

export function nextMedal(def: TrackDef, t: number | null | undefined) {
  const m = medalFor(def, t);
  return m >= def.medals.length - 1 ? null : { medal: m + 1, time: def.medals[m + 1] };
}

/**
 * Closed street-style loop: straight edges between corners, each corner rounded
 * with an exact radius. corners = [x, z, radius]. Returns dense points starting
 * nearest `start`, in polygon order.
 */
function filletLoop(corners: [number, number, number][], start: [number, number], step = 4) {
  const n = corners.length;
  const P = corners.map(([x, z]) => new THREE.Vector2(x, z));
  const arcs = corners.map(([, , r], i) => {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n];
    const d1 = p1.clone().sub(p0).normalize();
    const d2 = p2.clone().sub(p1).normalize();
    const turn = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
    const sign = Math.sign(d1.x * d2.y - d1.y * d2.x) || 1;
    const t = r * Math.tan(turn / 2);
    const a = p1.clone().addScaledVector(d1, -t);
    const b = p1.clone().addScaledVector(d2, t);
    const c = a.clone().add(new THREE.Vector2(-d1.y, d1.x).multiplyScalar(sign * r));
    return { a, b, c, r, turn, sign };
  });
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const { a, b, c, r, turn, sign } = arcs[i];
    const a0 = Math.atan2(a.y - c.y, a.x - c.x);
    const m = Math.max(2, Math.ceil((r * turn) / step));
    for (let k = 0; k < m; k++) {
      const th = a0 + sign * turn * (k / m);
      out.push(new THREE.Vector2(c.x + Math.cos(th) * r, c.y + Math.sin(th) * r));
    }
    const next = arcs[(i + 1) % n].a;
    const s = Math.max(1, Math.ceil(b.distanceTo(next) / step));
    for (let k = 0; k < s; k++) out.push(b.clone().lerp(next, k / s));
  }
  const sp = new THREE.Vector2(start[0], start[1]);
  let best = 0, bd = Infinity;
  out.forEach((p, i) => {
    const d = p.distanceToSquared(sp);
    if (d < bd) { bd = d; best = i; }
  });
  return out.slice(best).concat(out.slice(0, best)).map((p) => new THREE.Vector3(p.x, 0, p.y));
}

const rgb = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

// Original flowing circuit. Geometry must stay identical so saved best laps remain valid.
const SUNSET: [number, number][] = [
  [0, 0], [150, 0], [230, -60], [240, -160], [170, -230], [80, -190],
  [10, -240], [-90, -280], [-190, -230], [-220, -120], [-150, -70],
  [-180, 20], [-120, 90], [-85, 35], [-50, 0],
];

// City-block street circuit: long main straight, chicane, then a run of 90° corners.
const DOWNTOWN: [number, number, number][] = [
  [360, 0, 32],
  [360, 70, 28], [336, 102, 28], [360, 134, 28], // chicane
  [360, 220, 30],
  [200, 220, 26],
  [200, 110, 26],
  [60, 110, 26],
  [60, 310, 30],
  [-120, 310, 34],
  [-120, 0, 34],
];

export const TRACKS: TrackDef[] = [
  {
    id: 'sunset',
    name: 'SUNSET STRIP',
    blurb: 'Flowing curves through the neon sprawl',
    ghostKey: 'neon-drift:best-v1',
    styleKey: 'neon-drift:style-v1:sunset',
    points: SUNSET.map(([x, z]) => new THREE.Vector3(x * 1.8, 0, z * 1.8)),
    palette: {
      fog: rgb(0.32, 0.06, 0.26),
      skyTop: rgb(0.015, 0.008, 0.05),
      skyMid: rgb(0.2, 0.02, 0.28),
      horizon: rgb(1.0, 0.22, 0.48),
      sunLow: rgb(1.0, 0.08, 0.55),
      sunHigh: rgb(1.0, 0.86, 0.25),
      sunDir: new THREE.Vector3(0.35, 0.11, -1).normalize(),
      grid: rgb(1.0, 0.12, 0.75),
      mountain: 0xb02bff,
      hemiSky: 0x7a44ff,
      hemiGround: 0x14001f,
      sunLight: 0xff6fb0,
    },
    city: { seed: 1337, counts: [520, 260, 90], towerDist: 140, pad: 650 },
    // clean pad-using bot lap ≈ 31.4 s; neon means matching it
    medals: [38, 35.5, 33, 31.5],
  },
  {
    id: 'downtown',
    name: 'DOWNTOWN',
    blurb: 'Tight street circuit through the tower blocks',
    ghostKey: 'neon-drift:best-v1:downtown',
    styleKey: 'neon-drift:style-v1:downtown',
    points: filletLoop(DOWNTOWN, [0, 0]),
    arcDivisions: 6000,
    pads: [
      { x: 140, z: 0, lat: 4.5 },
      { x: 290, z: 220, lat: -4.5 },
      { x: 60, z: 165, lat: 0 },
      { x: 0, z: 310, lat: 4.5 },
      { x: -120, z: 240, lat: -4.5 },
    ],
    palette: {
      fog: rgb(0.04, 0.09, 0.2),
      skyTop: rgb(0.004, 0.008, 0.035),
      skyMid: rgb(0.02, 0.07, 0.2),
      horizon: rgb(0.08, 0.5, 0.95),
      sunLow: rgb(0.1, 0.4, 1.0),
      sunHigh: rgb(0.85, 0.97, 1.0),
      sunDir: new THREE.Vector3(-0.55, 0.2, -0.8).normalize(),
      grid: rgb(0.1, 0.7, 1.0),
      mountain: 0x2b7bff,
      hemiSky: 0x4a7dff,
      hemiGround: 0x00081f,
      sunLight: 0x7fd0ff,
    },
    city: { seed: 4242, counts: [700, 420, 200], towerDist: 30, pad: 450 },
    // clean pad-using bot lap ≈ 26.6 s
    medals: [32, 30, 28, 26.8],
  },
];
