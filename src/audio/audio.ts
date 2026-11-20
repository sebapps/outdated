// Task 13: optional audio layer. Synthesized with the Web Audio API, driven by SOUND events.
// It never imports the engine, never throws, and the game is fully playable without it (captions are
// printed by the UI regardless). The context is created lazily on a user gesture.
import { cuesFromEvents, recipeFor, recipeLength, type CueRecipe, type CueStep } from './cues';
import {
  EMPTY_VOICE_INDEX,
  loadVoiceIndex,
  voiceCaptions,
  voiceLinesForEvents,
  type VoiceEntry,
  type VoiceIndex,
  type VoicePlay,
} from './voice';

// ---- minimal structural types so tests can supply a fake context ---------------------------------
interface ParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
}
interface NodeLike {
  connect(dest: unknown): unknown;
  disconnect?(): unknown;
}
interface OscLike extends NodeLike {
  type: string;
  frequency: ParamLike;
  start(t?: number): void;
  stop(t?: number): void;
}
interface GainLike extends NodeLike {
  gain: ParamLike;
}
interface FilterLike extends NodeLike {
  type: string;
  frequency: ParamLike;
  Q?: ParamLike;
}
interface BufferLike {
  readonly duration?: number;
  getChannelData(channel: number): Float32Array;
}
interface SourceLike extends NodeLike {
  buffer: unknown;
  playbackRate?: ParamLike;
  loop?: boolean;
  start(t?: number): void;
  stop(t?: number): void;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  close?(): Promise<void>;
  createOscillator(): OscLike;
  createGain(): GainLike;
  createBiquadFilter(): FilterLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<BufferLike>;
}

export interface AudioEngineOptions {
  /** Creates the context. Defaults to the browser's AudioContext, or null where unsupported. */
  createContext?: () => AudioContextLike | null;
  isMuted: () => boolean;
  /** Fetch used to look for optional voice samples. Defaults to global fetch. */
  fetchImpl?: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer>; json?(): Promise<unknown> }>;
  /** Base URL for sample files. */
  sampleBase?: string;
}

/** Longest total cue time we queue in one turn, so a burst of events never turns into a wall of noise. */
const MAX_QUEUE_SECONDS = 6;

