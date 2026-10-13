// Fully synthesized audio (WebAudio). Gunfire, radio squelch, footsteps and ambience; the tunnel gets a long
// generated reverb tail that fades in with the player's "insideness".

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  private wind!: GainNode;
  private hum!: GainNode;
  private listener = { x: 0, z: 0, yaw: 0 };
  voice = true;
  private lastShot = 0;

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.8, 2.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.0;
    this.wet.connect(conv).connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Ambience: wind outside, ventilation/electrical hum inside
    const windSrc = this.loopNoise();
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass'; windF.frequency.value = 420; windF.Q.value = 0.4;
    this.wind = ctx.createGain(); this.wind.gain.value = 0.05;
    windSrc.connect(windF).connect(this.wind).connect(this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(windF.frequency); lfo.start();

    const humSrc = this.loopNoise();
    const humF = ctx.createBiquadFilter();
    humF.type = 'lowpass'; humF.frequency.value = 140;
    this.hum = ctx.createGain(); this.hum.gain.value = 0;
    humSrc.connect(humF).connect(this.hum).connect(this.master);
    const mains = ctx.createOscillator(); mains.frequency.value = 50;
    const mainsG = ctx.createGain(); mainsG.gain.value = 0.012;
    mains.connect(mainsG).connect(this.hum); mains.start();
  }

  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.start();
    return s;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections from the tunnel walls, then a dense tail
        const early = i % Math.floor(ctx.sampleRate * 0.031) < 40 ? 0.6 : 0;
        ch[i] = (Math.random() * 2 - 1 + early) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  setListener(x: number, z: number, yaw: number, inside: number) {
    this.listener = { x, z, yaw };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(inside * 0.55, t, 0.3);
    this.wind.gain.setTargetAtTime(0.05 * (1 - inside), t, 0.5);
    this.hum.gain.setTargetAtTime(0.09 * inside, t, 0.5);
  }

  private spatial(x: number, z: number, ref = 12): { gain: number; pan: number; dist: number } {
    const dx = x - this.listener.x, dz = z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    const yaw = this.listener.yaw; // right vector = (cos yaw, -sin yaw)
    const pan = dist < 0.5 ? 0 : Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / dist));
    return { gain: 1 / (1 + dist / ref), pan, dist };
  }

  private out(pan: number, wetAmt = 1): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.dry);
    const s = ctx.createGain();
    s.gain.value = wetAmt;
    p.connect(s).connect(this.wet);
    return p;
  }

  shot(x: number, z: number, kind: 'player' | 'friendly' | 'enemy') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (kind !== 'player' && now - this.lastShot < 0.012) return; // keep the graph small in firefights
    this.lastShot = now;
    const { gain, pan, dist } = kind === 'player' ? { gain: 1, pan: 0, dist: 0 } : this.spatial(x, z, 10);
    if (gain < 0.02) return;
    const dest = this.out(pan);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = kind === 'enemy' ? 0.85 : 1;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.max(700, 9000 - dist * 70);
    const g = ctx.createGain();
    const peak = (kind === 'player' ? 0.9 : 0.75) * gain;
    g.gain.setValueAtTime(peak, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22 + dist * 0.002);
    src.connect(f).connect(g).connect(dest);
    src.start(now, Math.random() * 1.5, 0.4);
    // body thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(45, now + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.8 * gain, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    o.connect(og).connect(dest);
    o.start(now); o.stop(now + 0.16);
  }

  click(freq = 1800, vol = 0.15, dur = 0.03) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g).connect(this.dry);
    o.start(now); o.stop(now + dur + 0.01);
  }

  hitMarker() { this.click(2400, 0.08, 0.04); }

  impact(x: number, z: number) {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 6);
    if (gain < 0.05) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 * gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    src.connect(f).connect(g).connect(this.out(pan, 0.4));
    src.start(now, Math.random(), 0.06);
  }

  radio() {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    src.connect(f).connect(g).connect(this.dry);
    src.start(now, Math.random(), 0.2);
    const o = ctx.createOscillator(); o.frequency.value = 1350;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.05, now + 0.02);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    o.connect(og).connect(this.dry); o.start(now); o.stop(now + 0.12);
  }

  footstep(inside: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600 + Math.random() * 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    src.connect(f).connect(g).connect(this.out(0, 0.3 * inside));
    src.start(now, Math.random(), 0.1);
  }

  reload() {
    this.click(600, 0.12, 0.05);
    setTimeout(() => this.click(900, 0.12, 0.04), 350);
    setTimeout(() => this.click(500, 0.15, 0.06), 1500);
  }

  say(text: string, rate = 1.05, pitch = 1) {
    if (!this.voice || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === 'de-CH') ?? voices.find((v) => v.lang.startsWith('de')) ?? null;
    u.lang = u.voice?.lang ?? 'de-DE';
    u.rate = rate; u.pitch = pitch; u.volume = 0.8;
    speechSynthesis.speak(u);
  }
}
