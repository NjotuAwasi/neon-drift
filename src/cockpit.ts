import * as THREE from 'three';
import type { CarDef } from './cars';

/**
 * First-person driver view. The cockpit is a small set of interior meshes parented to the car's model root,
 * so it pitches and rolls with the body. Positions are in the car's local frame: +z forward, +x = driver's left.
 */
export interface Cockpit {
  readonly group: THREE.Group;
  /** driver's eye point, car-local */
  readonly eye: THREE.Vector3;
  /** true: the exterior body is hidden while inside (its faces would block the view) */
  readonly hideBody: boolean;
  update(dt: number, speedKmh: number, boost: number, steer: number): void;
}

const neon = (c: number, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

/** Box between two car-local points (a strut / pillar / frame rail). */
function strut(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.lookAt(m.position.clone().add(b.clone().sub(a)));
  return m;
}

/** Centre touchscreen: live speed, drive mode and boost, drawn to a small canvas a few times a second. */
function makeScreen(w: number, h: number, glow: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 224;
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: 0xb0b0b0 }));
  const css = `#${new THREE.Color(glow).getHexString()}`;
  let acc = 1;
  const draw = (dt: number, kmh: number, boost: number) => {
    acc += dt;
    if (acc < 0.1) return;
    acc = 0;
    const W = canvas.width, H = canvas.height;
    g.fillStyle = '#05060b';
    g.fillRect(0, 0, W, H);
    // top-down "map": a stylised road with lane dashes scrolling at speed
    g.fillStyle = '#0d1020';
    g.fillRect(W * 0.52, 14, W * 0.44, H - 28);
    g.strokeStyle = css;
    g.globalAlpha = 0.5;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(W * 0.66, H - 14); g.lineTo(W * 0.7, 14);
    g.moveTo(W * 0.86, H - 14); g.lineTo(W * 0.82, 14);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(W * 0.76, H * 0.62); g.lineTo(W * 0.73, H * 0.74); g.lineTo(W * 0.79, H * 0.74);
    g.fill();
    // speed + gear
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = '700 84px Orbitron, system-ui, sans-serif';
    g.fillText(String(Math.round(kmh)), 22, 112);
    g.fillStyle = '#8a90a6';
    g.font = '500 22px Orbitron, system-ui, sans-serif';
    g.fillText('KM/H', 26, 146);
    g.fillStyle = css;
    g.fillText('P  R  N  ', 26, 196);
    g.fillStyle = '#ffffff';
    g.fillText('D', 26 + g.measureText('P  R  N  ').width, 196);
    // boost bar
    g.fillStyle = '#1a1d2b';
    g.fillRect(22, 160, W * 0.44, 8);
    g.fillStyle = css;
    g.fillRect(22, 160, W * 0.44 * Math.min(1, boost), 8);
    tex.needsUpdate = true;
  };
  return { mesh, draw };
}

/** Steering yoke / wheel that turns with the player's steering. */
function makeWheel(kind: 'yoke' | 'round', mat: THREE.Material, accent: THREE.Material) {
  const pivot = new THREE.Group();
  if (kind === 'yoke') {
    // squared-off "squircle" rim, like the truck's wheel
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 4), mat);
    rim.rotation.z = Math.PI / 4;
    rim.scale.set(1.25, 0.8, 1);
    pivot.add(rim);
  } else {
    pivot.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 8, 28), mat));
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), mat);
  hub.rotation.x = Math.PI / 2;
  pivot.add(hub);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.02), mat);
  pivot.add(spoke);
  // top-centre marker so the rotation reads
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.025), accent);
  mark.position.y = kind === 'yoke' ? 0.135 : 0.15;
  pivot.add(mark);
  return pivot;
}

