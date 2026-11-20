// Pure description of every synthesized cue. No Web Audio objects here, so the mapping is easy to test.
// Frequencies are Hz, times are seconds relative to the start of the cue.

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface ToneStep {
  kind: 'tone';
  at: number;
  duration: number;
  freq: number;
  /** Optional glide target for the end of the tone. */
  freqEnd?: number;
  wave: Waveform;
  gain: number;
}

export interface NoiseStep {
  kind: 'noise';
  at: number;
  duration: number;
  gain: number;
  /** Band-pass centre; omit for unfiltered white noise. */
  filterFreq?: number;
}

export type CueStep = ToneStep | NoiseStep;

export interface CueRecipe {
  steps: readonly CueStep[];
  /** Sample (under public/audio/voice) to prefer over the synthesized stand-in, if it exists. */
  sample?: { id: string; reversed: boolean };
}

const tone = (at: number, duration: number, freq: number, wave: Waveform, gain: number, freqEnd?: number): ToneStep =>
  freqEnd === undefined ? { kind: 'tone', at, duration, freq, wave, gain } : { kind: 'tone', at, duration, freq, freqEnd, wave, gain };
const noise = (at: number, duration: number, gain: number, filterFreq?: number): NoiseStep =>
  filterFreq === undefined ? { kind: 'noise', at, duration, gain } : { kind: 'noise', at, duration, gain, filterFreq };

function repeat(n: number, gap: number, make: (at: number) => CueStep[], start = 0): CueStep[] {
  const out: CueStep[] = [];
  for (let i = 0; i < n; i++) out.push(...make(start + i * gap));
  return out;
}

/** Known cue names. Kept as plain strings so this layer never imports the engine. */
export const CUE_RECIPES: Readonly<Record<string, CueRecipe>> = {
  // Rotary dial: a run of short, dry clicks.
  dial_clicks: { steps: repeat(7, 0.09, (t) => [noise(t, 0.025, 0.5, 2500), tone(t, 0.02, 1800, 'square', 0.08)]) },
  // Two double-bursts of ring at 440 + 480.
  phone_ring: {
    steps: repeat(2, 1.0, (t) => [
      ...repeat(2, 0.2, (u) => [tone(u, 0.16, 440, 'sine', 0.18), tone(u, 0.16, 480, 'sine', 0.18)], t),
    ]),
  },
  machine_beep: { steps: [tone(0, 0.5, 1000, 'sine', 0.2)] },
  tape_hiss: { steps: [noise(0, 1.2, 0.12, 6000)] },
  tape_clunk: { steps: [tone(0, 0.12, 140, 'square', 0.25, 60), noise(0, 0.06, 0.25, 800)] },
  vcr_whirr: { steps: [tone(0, 1.0, 90, 'sawtooth', 0.1, 220), noise(0, 1.0, 0.05, 1200)] },
  static_burst: { steps: [noise(0, 0.7, 0.3)] },
  // Cheerful rising chiptune arpeggio.
  nes_chime: {
    steps: [523, 659, 784, 1047].map((f, i) => tone(i * 0.11, 0.1, f, 'square', 0.12)),
  },
  toy_transform: {
    steps: repeat(6, 0.07, (t) => [tone(t, 0.05, 300 + t * 900, 'square', 0.1), noise(t, 0.03, 0.1, 3000)]),
  },
  alarm_buzz: {
    steps: repeat(4, 0.3, (t) => [tone(t, 0.25, 800, 'square', 0.18, 600)]),
  },
  // Backwards-record stand-in: the synth engine renders this one reversed (see AudioEngine).
  record_reversed: {
    steps: [tone(0, 1.8, 220, 'sawtooth', 0.12, 120), noise(0, 1.8, 0.06, 1500)],
    sample: { id: 'study_record_clear', reversed: false },
  },
  // Soft voice-like murmur; real voice samples are layered in by the voice map when present.
  dad_voice: { steps: [tone(0, 1.2, 160, 'triangle', 0.08, 190), noise(0, 1.2, 0.05, 900)] },
};

/** Looks up a recipe; unknown cues return undefined so callers can ignore them safely. */
export function recipeFor(cue: string): CueRecipe | undefined {
  return Object.prototype.hasOwnProperty.call(CUE_RECIPES, cue) ? CUE_RECIPES[cue] : undefined;
}

/** Extracts the cue names from a turn's events, ignoring everything that is not a SOUND event. */
export function cuesFromEvents(events: readonly { type: string; cue?: unknown }[]): string[] {
  const out: string[] = [];
  for (const e of events) if (e.type === 'SOUND' && typeof e.cue === 'string') out.push(e.cue);
  return out;
}

/** Total length of a recipe in seconds. */
export function recipeLength(recipe: CueRecipe): number {
  return recipe.steps.reduce((max, s) => Math.max(max, s.at + s.duration), 0);
}
