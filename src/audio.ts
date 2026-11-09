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

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

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
}