/** Rounded rectangle path (used for the wheel rim, screen and console shapes). */
function roundRect(path: THREE.Path, w: number, h: number, r: number) {
  const x = -w / 2, y = -h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

/**
 * Large landscape centre screen in the style of the truck's UI: dark theme, a render of the truck in
 * the middle, speed and drive mode on the left, an app dock along the bottom. Static parts are painted once.
 */
function teslaScreen(w: number, h: number, glow: number) {
  const CW = 512, CH = Math.round((512 * h) / w);
  const base = document.createElement('canvas');
  base.width = CW; base.height = CH;
  const b = base.getContext('2d')!;
  const bg = b.createLinearGradient(0, 0, 0, CH);
  bg.addColorStop(0, '#1d1f24'); bg.addColorStop(1, '#0f1013');
  b.fillStyle = bg;
  b.fillRect(0, 0, CW, CH);
  // the truck, side-on, nose to the right (same profile as the 3D model)
  const sx = (x: number) => CW * 0.62 + x * 34, sy = (y: number) => CH * 0.62 - y * 34;
  const prof: [number, number][] = [[-2.6, 0.3], [-2.6, 1.26], [0.62, 1.6], [2.62, 0.95], [2.6, 0.3]];
  b.fillStyle = '#c9ccd2';
  b.beginPath();
  prof.forEach(([x, y], i) => (i ? b.lineTo(sx(-x), sy(y)) : b.moveTo(sx(-x), sy(y))));
  b.closePath();
  b.fill();
  b.fillStyle = '#2a2d33'; // side glass
  b.beginPath();
  b.moveTo(sx(-1.9), sy(1.19)); b.lineTo(sx(-0.62), sy(1.53)); b.lineTo(sx(0.7), sy(1.45)); b.lineTo(sx(0.6), sy(1.19));
  b.closePath();
  b.fill();
  b.fillStyle = '#0b0c0e';
  for (const x of [-1.93, 1.52]) { b.beginPath(); b.arc(sx(x), sy(0.4), 15, 0, Math.PI * 2); b.fill(); }
  b.fillStyle = 'rgba(0,0,0,0.35)';
  b.fillRect(sx(-2.7), sy(0.02), sx(2.7) - sx(-2.7), 4);
  // app dock
  b.fillStyle = '#08090b';
  b.fillRect(0, CH - 34, CW, 34);
  const icons = ['#d8dbe0', '#e74c3c', '#f5a623', '#4a90e2', `#${new THREE.Color(glow).getHexString()}`, '#7ed321', '#9b9b9b'];
  icons.forEach((c, i) => {
    b.fillStyle = c;
    b.beginPath();
    b.roundRect(CW * 0.3 + i * 30, CH - 26, 18, 18, 4);
    b.fill();
  });
  b.fillStyle = '#9aa0ad';
  b.font = '500 13px system-ui, sans-serif';
  b.fillText('72°', 14, CH - 12);

  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: 0xb8b8b8 }));
  const css = `#${new THREE.Color(glow).getHexString()}`;
  let acc = 1;
  const draw = (dt: number, kmh: number, boost: number) => {
    acc += dt;
    if (acc < 0.1) return;
    acc = 0;
    g.drawImage(base, 0, 0);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = '600 64px system-ui, sans-serif';
    g.fillText(String(Math.round(kmh)), 18, 84);
    g.fillStyle = '#9aa0ad';
    g.font = '500 15px system-ui, sans-serif';
    g.fillText('KM/H', 22, 106);
    g.font = '600 16px system-ui, sans-serif';
    let x = 22;
    for (const gear of ['P', 'R', 'N', 'D']) {
      g.fillStyle = gear === 'D' ? '#ffffff' : '#5c616c';
      g.fillText(gear, x, 34);
      x += 20;
    }
    g.fillStyle = '#2a2d33';
    g.fillRect(22, 118, 120, 5);
    g.fillStyle = css;
    g.fillRect(22, 118, 120 * Math.min(1, boost), 5);
    tex.needsUpdate = true;
  };
  return { mesh, draw };
}

