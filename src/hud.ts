import type { Track } from './track';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function fmt(t: number | null) {
  if (t === null || !isFinite(t)) return '--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export class Hud {
  private readonly el = {
    hud: $('hud'), menu: $('menu'), results: $('results'), resultsBody: $('resultsBody'),
    lap: $('lap'), time: $('time'), best: $('best'), last: $('last'), delta: $('delta'),
    speed: $('speed'), arc: $('speedArc'), driftFill: $('driftFill'), driftLabel: $('driftLabel'),
    center: $('center'), bestMenu: $('bestMenu'),
  };
  private readonly map = $<HTMLCanvasElement>('minimap').getContext('2d')!;
  private readonly mapPts: [number, number][] = [];
  private centerTimer = 0;

  constructor(private readonly track: Track) {
    const b = track.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    for (let i = 0; i < track.N; i += 8) {
      const p = track.pts[i];
      this.mapPts.push(this.toMap(p.x, p.z, cx, cz, size));
    }
    this.project = (x, z) => this.toMap(x, z, cx, cz, size);
  }

  private project: (x: number, z: number) => [number, number];
  // minimap is viewed from above with +x to the right and -z up
  private toMap(x: number, z: number, cx: number, cz: number, size: number): [number, number] {
    const k = 170 / size;
    return [110 + (x - cx) * k, 110 + (z - cz) * k];
  }

  showMenu(best: number | null) {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.results.classList.add('hidden');
    this.el.bestMenu.textContent = best ? `BEST LAP  ${fmt(best)}` : '';
  }

  showRace() {
    this.el.menu.classList.add('hidden');
    this.el.results.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  showResults(laps: number[], best: number | null) {
    const fastest = Math.min(...laps);
    const total = laps.reduce((a, b) => a + b, 0);
    this.el.resultsBody.innerHTML =
      laps.map((t, i) => `<div class="${t === fastest ? 'best' : ''}">LAP ${i + 1} &nbsp; ${fmt(t)}</div>`).join('') +
      `<div class="total">TOTAL ${fmt(total)}</div>` +
      `<div>ALL-TIME BEST LAP &nbsp; <span class="best">${fmt(best)}</span></div>`;
    this.el.results.classList.remove('hidden');
  }

  flash(text: string, ms = 1100, cls = '') {
    const c = this.el.center;
    c.textContent = text;
    c.className = `show ${cls}`;
    clearTimeout(this.centerTimer);
    if (ms > 0) this.centerTimer = window.setTimeout(() => (c.className = cls), ms);
  }

  setLap(lap: number, total: number) {
    this.el.lap.innerHTML = `${Math.min(lap, total)}<span class="dim">/${total}</span>`;
  }

  setTimes(current: number, best: number | null, last: number | null) {
    this.el.time.textContent = fmt(current);
    this.el.best.textContent = fmt(best);
    this.el.last.textContent = fmt(last);
  }

  setDelta(d: number | null) {
    const el = this.el.delta;
    if (d === null) { el.textContent = ''; el.className = ''; return; }
    el.textContent = `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)} vs ghost`;
    el.className = d < 0 ? 'ahead' : 'behind';
  }

  setSpeed(kmh: number, frac: number, boosting: boolean) {
    this.el.speed.textContent = String(Math.round(kmh));
    this.el.arc.style.strokeDasharray = `${(377 * Math.min(1, frac)).toFixed(1)} 1000`;
    this.el.arc.classList.toggle('boost', boosting);
  }

  setDrift(frac: number, tier: number, drifting: boolean) {
    this.el.driftFill.style.width = `${frac * 100}%`;
    const label = this.el.driftLabel;
    label.textContent = drifting ? (tier ? `DRIFT ×${tier}` : 'DRIFT') : 'DRIFT';
    label.className = drifting && tier ? `t${tier}` : '';
  }

  drawMap(car: { x: number; z: number }, ghost: { x: number; z: number } | null) {
    const g = this.map;
    g.clearRect(0, 0, 220, 220);
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(255,43,214,0.85)';
    g.shadowColor = '#ff2bd6';
    g.shadowBlur = 8;
    g.beginPath();
    this.mapPts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
    g.shadowBlur = 10;
    const [sx, sy] = this.project(this.track.pts[0].x, this.track.pts[0].z);
    g.fillStyle = '#fff';
    g.fillRect(sx - 1.5, sy - 7, 3, 14);
    if (ghost) {
      const [gx, gy] = this.project(ghost.x, ghost.z);
      g.fillStyle = 'rgba(34,243,255,0.6)';
      g.shadowColor = '#22f3ff';
      g.beginPath(); g.arc(gx, gy, 5, 0, Math.PI * 2); g.fill();
    }
    const [cx, cy] = this.project(car.x, car.z);
    g.fillStyle = '#ffd23f';
    g.shadowColor = '#ffd23f';
    g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  }
}
