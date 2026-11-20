// Task 17.4: spoken lines. Pure data and mapping, no Web Audio and no DOM, so it is easy to test.
// The engine never imports this. It only sees the events the engine already emits (SOUND cues and
// MESSAGE ids), so the voice layer stays optional.

export const VOICE_EFFECTS = ['tape', 'answering_machine', 'record_reversible', 'camcorder'] as const;
export type VoiceEffect = (typeof VOICE_EFFECTS)[number];

export interface VoiceEntry {
  id: string;
  file: string;
  caption: string;
  effect: VoiceEffect | 'clean';
  speaker: string;
}

/** Lookup by line id. A Map, so ids like "constructor" can never hit the prototype. */
export type VoiceIndex = ReadonlyMap<string, VoiceEntry>;

export const EMPTY_VOICE_INDEX: VoiceIndex = new Map();

const FILE_PATTERN = /^[A-Za-z0-9_.-]+\.mp3$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates index.json at the boundary. Anything that is not an object gives an empty index. Entries
 * with a bad file name or an empty caption are dropped; an unknown effect plays clean.
 */
export function parseVoiceIndex(raw: unknown): VoiceIndex {
  if (!isRecord(raw)) return EMPTY_VOICE_INDEX;
  const out = new Map<string, VoiceEntry>();
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const { file, caption, effect, speaker } = value;
    if (typeof file !== 'string' || !FILE_PATTERN.test(file)) continue;
    if (typeof caption !== 'string' || caption.trim() === '') continue;
    const known = VOICE_EFFECTS.find((e) => e === effect);
    out.set(id, {
      id,
      file,
      caption: caption.trim(),
      effect: known ?? 'clean',
      speaker: typeof speaker === 'string' ? speaker : '',
    });
  }
  return out;
}

/** The slice of fetch the voice layer needs. */
export type VoiceFetch = (url: string) => Promise<{
  ok: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  json?(): Promise<unknown>;
}>;

/** Loads index.json. Missing, 404, network failure or bad JSON all give an empty index. Never throws. */
export async function loadVoiceIndex(fetchImpl: VoiceFetch | null, base: string): Promise<VoiceIndex> {
  try {
    if (!fetchImpl) return EMPTY_VOICE_INDEX;
    const res = await fetchImpl(`${base}index.json`);
    if (!res.ok || typeof res.json !== 'function') return EMPTY_VOICE_INDEX;
    return parseVoiceIndex(await res.json());
  } catch {
    return EMPTY_VOICE_INDEX;
  }
}

// ---- event -> line mapping ---------------------------------------------------------------------

export interface VoicePlay {
  id: string;
  /** Play the stored (clear) audio backwards. True only for the forward-play gibberish step. */
  reversed: boolean;
  /** Synthesized cue this line replaces; used as the stand-in if the sample cannot be played. */
  fallbackCue?: string;
  /** False when the index caption would misdescribe the moment and the engine's own caption is better. */
  showCaption: boolean;
}

const play = (id: string, extra: Partial<Omit<VoicePlay, 'id'>> = {}): VoicePlay => ({
  id,
  reversed: false,
  showCaption: true,
  ...extra,
});

const VIDEO_LINES = ['video_grandpa_narration', 'video_young_dad_reaction', 'video_young_dad_whisper'] as const;

/** MESSAGE ids the engine emits, mapped to the voice lines that accompany them. */
function playsForMessage(id: string): VoicePlay[] {
  switch (id) {
    case 'basement:dad_tape':
      return [play('basement_tape_dad', { fallbackCue: 'dad_voice' })];
    case 'hallway:dial_correct':
      return [play('hallway_message_young_dad')];
    case 'hallway:dial_grandma':
      return [play('hallway_greeting_grandma')];
    // Forward play is the gibberish step: same recording, played backwards, with no caption claiming it is a voice.
    case 'study:forward':
    case 'study:forward_again':
      return [play('study_record_clear', { reversed: true, showCaption: false })];
    case 'study:reversed':
    case 'study:reversed_again':
      return [play('study_record_clear', { fallbackCue: 'record_reversed' })];
    case 'grandparentsBedroom:video':
      return [...VIDEO_LINES.map((v) => play(v)), play('video_adult_dad_final', { fallbackCue: 'dad_voice' })];
    case 'grandparentsBedroom:video_again':
      return VIDEO_LINES.map((v) => play(v));
    default:
      return [];
  }
}

/** Voice lines for one turn's events, in order. Unknown events are ignored. */
export function voiceLinesForEvents(events: readonly { type: string; id?: unknown }[]): VoicePlay[] {
  const out: VoicePlay[] = [];
  for (const e of events) {
    if (e.type === 'MESSAGE' && typeof e.id === 'string') out.push(...playsForMessage(e.id));
  }
  return out;
}

/**
 * Captions for the turn's voice lines that exist in the index. This never depends on audio, the mute
 * preference or sample loading, so captions always appear.
 */
export function voiceCaptions(events: readonly { type: string; id?: unknown }[], index: VoiceIndex): string[] {
  const out: string[] = [];
  for (const p of voiceLinesForEvents(events)) {
    if (!p.showCaption) continue;
    const entry = index.get(p.id);
    if (entry && !out.includes(entry.caption)) out.push(entry.caption);
  }
  return out;
}