/** Closed "squircle" wheel: thick rounded-rectangle rim, hexagonal centre pad with two scroll buttons. */
function squircleWheel(rimMat: THREE.Material, padMat: THREE.Material, accent: THREE.Material) {
  const pivot = new THREE.Group();
  const W = 0.36, H = 0.27, T = 0.042;
  const outer = roundRect(new THREE.Shape(), W, H, 0.1) as THREE.Shape;
  outer.holes.push(roundRect(new THREE.Path(), W - T * 2, H - T * 2, 0.07));
  const rimGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 8 });
  rimGeo.translate(0, 0, -0.015);
  pivot.add(new THREE.Mesh(rimGeo, rimMat));
  // horizontal spokes from the pad to the rim sides
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(W - T, 0.035, 0.02), rimMat);
  spoke.position.y = -0.01;
  pivot.add(spoke);
  // hexagonal pad, wider at the top
  const pad = new THREE.Shape();
  pad.moveTo(-0.065, 0.045); pad.lineTo(0.065, 0.045); pad.lineTo(0.085, 0.0); pad.lineTo(0.04, -0.06);
  pad.lineTo(-0.04, -0.06); pad.lineTo(-0.085, 0.0); pad.closePath();
  const padMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(pad, { depth: 0.035, bevelEnabled: false }), padMat);
  padMesh.position.z = -0.03;
  pivot.add(padMesh);
  // scroll buttons either side of the pad, with a soft glow
  for (const sx of [1, -1]) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12), accent);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(sx * 0.11, 0.0, -0.025);
    pivot.add(btn);
  }
  return pivot;
}

/**
 * Driver's arms: white gloves gripping the wheel at 9 and 3 o'clock, black shirt sleeves back to the elbows.
 * The gloves are children of the wheel (they turn with it); each frame the forearm is re-aimed from a fixed
 * elbow to the glove's wrist so the arms follow the steering naturally.
 * `gripX`: distance from the wheel centre to the rim's side bar (wheel-local). `s`: undoes any wheel scale.
 */
function addHands(group: THREE.Group, wheel: THREE.Object3D, gripX: number, s: number, elbows: [THREE.Vector3, THREE.Vector3]) {
  // a little self-light keeps the gloves reading white under the tracks' coloured lighting
  const glove = new THREE.MeshStandardMaterial({ color: 0xeeeef0, roughness: 0.8, emissive: 0x4a4a4e });
  const stitch = new THREE.MeshBasicMaterial({ color: 0x9a9aa2 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.85 });
  const up = new THREE.Vector3(0, 1, 0);
  const arms: { wrist: THREE.Object3D; elbow: THREE.Vector3; cuff: THREE.Mesh; sleeve: THREE.Mesh }[] = [];

  [1, -1].forEach((side, i) => {
    // side = +1: driver's left hand (car +x)
    const hand = new THREE.Group();
    hand.position.set(side * gripX, 0.015, 0);
    hand.scale.setScalar(s);
    wheel.add(hand);

    // four fingers wrapped round the rim's side bar, leaving the gap on the inner/driver side
    const gap = side > 0 ? (5 * Math.PI) / 4 : -Math.PI / 4; // direction of the gap in the (x, z) plane
    const arc = Math.PI * 2 - 1.3;
    for (let f = 0; f < 4; f++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0115, 6, 14, arc), glove);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = gap + 0.65; // after the x-turn, z spins the ring about the bar (the vertical axis)
      ring.position.y = 0.033 - f * 0.022;
      hand.add(ring);
    }
    // back of the hand (what the driver sees), outside and slightly toward the driver
    const back = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), glove);
    back.scale.set(0.034, 0.052, 0.04);
    back.position.set(side * 0.03, 0.0, -0.028);
    back.rotation.y = side * 0.5;
    hand.add(back);
    // classic three-line glove stitching on the back
    for (let k = -1; k <= 1; k++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.04, 0.002), stitch);
      line.position.set(side * 0.03 + k * 0.011, 0.008, -0.067);
      line.rotation.y = side * 0.5;
      hand.add(line);
    }
    // thumb resting on the inside of the rim, pointing up and in
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.04, 4, 8), glove);
    thumb.position.set(-side * 0.03, 0.03, -0.03);
    thumb.rotation.z = side * 0.7;
    hand.add(thumb);
    // wrist anchor, behind and below the hand (toward the driver)
    const wrist = new THREE.Object3D();
    wrist.position.set(side * 0.04, -0.045, -0.06);
    hand.add(wrist);

    // glove cuff (white) then the shirt sleeve (black); both re-aimed every frame
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.034 * s, 1, 12), glove);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * s, 0.05 * s, 1, 14), shirt);
    group.add(cuff, sleeve);
    arms.push({ wrist, elbow: elbows[i], cuff, sleeve });
  });

  const w = new THREE.Vector3(), dir = new THREE.Vector3();
  const place = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
    dir.subVectors(b, a);
    const len = dir.length();
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(up, dir.divideScalar(len));
    m.scale.set(1, len, 1);
  };
  const cuffEnd = new THREE.Vector3();
  return () => {
    group.updateMatrixWorld(true);
    for (const a of arms) {
      a.wrist.getWorldPosition(w);
      group.worldToLocal(w);
      // cuff: first 6 cm from the wrist toward the elbow, then the sleeve the rest of the way
      cuffEnd.subVectors(a.elbow, w).setLength(0.06 * s).add(w);
      place(a.cuff, w, cuffEnd);
      place(a.sleeve, cuffEnd, a.elbow);
    }
  };
}

