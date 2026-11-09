/** Fully synthesized audio: no asset files needed. */
export class AudioFx {
  private ctx?: AudioContext;
  private master!: GainNode;
  private engA!: OscillatorNode;
  private engB!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private driftGain!: GainNode;
  private driftFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  muted = false;
  music?: Music;

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.initSfx(ctx);
    this.music = new Music(ctx, this.master, this.noise);
    this.music.start();
  }

  private initSfx(ctx: AudioContext) {

    // engine: detuned saw + square through a lowpass that opens with speed
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 6;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engA = ctx.createOscillator();
    this.engA.type = 'sawtooth';
    this.engB = ctx.createOscillator();
    this.engB.type = 'square';
    const bGain = ctx.createGain();
    bGain.gain.value = 0.5;
    this.engA.connect(this.engFilter);
    this.engB.connect(bGain).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.engA.start();
    this.engB.start();

    // noise buffer reused for drift hiss, impacts, boost whoosh
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.driftFilter = ctx.createBiquadFilter();
    this.driftFilter.type = 'bandpass';
    this.driftFilter.frequency.value = 1800;
    this.driftFilter.Q.value = 2;
    this.driftGain = ctx.createGain();
    this.driftGain.gain.value = 0;
    src.connect(this.driftFilter).connect(this.driftGain).connect(this.master);
    src.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  update(speed: number, throttle: number, drifting: boolean, boost: number, active: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = 42 + speed * 1.5 + boost * 35;
    this.engA.frequency.setTargetAtTime(f, t, 0.06);
    this.engB.frequency.setTargetAtTime(f * 0.501, t, 0.06);
    this.engFilter.frequency.setTargetAtTime(300 + speed * 22 + throttle * 500 + boost * 900, t, 0.08);
    this.engGain.gain.setTargetAtTime(active ? 0.05 + throttle * 0.05 + boost * 0.05 : 0.025, t, 0.1);
    this.driftGain.gain.setTargetAtTime(drifting ? 0.07 + Math.min(0.06, speed * 0.0006) : 0, t, 0.05);
    this.driftFilter.frequency.setTargetAtTime(1400 + speed * 10, t, 0.1);
  }

  /** short melodic blip sequence */
  tones(freqs: number[], step = 0.09, dur = 0.16, type: OscillatorType = 'square', vol = 0.12) {
    const ctx = this.ctx;
    if (!ctx) return;
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = fr;
      const t0 = ctx.currentTime + i * step;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    });
  }

  private burst(type: BiquadFilterType, f0: number, f1: number, dur: number, vol: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  impact(strength: number) {
    this.burst('lowpass', 900, 120, 0.35, Math.min(0.5, strength * 0.025));
  }

  boost(tier: number) {
    this.burst('bandpass', 400, 3500, 0.5 + tier * 0.15, 0.25 + tier * 0.05);
    this.tones([440, 660, 880].slice(0, tier), 0.05, 0.12, 'sawtooth', 0.05);
  }

  pad() {
    this.burst('bandpass', 600, 4000, 0.45, 0.22);
    this.tones([988, 1319], 0.04, 0.1, 'square', 0.05);
  }
}

// ------------------------------------------------------------------ music

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
// i–VI–III–VII in A minor: Am, F, C, G (root MIDI + chord tones)
const CHORDS = [
  { root: 45, tones: [57, 60, 64, 69] },
  { root: 41, tones: [53, 57, 60, 65] },
  { root: 48, tones: [60, 64, 67, 72] },
  { root: 43, tones: [55, 59, 62, 67] },
];

/** Step-sequenced synthwave loop. intensity: 0 = menu (chill), 1 = race, 2 = final lap. */
export class Music {
  private readonly out: GainNode;
  private readonly arpBus: GainNode;
  private timer = 0;
  private step = 0;
  private nextTime = 0;
  private bpm = 104;
  intensity = 0;

  constructor(private readonly ctx: AudioContext, dest: AudioNode, private readonly noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.32;
    this.out.connect(dest);
    // arp gets a filtered feedback delay for that 80s shimmer
    this.arpBus = ctx.createGain();
    this.arpBus.connect(this.out);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / 104) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    this.arpBus.connect(delay).connect(lp).connect(fb).connect(delay);
    lp.connect(this.out);
  }

  start() {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  setIntensity(level: number) {
    this.intensity = level;
    this.bpm = level >= 2 ? 120 : level === 1 ? 108 : 98;
  }

  private schedule() {
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      const spb = 60 / this.bpm / 4;
      this.playStep(this.step, this.nextTime, spb);
      this.nextTime += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(s: number, t: number, spb: number) {
    const chord = CHORDS[Math.floor(s / 16) % 4];
    const st = s % 16;
    const lvl = this.intensity;

    if (st === 0) for (const n of chord.tones.slice(0, 3)) this.padNote(midi(n), t, spb * 16);

    if (lvl >= 1) {
      if (st % 4 === 0) this.kick(t);
      if (st === 4 || st === 12) this.snare(t);
      if (st % 2 === 1) this.hat(t, st % 4 === 3 ? 0.09 : 0.05);
    } else if (st === 0 || st === 8) {
      this.kick(t, 0.5);
    }

    if (st % 2 === 0) this.bass(midi(chord.root - 12 + (st % 4 === 2 ? 12 : 0)), t, spb * 1.7, lvl >= 1 ? 0.22 : 0.14);

    const arpEvery = lvl >= 2 ? 1 : 2;
    if (st % arpEvery === 0) {
      const i = (st / arpEvery) % 4;
      const order = [0, 1, 2, 3, 2, 1];
      const n = chord.tones[order[(st / arpEvery) % order.length] ?? i] + 12;
      this.pluck(midi(n), t, spb * 1.5, lvl >= 2 ? 0.07 : lvl === 1 ? 0.05 : 0.04);
    }
  }

  private env(g: GainNode, t: number, peak: number, dur: number, attack = 0.005) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private kick(t: number, vol = 0.9) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    this.env(g, t, vol, 0.32, 0.002);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.35);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, vol: number, dur: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    this.env(g, t, vol, dur, 0.001);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private snare(t: number) {
    this.noiseHit(t, 'highpass', 1400, 0.35, 0.18);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    this.env(g, t, 0.18, 0.1, 0.001);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.12);
  }

  private hat(t: number, vol: number) {
    this.noiseHit(t, 'highpass', 8000, vol, 0.045);
  }

  private bass(freq: number, t: number, dur: number, vol: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 8;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, vol, dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private pluck(freq: number, t: number, dur: number, vol: number) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3500, t);
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, vol, dur);
    o.connect(f).connect(g).connect(this.arpBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private padNote(freq: number, t: number, dur: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    for (const det of [-8, 8]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + dur + 0.05);
    }
    f.connect(g).connect(this.out);
  }
}
