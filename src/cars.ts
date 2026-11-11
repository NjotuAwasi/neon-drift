/** Driving characteristics. Rival AI always uses the default spec. */
export interface CarSpec {
  maxV: number;      // top speed (u/s)
  boostV: number;    // top speed while boosting
  acc: number;       // throttle acceleration
  boostAcc: number;  // acceleration while boosting
  turn: number;      // steering rate
  driftTurn: number; // steering rate while drifting
  grip: number;      // lateral grip when not drifting
  driftGrip: number; // lateral grip while drifting (lower = longer slides)
  mass: number;      // relative mass for car-to-car collisions
}

export interface CarDef {
  id: string;
  name: string;
  blurb: string;
  body: 'wedge' | 'truck';
  paint: number;
  accent: number; // neon strips + tail light
  glow: number;   // thrusters, underglow, trails
  spec: CarSpec;
  /** 1..5 bars shown in the menu */
  stats: { speed: number; accel: number; grip: number; mass: number };
}

export const DEFAULT_SPEC: CarSpec = {
  maxV: 96, boostV: 140, acc: 64, boostAcc: 120, turn: 1.85, driftTurn: 2.35, grip: 9, driftGrip: 1.5, mass: 1,
};

export const CARS: CarDef[] = [
  {
    id: 'wedge',
    name: 'NEON WEDGE',
    blurb: 'Light and twitchy hover-wedge. Quick off the line and easy to throw into a drift.',
    body: 'wedge',
    paint: 0x3a2a66,
    accent: 0xff2bd6,
    glow: 0x22f3ff,
    spec: DEFAULT_SPEC,
    stats: { speed: 3, accel: 4, grip: 4, mass: 2 },
  },
  {
    id: 'cybertruck',
    name: 'TESLA CYBERTRUCK',
    blurb: 'Faceted stainless hover-truck. Higher top speed and shoves rivals aside, but slower to spool up and heavier in the turns.',
    body: 'truck',
    paint: 0xc3c7cd,
    accent: 0xdfe8ff,
    glow: 0x8fb8ff,
    spec: { ...DEFAULT_SPEC, maxV: 101, boostV: 146, acc: 55, boostAcc: 110, turn: 1.72, driftTurn: 2.2, grip: 10, driftGrip: 1.3, mass: 1.7 },
    stats: { speed: 4, accel: 3, grip: 3, mass: 5 },
  },
];

export const carById = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];
