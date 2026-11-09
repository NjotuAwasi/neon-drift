import type { Track } from './track';
import { MEDALS } from './tracks';

export interface Standing {
  name: string;
  color: string;
  isPlayer: boolean;
  time: number | null;
}

export interface ResultsData {
  mode: 'race' | 'tt';
  title: string;
  standings: Standing[];
  laps: number[];
  bestLap: number | null;
  newBest: boolean;
  medal: number;
  style: number;
  styleBest: boolean;
  challengeText: string | null;
  challengeWon: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const suffix = (n: number) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
export const ordinal = (n: number) => `${n}${suffix(n)}`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');

export function fmt(t: number | null | undefined) {
  if (t == null || !isFinite(t)) return '--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export class Hud {
  private readonly el = {
    hud: $('hud'), results: $('results'), resTitle: $('resTitle'), resultsBody: $('resultsBody'), chalLine: $('chalLine'),
    lap: $('lap'), time: $('time'), best: $('best'), last: $('last'), style: $('style'), delta: $('delta'),
    speed: $('speed'), arc: $('speedArc'), driftFill: $('driftFill'), driftLabel: $('driftLabel'), styleFlash: $('styleFlash'),
    center: $('center'), pos: $('pos'), challengeBtn: $<HTMLButtonElement>('challengeBtn'),
    shareStatus: $('shareStatus'), shareLink: $<HTMLInputElement>('shareLink'),
  };
  private readonly map = $<HTMLCanvasElement>('minimap').getContext('2d')!;
  private mapPts: [number, number][] = [];
  private startPt: [number, number] = [0, 0];
  private project: (x: number, z: number) => [number, number] = () => [0, 0];
  private centerTimer = 0;
  private styleTimer = 0;

  setTrack(track: Track) {
    const b = track.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const k = 170 / size;
    // top-down: +x right, +z down
    this.project = (x, z) => [110 + (x - cx) * k, 110 + (z - cz) * k];
    this.mapPts = [];
    for (let i = 0; i < track.N; i += 8) this.mapPts.push(this.project(track.pts[i].x, track.pts[i].z));
    this.startPt = this.project(track.pts[0].x, track.pts[0].z);
  }

  onResults(h: { again(): void; menu(): void; challenge(): void }) {
    const click = (id: string, fn: () => void) => $(id).addEventListener('click', (e) => { if (e.detail !== 0) fn(); });
    click('againBtn', h.again);
    click('menuBtn', h.menu);
    click('challengeBtn', h.challenge);
    this.el.shareLink.addEventListener('focus', () => this.el.shareLink.select());
  }

  showRace(mode: 'race' | 'tt') {
    this.el.hud.classList.remove('hidden');
    this.el.pos.classList.toggle('hidden', mode !== 'race');
    this.hideResults();
  }

  hideRace() {
    this.el.hud.classList.add('hidden');
    this.hideResults();
  }

  hideResults() {
    this.el.results.classList.add('hidden');
  }

  showResults(d: ResultsData) {
    const medal = d.medal >= 0 ? `<span class="medal m${d.medal}">${MEDALS[d.medal]}</span>` : '';
    let html = '';
    if (d.mode === 'race') {
      const rows = d.standings.map((s, i) =>
        `<tr class="${s.isPlayer ? 'you' : ''}"><td>${ordinal(i + 1)}</td>` +
        `<td><span class="sw" style="color:${s.color}"></span>${s.name}</td>` +
        `<td>${s.time !== null ? fmt(s.time) : 'racing…'}</td></tr>`).join('');
      html += `<table class="standings">${rows}</table>`;
    }
    const fastest = d.laps.length ? Math.min(...d.laps) : null;
    html +=
      `<div class="res-grid">` +
      `<div><span class="label">BEST LAP</span><b>${fmt(d.bestLap)}</b><span>${medal}${d.newBest ? '<span class="tag-new">NEW RECORD</span>' : ''}</span></div>` +
      `<div><span class="label">STYLE</span><b>${num(d.style)}</b><span>${d.styleBest ? '<span class="tag-new">NEW BEST</span>' : ''}</span></div>` +
      `</div>` +
      `<div class="laps">${d.laps.map((t, i) => `<span class="${t === fastest ? 'best' : ''}">L${i + 1} ${fmt(t)}</span>`).join(' &nbsp;·&nbsp; ')}</div>`;
    this.el.resultsBody.innerHTML = html;
    this.el.resTitle.textContent = d.title;
    // challenge text contains a name from a link: textContent only
    this.el.chalLine.textContent = d.challengeText ?? '';
    this.el.chalLine.className = d.challengeText ? (d.challengeWon ? 'win' : 'lose') : 'hidden';
    this.el.results.classList.remove('hidden');
  }

  setChallengeState(s: 'none' | 'pending' | 'ready') {
    const b = this.el.challengeBtn;
    b.classList.toggle('hidden', s === 'none');
    b.disabled = s !== 'ready';
    b.textContent = s === 'pending' ? 'PREPARING LINK…' : 'CHALLENGE A FRIEND';
    if (s !== 'ready') this.shareStatus('', null);
  }

  shareStatus(text: string, link: string | null) {
    this.el.shareStatus.textContent = text;
    this.el.shareLink.classList.toggle('hidden', !link);
    if (link) {
      this.el.shareLink.value = link;
      this.el.shareLink.focus();
    }
  }

  flash(text: string, ms = 1100, cls = '') {
    const c = this.el.center;
    c.textContent = text;
    c.className = `show ${cls}`;
    clearTimeout(this.centerTimer);
    if (ms > 0) this.centerTimer = window.setTimeout(() => (c.className = cls), ms);
  }

  styleFlash(text: string, bad = false) {
    const el = this.el.styleFlash;
    el.textContent = text;
    el.className = '';
    void el.offsetWidth; // restart the animation
    el.className = bad ? 'show bad' : 'show';
    clearTimeout(this.styleTimer);
    this.styleTimer = window.setTimeout(() => (el.className = ''), 1300);
  }

  setLap(lap: number, total: number) {
    this.el.lap.innerHTML = `${Math.min(lap, total)}<span class="dim">/${total}</span>`;
  }

  /** current = null shows OUT LAP (time-trial run-up) */
  setTimes(current: number | null, best: number | null, last: number | null) {
    this.el.time.textContent = current === null ? 'OUT LAP' : fmt(current);
    this.el.best.textContent = fmt(best);
    this.el.last.textContent = fmt(last);
  }

  setStyle(total: number) {
    this.el.style.textContent = num(total);
  }

  setDelta(d: number | null, who = 'ghost') {
    const el = this.el.delta;
    if (d === null) { el.textContent = ''; el.className = ''; return; }
    el.textContent = `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)} vs ${who}`;
    el.className = d < 0 ? 'ahead' : 'behind';
  }

  setSpeed(kmh: number, frac: number, boosting: boolean) {
    this.el.speed.textContent = String(Math.round(kmh));
    this.el.arc.style.strokeDasharray = `${(377 * Math.min(1, frac)).toFixed(1)} 1000`;
    this.el.arc.classList.toggle('boost', boosting);
  }

  setDrift(frac: number, tier: number, drifting: boolean, points: number, mult: number) {
    this.el.driftFill.style.width = `${frac * 100}%`;
    const label = this.el.driftLabel;
    label.textContent = drifting && points > 0 ? `DRIFT ${num(points)}${mult > 1 ? ` ×${mult}` : ''}` : 'DRIFT';
    label.className = drifting && tier ? `t${tier}` : '';
  }

  setPosition(pos: number, total: number) {
    this.el.pos.innerHTML = `${pos}<sup>${suffix(pos)}</sup><span class="dim">/${total}</span>`;
    this.el.pos.classList.toggle('first', pos === 1);
  }

  drawMap(car: { x: number; z: number }, ghost: { x: number; z: number } | null, rivals: { x: number; z: number; color: string }[]) {
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
    g.fillStyle = '#fff';
    g.fillRect(this.startPt[0] - 1.5, this.startPt[1] - 7, 3, 14);
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
