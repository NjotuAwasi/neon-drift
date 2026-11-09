import { MEDALS, TRACKS, type TrackDef } from './tracks';
import { cleanName, type Challenge } from './challenge';
import { fmt } from './hud';

export type Mode = 'race' | 'tt';
export type Diff = 'easy' | 'normal' | 'insane';

export interface Settings {
  track: string;
  mode: Mode;
  diff: Diff;
  name: string;
}

export interface TrackInfo {
  best: number | null;
  medal: number;
  next: { medal: number; time: number } | null;
  style: number | null;
}

type Row = 'track' | 'mode' | 'diff' | 'name';

export interface MenuCallbacks {
  changed(what: Row): void;
  start(): void;
  dismiss(): void;
}

const KEY = 'neon-drift:settings';
const MODES: { id: Mode; label: string }[] = [
  { id: 'race', label: 'RACE' },
  { id: 'tt', label: 'TIME TRIAL' },
];
const DIFFS: { id: Diff; label: string }[] = [
  { id: 'easy', label: 'EASY' },
  { id: 'normal', label: 'NORMAL' },
  { id: 'insane', label: 'INSANE' },
];

export function loadSettings(): Settings {
  const s: Settings = { track: TRACKS[0].id, mode: 'race', diff: 'normal', name: 'PLAYER' };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    if (TRACKS.some((t) => t.id === raw.track)) s.track = raw.track!;
    if (MODES.some((m) => m.id === raw.mode)) s.mode = raw.mode!;
    if (DIFFS.some((d) => d.id === raw.diff)) s.diff = raw.diff!;
    if (typeof raw.name === 'string' && cleanName(raw.name)) s.name = cleanName(raw.name);
  } catch { /* defaults */ }
  return s;
}

function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const $ = (id: string) => document.getElementById(id)!;

export class Menu {
  private readonly root = $('menu');
  private readonly rows = [...this.root.querySelectorAll<HTMLElement>('.opt')];
  private readonly nameInput = $('vName') as HTMLInputElement;
  private focus = 0;
  private challenge: Challenge | null = null;

  constructor(readonly settings: Settings, private readonly cb: MenuCallbacks) {
    this.root.querySelectorAll<HTMLButtonElement>('.arr').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest<HTMLElement>('.opt')!;
        this.focus = Math.max(0, this.visible().indexOf(row));
        this.step(row.dataset.row as Row, Number(btn.dataset.dir));
      }));
    this.rows.forEach((row) =>
      row.addEventListener('click', () => {
        this.focus = Math.max(0, this.visible().indexOf(row));
        this.render();
      }));

    this.nameInput.value = settings.name;
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') this.nameInput.blur();
    });
    this.nameInput.addEventListener('blur', () => {
      this.settings.name = cleanName(this.nameInput.value) || 'PLAYER';
      this.nameInput.value = this.settings.name;
      saveSettings(this.settings);
      this.cb.changed('name');
    });
    // keyboard "clicks" (detail 0) are ignored: Enter is handled by the game input instead
    $('startBtn').addEventListener('click', (e) => { if (e.detail !== 0) this.cb.start(); });
    $('cbDismiss').addEventListener('click', () => this.cb.dismiss());
    this.render();
  }

  private visible() {
    return this.rows.filter((r) => !r.classList.contains('hidden'));
  }

  nav(dx: number, dy: number) {
    const vis = this.visible();
    if (dy && vis.length) this.focus = (this.focus + dy + vis.length) % vis.length;
    if (dx) {
      const row = vis[this.focus];
      if (row) this.step(row.dataset.row as Row, dx);
    }
    this.render();
  }

  private step(row: Row, dir: number) {
    const s = this.settings;
    const cycle = <T extends { id: string }>(list: T[], cur: string) =>
      list[(list.findIndex((x) => x.id === cur) + dir + list.length) % list.length].id;
    if (row === 'track') s.track = cycle(TRACKS, s.track);
    else if (row === 'mode') s.mode = cycle(MODES, s.mode) as Mode;
    else if (row === 'diff') s.diff = cycle(DIFFS, s.diff) as Diff;
    else return;
    saveSettings(s);
    this.cb.changed(row);
    this.render();
  }

  setChallenge(ch: Challenge | null, trackName = '') {
    this.challenge = ch;
    $('challengeBanner').classList.toggle('hidden', !ch);
    // name comes from a link: textContent only
    if (ch) $('cbText').textContent = `${ch.name} drove ${fmt(ch.time)} on ${trackName}. Race their ghost and beat it.`;
    this.focus = 0;
    this.render();
  }

  setInfo(def: TrackDef, info: TrackInfo) {
    const medal = (m: number) => `<span class="medal m${m}">${MEDALS[m]}</span>`;
    const best = info.best !== null ? `BEST ${fmt(info.best)}${info.medal >= 0 ? ' ' + medal(info.medal) : ''}` : 'NO TIME YET';
    const next = info.next ? ` &nbsp;·&nbsp; NEXT ${medal(info.next.medal)} ${fmt(info.next.time)}` : ' &nbsp;·&nbsp; ALL MEDALS WON';
    const style = info.style ? ` &nbsp;·&nbsp; STYLE ${info.style.toLocaleString('en-US')}` : '';
    $('trackInfo').innerHTML = `<div class="blurb">${def.blurb}</div><div class="rec">${best}${next}${style}</div>`;
  }

  render() {
    const s = this.settings;
    const ch = !!this.challenge;
    const row = (id: Row) => this.rows.find((r) => r.dataset.row === id)!;
    row('track').classList.toggle('hidden', ch);
    row('mode').classList.toggle('hidden', ch);
    row('diff').classList.toggle('hidden', ch || s.mode !== 'race');
    $('vTrack').textContent = TRACKS.find((t) => t.id === s.track)!.name;
    $('vMode').textContent = MODES.find((m) => m.id === s.mode)!.label;
    $('vDiff').textContent = DIFFS.find((d) => d.id === s.diff)!.label;
    const vis = this.visible();
    this.focus = Math.max(0, Math.min(this.focus, vis.length - 1));
    this.rows.forEach((r) => r.classList.toggle('focus', r === vis[this.focus]));
    $('startBtn').textContent = ch ? 'ACCEPT CHALLENGE' : s.mode === 'race' ? 'START RACE' : 'START TIME TRIAL';
  }

  show() {
    this.root.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.root.classList.add('hidden');
  }
}
