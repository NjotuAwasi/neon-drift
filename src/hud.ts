import type { Track } from './track';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Standing {
  name: string;
  color: string;
  isPlayer: boolean;
  time: number | null;
}

const suffix = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const ordinal = (n: number) => `${n}${suffix(n)}`;

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
    center: $('center'), bestMenu: $('bestMenu'), pos: $('pos'),
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

  showResults(laps: number[], best: number | null, standings: Standing[]) {
    const fastest = Math.min(...laps);
    const rows = standings.map((s, i) =>
      `<tr class="${s.isPlayer ? 'you' : ''}"><td>${ordinal(i + 1)}</td>` +
      `<td><span class="sw" style="color:${s.color}"></span>${s.name}</td>` +
      `<td>${s.time !== null ? fmt(s.time) : 'racing…'}</td></tr>`).join('');
    this.el.resultsBody.innerHTML =
      `<table class="standings">${rows}</table>` +
      `<div class="laps">${laps.map((t, i) => `<span class="${t === fastest ? 'best' : ''}">L${i + 1} ${fmt(t)}</span>`).join(' &nbsp;·&nbsp; ')}</div>` +
      `<div class="laps">BEST LAP EVER &nbsp; <span class="best">${fmt(best)}</span></div>`;
    this.el.results.classList.remove('hidden');
  }

  setPosition(pos: number, total: number) {
    this.el.pos.innerHTML = `${pos}<sup>${suffix(pos)}</sup><span class="dim">/${total}</span>`;
    this.el.pos.classList.toggle('first', pos === 1);
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

  drawMap(car: { x: number; z: number }, ghost: { x: number; z: number } | null, rivals: { x: number; z: number; color: string }[] = []) {
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
    for (const r of rivals) {
      const [rx, ry] = this.project(r.x, r.z);
      g.fillStyle = r.color;
      g.shadowColor = r.color;
      g.beginPath(); g.arc(rx, ry, 4.5, 0, Math.PI * 2); g.fill();
    }
    const [cx, cy] = this.project(car.x, car.z);
    g.fillStyle = '#ffd23f';
    g.shadowColor = '#ffd23f';
    g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  }
}