function defaultContext(): AudioContextLike | null {
  try {
    const g = globalThis as unknown as {
      AudioContext?: new () => AudioContextLike;
      webkitAudioContext?: new () => AudioContextLike;
    };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private master: GainLike | null = null;
  private noiseBuffer: BufferLike | null = null;
  private readonly samples = new Map<string, BufferLike | null>();
  private readonly sources = new Set<SourceLike | OscLike>();
  private muted: boolean;
  private unlocked = false;
  private voice: VoiceIndex = EMPTY_VOICE_INDEX;

  constructor(private readonly opts: AudioEngineOptions) {
    this.muted = safe(() => opts.isMuted(), false);
  }

  /** Call from a user gesture (keydown, click). Creates and resumes the context; safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = (this.opts.createContext ?? defaultContext)();
        if (!this.ctx) return;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        this.master.connect(this.ctx.destination);
      }
      this.unlocked = true;
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  /** Mirrors the mute preference. Muting also silences anything currently playing. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      if (this.master) this.master.gain.value = muted ? 0 : 0.8;
      if (muted) this.stopAll();
    } catch {
      /* ignore */
    }
  }

  /** Feed a turn's engine events. Plays nothing when muted, locked, or unsupported. */
  handleEvents(events: readonly { type: string; cue?: unknown; id?: unknown }[]): void {
    try {
      this.muted = safe(() => this.opts.isMuted(), this.muted);
      if (this.muted) return;
      // Voice lines replace the synthesized stand-in cue they name; they bring the stand-in back if they fail.
      const plays = voiceLinesForEvents(events).filter((p) =>
        this.voice.has(p.id),
      );
      const replaced = new Set(plays.flatMap((p) => (p.fallbackCue ? [p.fallbackCue] : [])));
      const cues = cuesFromEvents(events).filter((c) => !replaced.has(c));
      if (cues.length === 0 && plays.length === 0) return;
      if (!this.unlocked) this.unlock();
      if (!this.ctx || !this.master) return;
      let offset = 0;
      for (const cue of cues) {
        const recipe = recipeFor(cue);
        if (!recipe) continue;
        if (offset >= MAX_QUEUE_SECONDS) break;
        this.play(cue, recipe, offset);
        offset += Math.min(recipeLength(recipe), 1.5) + 0.1;
      }
      if (plays.length > 0) void this.playVoice(plays, offset).catch(() => undefined);
    } catch {
      /* audio must never break the game */
    }
  }

  /**
   * Loads public/audio/voice/index.json. Never throws and never needs an AudioContext. Until it resolves
   * (or if it fails) the index is empty and only synthesized cues and the engine's own captions are used.
   */
  async loadVoiceIndex(): Promise<VoiceIndex> {
    this.voice = await loadVoiceIndex(this.fetcher(), this.base());
    return this.voice;
  }

  /** Captions for this turn's voice lines. Independent of mute, the audio context and sample loading. */
  captionsFor(events: readonly { type: string; id?: unknown }[]): string[] {
    try {
      return voiceCaptions(events, this.voice);
    } catch {
      return [];
    }
  }

  /** Stops everything that is playing. */
  stopAll(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
  }

  // ---- internals -----------------------------------------------------------------------------
  private play(cue: string, recipe: CueRecipe, delay: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + delay + 0.02;
    if (recipe.sample) {
      const sample = recipe.sample;
      void this.loadFile(`${sample.id}.mp3`).then((buf) => {
        if (this.muted) return;
        try {
          if (buf) this.playBuffer(buf, ctx.currentTime + 0.02, sample.reversed);
          else if (cue === 'record_reversed') this.playReversedStandIn(ctx.currentTime + 0.02);
          else this.playSteps(recipe.steps, start);
        } catch {
          /* ignore */
        }
      });
      return;
    }
    this.playSteps(recipe.steps, start);
  }

  private playSteps(steps: readonly CueStep[], start: number): void {
    for (const step of steps) {
      if (step.kind === 'tone') this.playTone(step, start);
      else this.playNoise(step, start);
    }
  }

  private envelope(at: number, duration: number, peak: number): GainLike | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const g = ctx.createGain();
    const attack = Math.min(0.01, duration / 4);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, Math.max(at + attack, at + duration - 0.02));
    g.gain.linearRampToValueAtTime(0, at + duration);
    g.connect(this.master);
    return g;
  }

  private playTone(step: Extract<CueStep, { kind: 'tone' }>, base: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = base + step.at;
    const g = this.envelope(at, step.duration, step.gain);
    if (!g) return;
    const osc = ctx.createOscillator();
    osc.type = step.wave;
    osc.frequency.setValueAtTime(step.freq, at);
    if (step.freqEnd !== undefined) osc.frequency.linearRampToValueAtTime(step.freqEnd, at + step.duration);
    osc.connect(g);
    osc.start(at);
    osc.stop(at + step.duration + 0.02);
    this.track(osc);
  }

  private playNoise(step: Extract<CueStep, { kind: 'noise' }>, base: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = base + step.at;
    const g = this.envelope(at, step.duration, step.gain);
    if (!g) return;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoise();
    let tail: NodeLike = src;
    if (step.filterFreq !== undefined) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(step.filterFreq, at);
      src.connect(f);
      tail = f;
    }
    tail.connect(g);
    src.start(at);
    src.stop(at + step.duration + 0.02);
    this.track(src);
  }

  private getNoise(): BufferLike {
    if (this.noiseBuffer) return this.noiseBuffer;
    const ctx = this.ctx as AudioContextLike;
    const length = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  private playBuffer(buf: BufferLike, at: number, reversed: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    let use = buf;
    if (reversed) use = reverseBuffer(ctx, buf);
    const src = ctx.createBufferSource();
    src.buffer = use;
    src.connect(this.master);
    src.start(at);
    this.track(src);
  }

  /**
   * Stand-in for the record message when no sample file exists: a warbling voice-like buffer with a
   * decaying envelope, written then reversed so it swells in and cuts off, like a backwards record.
   */
  private playReversedStandIn(at: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const seconds = 1.8;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const warble = 190 + 40 * Math.sin(2 * Math.PI * 5 * t) + 30 * Math.sin(2 * Math.PI * 1.3 * t);
      const env = Math.exp(-2.2 * t);
      data[i] = 0.2 * env * (Math.sin(2 * Math.PI * warble * t) + 0.3 * (Math.random() * 2 - 1));
    }
    this.playBuffer(buf, at, true);
  }

  private base(): string {
    return this.opts.sampleBase ?? 'audio/voice/';
  }

  private fetcher(): NonNullable<AudioEngineOptions['fetchImpl']> | null {
    return this.opts.fetchImpl ?? (typeof fetch === 'function' ? (u: string) => fetch(u) : null);
  }

  /** Fetches and decodes one file under the voice folder. Failures (404, decode, no fetch) give null, once. */
  private async loadFile(file: string): Promise<BufferLike | null> {
    if (this.samples.has(file)) return this.samples.get(file) ?? null;
    const ctx = this.ctx;
    if (!ctx) return null;
    let result: BufferLike | null = null;
    try {
      const doFetch = this.fetcher();
      if (doFetch) {
        const res = await doFetch(`${this.base()}${file}`);
        if (res.ok) result = await ctx.decodeAudioData(await res.arrayBuffer());
      }
    } catch {
      result = null;
    }
    this.samples.set(file, result);
    return result;
  }

  // ---- spoken lines ----------------------------------------------------------------------------
  private async playVoice(plays: readonly VoicePlay[], delay: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const earliest = ctx.currentTime + delay + 0.1;
    const buffers = await Promise.all(plays.map((p) => {
        const file = this.voice.get(p.id)?.file;
        return file ? this.loadFile(file) : Promise.resolve(null);
      }),
    );
    let cursor = 0;
    for (const [i, p] of plays.entries()) {
      if (this.muted) return;
      try {
        const entry = this.voice.get(p.id);
        const buf = buffers[i] ?? null;
        if (!entry) continue;
        if (!buf) {
          const recipe = p.fallbackCue ? recipeFor(p.fallbackCue) : undefined;
          if (p.fallbackCue && recipe) this.play(p.fallbackCue, recipe, 0);
          continue;
        }
        const at = Math.max(earliest, cursor, ctx.currentTime + 0.02);
        cursor = at + this.playVoiceBuffer(buf, entry, p.reversed, at) + 0.25;
      } catch {
        /* a bad line must not stop the rest */
      }
    }
  }

  /** Plays one decoded line through its effect chain and returns its length in seconds. */
  private playVoiceBuffer(buf: BufferLike, entry: VoiceEntry, reversed: boolean, at: number): number {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return 0;
    const use = reversed ? reverseBuffer(ctx, buf) : buf;
    const seconds = use.duration ?? use.getChannelData(0).length / ctx.sampleRate;
    const src = ctx.createBufferSource();
    src.buffer = use;
    this.applyEffect(entry.effect, src, at, seconds).connect(master);
    src.start(at);
    this.track(src);
    return seconds;
  }

  /**
   * Wires the source through the line's lo-fi effect at runtime (nothing is baked into the files).
   * Returns the node to connect to the master gain.
   */
  private applyEffect(effect: VoiceEntry['effect'], src: SourceLike, at: number, seconds: number): NodeLike {
    switch (effect) {
      case 'tape':
        this.flutter(src, at, seconds, 0.8, 0.012);
        this.hiss(at, seconds, 0.03, 6000);
        return this.chain(src, [this.filter('highpass', 120, at), this.filter('lowpass', 4500, at)]);
      case 'answering_machine':
        return this.chain(src, [this.filter('bandpass', 1400, at, 0.7)]);
      case 'record_reversible':
        this.hiss(at, seconds, 0.02, 3500);
        return this.chain(src, [this.filter('highpass', 80, at), this.filter('lowpass', 7000, at)]);
      case 'camcorder':
        this.flutter(src, at, seconds, 0.4, 0.006);
        this.hiss(at, seconds, 0.04, 4000);
        return this.chain(src, [this.filter('highpass', 200, at), this.filter('lowpass', 5200, at)]);
      default:
        return src;
    }
  }

  private filter(type: string, freq: number, at: number, q?: number): FilterLike {
    const f = (this.ctx as AudioContextLike).createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    if (q !== undefined && f.Q) f.Q.setValueAtTime(q, at);
    return f;
  }

  private chain(input: NodeLike, nodes: readonly NodeLike[]): NodeLike {
    let tail = input;
    for (const n of nodes) {
      tail.connect(n);
      tail = n;
    }
    return tail;
  }

  /** Slow pitch wobble (wow and flutter): a low-frequency oscillator nudging the source's playback rate. */
  private flutter(src: SourceLike, at: number, seconds: number, hz: number, depth: number): void {
    const ctx = this.ctx;
    if (!ctx || !src.playbackRate) return;
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(hz, at);
    const amount = ctx.createGain();
    amount.gain.value = depth;
    lfo.connect(amount);
    amount.connect(src.playbackRate);
    lfo.start(at);
    lfo.stop(at + seconds + 0.1);
    this.track(lfo);
  }

  /** Filtered noise bed under a line, for tape hiss, record crackle or camcorder grain. */
  private hiss(at: number, seconds: number, peak: number, freq: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.envelope(at, seconds, peak);
    if (!g) return;
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoise();
    noise.loop = true;
    this.chain(noise, [this.filter('bandpass', freq, at)]).connect(g);
    noise.start(at);
    noise.stop(at + seconds + 0.02);
    this.track(noise);
  }

  private track(src: SourceLike | OscLike): void {
    this.sources.add(src);
  }
}

function reverseBuffer(ctx: AudioContextLike, buf: BufferLike): BufferLike {
  const src = buf.getChannelData(0);
  const out = ctx.createBuffer(1, src.length, ctx.sampleRate);
  const dst = out.getChannelData(0);
  for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i] ?? 0;
  return out;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
