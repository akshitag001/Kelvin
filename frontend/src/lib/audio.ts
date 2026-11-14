// Fire Jukebox: every sound is synthesized with the Web Audio API. Nothing autoplays.
//
// Mappings (documented in the UI and docs/METHODOLOGY.md):
//   pitch      = log(count), quantized to a major pentatonic scale (C3 .. C6)
//   loudness   = higher when above the baseline median
//   brightness = filter cutoff; brighter above the median, darker below
//   crackle    = random clicks whose rate is proportional to the day's hotspot count

const PENTA = [0, 2, 4, 7, 9];
const BASE_MIDI = 48; // C3
const SPAN_STEPS = 15; // 3 octaves of pentatonic steps

export function pitchFor(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return midiToHz(BASE_MIDI - 5);
  const t = Math.min(1, Math.log1p(value) / Math.log1p(max));
  const step = Math.round(t * SPAN_STEPS);
  const midi = BASE_MIDI + Math.floor(step / 5) * 12 + PENTA[step % 5];
  return midiToHz(midi);
}

export function continuousPitch(value: number, max: number): number {
  // unquantized log pitch, used for "hear the sensor jump" so the leap is audible
  if (!(value > 0) || !(max > 0)) return 110;
  const t = Math.min(1, Math.log1p(value) / Math.log1p(max));
  return 130.8 * 2 ** (t * 3);
}

const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export interface NoteSpec {
  freq: number;
  dur: number;      // seconds
  gain?: number;    // 0..1, before master volume
  bright?: number;  // 0..1, filter openness
  wave?: OscillatorType;
}

export interface PlayHandle {
  stop: () => void;
  done: Promise<void>;
}

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = new Set<AudioScheduledSourceNode>();
  private timers = new Set<number>();
  volume = 0.35;

  private ensure(): AudioContext {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      this.master.connect(comp).connect(this.ctx.destination);
    }
    this.master!.gain.value = this.volume;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private note(n: NoteSpec, at: number) {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const env = ctx.createGain();
    osc.type = n.wave ?? "triangle";
    osc2.type = "sine";
    osc.frequency.value = n.freq;
    osc2.frequency.value = n.freq * 2;
    filt.type = "lowpass";
    filt.frequency.value = 500 + (n.bright ?? 0.5) * 4500;
    filt.Q.value = 0.7;
    const g = Math.max(0.02, Math.min(1, n.gain ?? 0.6)) * 0.5;
    const a = 0.012, r = Math.max(0.08, n.dur * 0.9);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(g, at + a);
    env.gain.exponentialRampToValueAtTime(0.0001, at + r);
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    osc.connect(filt);
    osc2.connect(g2).connect(filt);
    filt.connect(env).connect(this.master!);
    for (const o of [osc, osc2]) {
      o.start(at);
      o.stop(at + r + 0.05);
      this.active.add(o);
      o.onended = () => this.active.delete(o);
    }
  }

  tone(n: NoteSpec) {
    const ctx = this.ensure();
    this.note(n, ctx.currentTime + 0.01);
  }

  /** Play a sequence; onStep(i) fires as each note sounds (for captions and highlights). */
  sequence(notes: NoteSpec[], step: number, onStep?: (i: number) => void): PlayHandle {
    const ctx = this.ensure();
    const t0 = ctx.currentTime + 0.08;
    notes.forEach((n, i) => this.note(n, t0 + i * step));
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    notes.forEach((_, i) => {
      const id = window.setTimeout(() => { onStep?.(i); this.timers.delete(id); }, (0.08 + i * step) * 1000);
      this.timers.add(id);
    });
    const end = window.setTimeout(() => { resolve(); this.timers.delete(end); }, (0.08 + notes.length * step + 0.3) * 1000);
    this.timers.add(end);
    return { stop: () => { this.stopAll(); resolve(); }, done };
  }

  /** Campfire crackle for `seconds`, with `rate` clicks per second. */
  crackle(rate: number, seconds: number): PlayHandle {
    const ctx = this.ensure();
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
    const t0 = ctx.currentTime + 0.05;
    let t = 0;
    // hum underneath so silence (zero hotspots) is still clearly "playing"
    const hum = ctx.createOscillator();
    const hg = ctx.createGain();
    hum.type = "sine"; hum.frequency.value = 70; hg.gain.value = 0.03;
    hum.connect(hg).connect(this.master!);
    hum.start(t0); hum.stop(t0 + seconds);
    this.active.add(hum);
    while (rate > 0 && t < seconds) {
      t += -Math.log(1 - Math.random()) / rate;
      if (t >= seconds) break;
      const src = ctx.createBufferSource();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      src.buffer = buf;
      bp.type = "bandpass"; bp.frequency.value = 1200 + Math.random() * 3500; bp.Q.value = 1.2;
      g.gain.value = 0.25 + Math.random() * 0.6;
      src.connect(bp).connect(g).connect(this.master!);
      src.start(t0 + t);
      this.active.add(src);
      src.onended = () => this.active.delete(src);
    }
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const id = window.setTimeout(() => { resolve(); this.timers.delete(id); }, (seconds + 0.1) * 1000);
    this.timers.add(id);
    return { stop: () => { this.stopAll(); resolve(); }, done };
  }

  stopAll() {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    const now = this.ctx?.currentTime ?? 0;
    for (const s of this.active) { try { s.stop(now); } catch { /* already stopped */ } }
    this.active.clear();
  }

  get supported(): boolean {
    return typeof window !== "undefined" && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
  }
}

export const audio = new Engine();