function truckCockpit(def: CarDef): Cockpit {
  const group = new THREE.Group();
  const HW = 2.2 / 2;
  // left seat, set back from the dash so the whole wheel, the dash band and the screen sit in the lower half
  // of the frame, like the reference shots. Layout below is planned by view angle from here (70° vertical FOV).
  const eye = new THREE.Vector3(0.45, 1.35, -0.25);
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x1c1d22, metalness: 0.25, roughness: 0.7 });
  const dashTopMat = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.9 });
  // the light-grey dash band; a little self-light so it stays light-grey under the neon sky
  const band = new THREE.MeshStandardMaterial({ color: 0xb4b8bf, roughness: 0.75, metalness: 0.05, emissive: 0x1e2024 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6, metalness: 0.2 });

  const baseZ = 1.75, apexZ = 0.62, apexY = 1.58; // windshield base / roof apex (interior)
  const dashTop = 1.12;
  const faceZ = 0.8; // driver-facing edge of the dash

  // dark dash top running forward to the windshield
  const top = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 - 0.1, 0.06, baseZ - faceZ), dashTopMat);
  top.position.set(0, dashTop - 0.03, (baseZ + faceZ) / 2);
  group.add(top);
  // thin dark seam + ambient light line between the dash top and the band
  const seam = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 - 0.7, 0.012, 0.012), neon(def.glow, 0.9));
  seam.position.set(0, dashTop - 0.035, faceZ - 0.01);
  group.add(seam);
  // the wide light band across the dash (its ends turn back toward the doors)
  const bandTop = dashTop - 0.045, bandH = 0.15;
  const bandW = HW * 2 - 0.7;
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(bandW, bandH, 0.12), band);
  fascia.position.set(0, bandTop - bandH / 2, faceZ + 0.04);
  group.add(fascia);
  for (const sx of [1, -1]) {
    group.add(strut(
      new THREE.Vector3(sx * (bandW / 2 - 0.02), bandTop - bandH / 2, faceZ + 0.04),
      new THREE.Vector3(sx * (HW - 0.07), bandTop - bandH / 2, 0.4), bandH, 0.12, band));
  }
  // dark lower dash under the band
  const lower = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 - 0.2, 0.45, 0.5), darkTrim);
  lower.position.set(0, bandTop - bandH - 0.225, faceZ + 0.25);
  group.add(lower);

  // doors: dark card, light upper panel continuing the band, dark sill on top
  for (const sx of [1, -1]) {
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 1.8), darkTrim);
    card.position.set(sx * (HW - 0.03), dashTop - 0.3, -0.45);
    group.add(card);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.02, bandH, 1.8), band);
    panel.position.set(sx * (HW - 0.07), bandTop - bandH / 2, -0.45);
    group.add(panel);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 1.8), dashTopMat);
    sill.position.set(sx * (HW - 0.08), dashTop + 0.02, -0.45);
    group.add(sill);
    // thick A-pillar along the windshield edge
    group.add(strut(new THREE.Vector3(sx * (HW - 0.08), dashTop, baseZ), new THREE.Vector3(sx * (HW - 0.08), apexY, apexZ), 0.15, 0.1, darkTrim));
    // exterior side mirrors, seen through the side glass
    const housing = new THREE.Shape();
    housing.moveTo(0, 0); housing.lineTo(0.3, 0.02); housing.lineTo(0.27, 0.14); housing.lineTo(0.04, 0.12); housing.closePath();
    const mg = new THREE.ExtrudeGeometry(housing, { depth: 0.08, bevelEnabled: false });
    const m = new THREE.Mesh(mg, rubber);
    m.position.set(sx * (HW + 0.32), dashTop + 0.02, 1.45);
    m.scale.x = sx > 0 ? -1 : 1;
    group.add(m);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.09), new THREE.MeshStandardMaterial({ color: 0x8a93a6, metalness: 1, roughness: 0.15 }));
    glass.position.set(sx * (HW + 0.17), dashTop + 0.09, 1.44);
    glass.rotation.y = Math.PI;
    group.add(glass);
  }

  // glass roof: dark-tinted so the sky shows through, with the header at the apex
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(HW * 2 - 0.1, 0.02, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  roof.position.set(0, apexY, apexZ - 0.85);
  group.add(roof);
  const header = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 - 0.1, 0.07, 0.1), darkTrim);
  header.position.set(0, apexY - 0.02, apexZ);
  group.add(header);
  // angular rear-view mirror housing hanging from the header, centred
  const rv = new THREE.Shape();
  rv.moveTo(-0.17, 0); rv.lineTo(0.17, 0); rv.lineTo(0.12, -0.11); rv.lineTo(-0.12, -0.11); rv.closePath();
  const rvMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(rv, { depth: 0.07, bevelEnabled: false }), rubber);
  rvMesh.position.set(0, apexY - 0.05, apexZ - 0.12);
  group.add(rvMesh);
  const rvGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 1, roughness: 0.1 }));
  rvGlass.position.set(0, apexY - 0.13, apexZ - 0.125);
  rvGlass.rotation.y = Math.PI;
  group.add(rvGlass);

  // floating landscape screen in front of the band, right of the wheel, slight lean back
  const sw = 0.42, sh = 0.26;
  const screen = teslaScreen(sw, sh, def.glow);
  const screenGroup = new THREE.Group();
  screenGroup.position.set(-0.02, bandTop + 0.03, faceZ - 0.03);
  screenGroup.rotation.set(0.12, Math.PI - 0.22, 0); // faces the driver
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.02, sh + 0.02, 0.02), rubber);
  bezel.position.z = -0.012; // behind the display (the display faces local +z, toward the driver)
  screenGroup.add(bezel);
  screenGroup.add(screen.mesh);
  group.add(screenGroup);

  // centre console between the seats, light lid
  const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 1.2), darkTrim);
  console_.position.set(0, 0.62, 0.1);
  group.add(console_);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.6), band);
  lid.position.set(0, 0.78, -0.15);
  group.add(lid);

  // steering wheel on a short column out of the lower dash
  const wheel = squircleWheel(rubber, darkTrim, neon(def.glow, 1.2));
  const column = new THREE.Group();
  column.position.set(eye.x, bandTop - 0.12, 0.55);
  column.rotation.x = 0.3; // wheel face perpendicular to a column rising toward the driver
  column.add(wheel);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 10), darkTrim);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.16;
  column.add(shaft);
  group.add(column);
  // rim side bars sit at ±(0.36/2 − 0.042/2); elbows low at the driver's sides
  const arms = addHands(group, wheel, 0.159, 1, [
    new THREE.Vector3(eye.x + 0.27, eye.y - 0.62, eye.z + 0.12),
    new THREE.Vector3(eye.x - 0.27, eye.y - 0.62, eye.z + 0.12),
  ]);

  return {
    group, eye, hideBody: true,
    update(dt, kmh, boost, steer) {
      wheel.rotation.z = steer * 0.8; // steer > 0 = left; low ratio like the truck's steer-by-wire
      arms();
      screen.draw(dt, kmh, boost);
    },
  };
}

function wedgeCockpit(def: CarDef): Cockpit {
  const group = new THREE.Group();
  // single seat, centred in the bubble canopy; the real body stays visible so the long nose is in view
  const eye = new THREE.Vector3(0, 1.12, 0.0);
  const trim = new THREE.MeshStandardMaterial({ color: 0x15121f, metalness: 0.4, roughness: 0.6 });

  // compact instrument pod low in front
  const pod = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.3), trim);
  pod.position.set(0, 0.84, 0.72);
  group.add(pod);
  const screen = makeScreen(0.26, 0.15, def.glow);
  screen.mesh.position.set(0, 0.93, 0.74);
  screen.mesh.rotation.set(0.5, Math.PI, 0);
  group.add(screen.mesh);

  // canopy bow: an arch following the bubble's cross-section (centre 0,0.95,-0.15 / radii 0.72,0.42,1.35)
  const bowZ = 0.8;
  const k = Math.sqrt(1 - ((bowZ + 0.15) / 1.35) ** 2);
  const bow: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI;
    bow.push(new THREE.Vector3(Math.cos(t) * 0.72 * k, 0.95 + Math.sin(t) * 0.42 * k, bowZ));
  }
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bow), 32, 0.012, 6), neon(def.accent, 1.2)));

  const wheel = makeWheel('round', trim, neon(def.glow, 1.5));
  wheel.scale.setScalar(0.8);
  const column = new THREE.Group();
  column.position.set(0, 0.92, 0.52); // just above the hull's top surface (~0.85 here) so both hands stay visible
  column.rotation.x = 0.45;
  column.add(wheel);
  group.add(column);
  // round rim radius 0.15 (the wheel is scaled 0.8, and so are the hands: it's a tight single-seater)
  const arms = addHands(group, wheel, 0.15, 1, [
    new THREE.Vector3(eye.x + 0.24, eye.y - 0.5, eye.z + 0.14),
    new THREE.Vector3(eye.x - 0.24, eye.y - 0.5, eye.z + 0.14),
  ]);

  return {
    group, eye, hideBody: false,
    update(dt, kmh, boost, steer) {
      wheel.rotation.z = steer * 0.8;
      arms();
      screen.draw(dt, kmh, boost);
    },
  };
}

/** The wedge's single-seat layout moved into the AVTR's bubble, plus a simple hood (the real body is hidden inside). */
function avtrCockpit(def: CarDef): Cockpit {
  const c = wedgeCockpit(def);
  const shift = new THREE.Vector3(0, 0.08, 0.35);
  c.group.position.copy(shift);
  c.eye.add(shift);
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.6, roughness: 0.35, emissive: 0x2a2c3c }),
  );
  hood.scale.set(1.0, 0.42, 1.5);
  hood.position.set(0, 0.55, 1.7).sub(shift);
  c.group.add(hood);
  return { ...c, hideBody: true };
}

export function makeCockpit(def: CarDef): Cockpit {
  const c = def.body === 'truck' ? truckCockpit(def) : def.body === 'avtr' ? avtrCockpit(def) : wedgeCockpit(def);
  c.group.visible = false;
  return c;
}
