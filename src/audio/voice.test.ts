import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { takeTurn, newGame, withVoiceCaptions, type UiLine } from '../ui/session';
import type { GameState } from '../engine/state';
import { AudioEngine, type AudioContextLike } from './audio';
import { parseVoiceIndex, loadVoiceIndex, voiceCaptions, voiceLinesForEvents } from './voice';

const realIndex: unknown = JSON.parse(readFileSync('public/audio/voice/index.json', 'utf8'));

interface Walkthrough {
  segments: { commands: string[] }[];
}
const walkthrough = JSON.parse(readFileSync('content/walkthrough.json', 'utf8')) as Walkthrough;
const commands = walkthrough.segments.flatMap((s) => s.commands);

type Res = { ok: boolean; arrayBuffer(): Promise<ArrayBuffer>; json?(): Promise<unknown> };
const notFound: Res = { ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
const fetch404 = (): Promise<Res> => Promise.resolve(notFound);
/** Serves index.json but 404s every audio file. */
const fetchIndexOnly = (url: string): Promise<Res> =>
  url.endsWith('index.json')
    ? Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), json: () => Promise.resolve(realIndex) })
    : Promise.resolve(notFound);

interface Recorder {
  filters: string[];
  buffers: Float32Array[];
}

/** Fake context. decodeAudioData yields a 4-sample ramp so reversal is observable. */
function fakeContext(rec: Recorder, decode: boolean): AudioContextLike {
  const param = () => ({ value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined });
  const node = () => ({ connect: () => undefined });
  return {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running',
    destination: {},
    resume: () => Promise.resolve(),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => {
      const f = { ...node(), type: '', frequency: param(), Q: param() };
      rec.filters.push('');
      return new Proxy(f, {
        set(target, key, value: unknown) {
          if (key === 'type' && typeof value === 'string') rec.filters[rec.filters.length - 1] = value;
          (target as Record<PropertyKey, unknown>)[key] = value;
          return true;
        },
      });
    },
    createOscillator: () => ({ ...node(), type: '', frequency: param(), start: () => undefined, stop: () => undefined }),
    createBuffer: (_c, length) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource: () => {
      const s = {
        ...node(),
        playbackRate: param(),
        loop: false,
        start: () => undefined,
        stop: () => undefined,
        set buffer(b: unknown) {
          const data = (b as { getChannelData(n: number): Float32Array }).getChannelData(0);
          if (data.length === 4) rec.buffers.push(data);
        },
      };
      return s as unknown as ReturnType<AudioContextLike['createBufferSource']>;
    },
    decodeAudioData: () =>
      decode
        ? Promise.resolve(
            (() => {
              const data = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
              return { getChannelData: () => data };
            })(),
          )
        : Promise.reject(new Error('decode failed')),
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 15));

describe('parseVoiceIndex', () => {
  it('parses the real index.json', () => {
    const idx = parseVoiceIndex(realIndex);
    expect(idx.size).toBe(8);
    expect(idx.get('study_record_clear')?.effect).toBe('record_reversible');
    expect(idx.get('hallway_message_young_dad')?.caption).toBe("[Answering machine: a boy's voice]");
  });

  it('gives an empty index for non-objects', () => {
    for (const bad of [null, undefined, 42, 'x', [], [1, 2]]) expect(parseVoiceIndex(bad).size).toBe(0);
  });

  it('drops malformed entries and keeps good ones', () => {
    const idx = parseVoiceIndex({
      good: { file: 'a.mp3', caption: '[x]', effect: 'tape', speaker: 's' },
      noFile: { caption: '[x]', effect: 'tape' },
      traversal: { file: '../a.mp3', caption: '[x]', effect: 'tape' },
      noCaption: { file: 'b.mp3', caption: '  ', effect: 'tape' },
      notObject: 7,
      strangeEffect: { file: 'c.mp3', caption: '[c]', effect: 'echo' },
    });
    expect([...idx.keys()].sort()).toEqual(['good', 'strangeEffect']);
    expect(idx.get('strangeEffect')?.effect).toBe('clean');
  });

  it('loadVoiceIndex survives 404, thrown fetch, no fetch and bad JSON', async () => {
    expect((await loadVoiceIndex(fetch404, 'x/')).size).toBe(0);
    expect((await loadVoiceIndex(() => Promise.reject(new Error('offline')), 'x/')).size).toBe(0);
    expect((await loadVoiceIndex(null, 'x/')).size).toBe(0);
    const badJson = (): Promise<Res> =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), json: () => Promise.reject(new SyntaxError('bad')) });
    expect((await loadVoiceIndex(badJson, 'x/')).size).toBe(0);
    expect((await loadVoiceIndex(fetchIndexOnly, 'x/')).size).toBe(8);
  });
});

describe('event to voice line mapping', () => {
  const ids = (id: string) => voiceLinesForEvents([{ type: 'MESSAGE', id }]).map((p) => p.id);

  it('maps each moment to its lines', () => {
    expect(ids('basement:dad_tape')).toEqual(['basement_tape_dad']);
    expect(ids('hallway:dial_correct')).toEqual(['hallway_message_young_dad']);
    expect(ids('hallway:dial_grandma')).toEqual(['hallway_greeting_grandma']);
    expect(ids('grandparentsBedroom:video')).toEqual([
      'video_grandpa_narration', 'video_young_dad_reaction', 'video_young_dad_whisper', 'video_adult_dad_final',
    ]);
    expect(ids('hallway:dial_busy')).toEqual([]);
  });

  it('plays the record backwards going forward and normally once reversed', () => {
    for (const id of ['study:forward', 'study:forward_again']) {
      expect(voiceLinesForEvents([{ type: 'MESSAGE', id }])).toMatchObject([{ id: 'study_record_clear', reversed: true }]);
    }
    for (const id of ['study:reversed', 'study:reversed_again']) {
      expect(voiceLinesForEvents([{ type: 'MESSAGE', id }])).toMatchObject([{ id: 'study_record_clear', reversed: false }]);
    }
  });

  it('only captions lines that exist in the index, and not the gibberish step', () => {
    const idx = parseVoiceIndex(realIndex);
    expect(voiceCaptions([{ type: 'MESSAGE', id: 'study:forward' }], idx)).toEqual([]);
    expect(voiceCaptions([{ type: 'MESSAGE', id: 'study:reversed' }], idx)).toEqual(["[A boy's voice, playing backwards]"]);
    expect(voiceCaptions([{ type: 'MESSAGE', id: 'study:reversed' }], parseVoiceIndex(null))).toEqual([]);
  });
});

describe('captions and effects in the engine', () => {
  const reversedEvents = [{ type: 'MESSAGE', id: 'study:reversed' }];
  const forwardEvents = [{ type: 'MESSAGE', id: 'study:forward' }];

  async function engine(opts: { muted: boolean; decode: boolean; rec: Recorder }): Promise<AudioEngine> {
    const a = new AudioEngine({
      isMuted: () => opts.muted,
      createContext: () => fakeContext(opts.rec, opts.decode),
      fetchImpl: (url) =>
        url.endsWith('index.json')
          ? fetchIndexOnly(url)
          : Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    });
    await a.loadVoiceIndex();
    a.unlock();
    return a;
  }

  it('emits the caption when muted, with no audio played', async () => {
    const rec: Recorder = { filters: [], buffers: [] };
    const a = await engine({ muted: true, decode: true, rec });
    a.handleEvents(reversedEvents);
    await tick();
    expect(a.captionsFor(reversedEvents)).toEqual(["[A boy's voice, playing backwards]"]);
    expect(rec.buffers).toHaveLength(0);
  });

  it('emits the caption when the sample fails to decode', async () => {
    const rec: Recorder = { filters: [], buffers: [] };
    const a = await engine({ muted: false, decode: false, rec });
    expect(() => a.handleEvents(reversedEvents)).not.toThrow();
    await tick();
    expect(a.captionsFor(reversedEvents)).toHaveLength(1);
  });

  it('reverses the buffer for the forward step only', async () => {
    const fwd: Recorder = { filters: [], buffers: [] };
    (await engine({ muted: false, decode: true, rec: fwd })).handleEvents(forwardEvents);
    await tick();
    expect(Array.from(fwd.buffers[0] ?? [])).toEqual([0.4, 0.3, 0.2, 0.1].map((n) => Math.fround(n)));

    const rev: Recorder = { filters: [], buffers: [] };
    (await engine({ muted: false, decode: true, rec: rev })).handleEvents(reversedEvents);
    await tick();
    expect(Array.from(rev.buffers[0] ?? [])).toEqual([0.1, 0.2, 0.3, 0.4].map((n) => Math.fround(n)));
  });

  it('applies a band-pass for the answering machine and a low-pass for tape', async () => {
    const machine: Recorder = { filters: [], buffers: [] };
    (await engine({ muted: false, decode: true, rec: machine })).handleEvents([{ type: 'MESSAGE', id: 'hallway:dial_correct' }]);
    await tick();
    expect(machine.filters).toContain('bandpass');

    const tape: Recorder = { filters: [], buffers: [] };
    (await engine({ muted: false, decode: true, rec: tape })).handleEvents([{ type: 'MESSAGE', id: 'basement:dad_tape' }]);
    await tick();
    expect(tape.filters).toContain('lowpass');
    expect(tape.filters).toContain('highpass');
  });
});

describe('withVoiceCaptions', () => {
  it('inserts after sound captions, before narration, without duplicating', () => {
    const lines: UiLine[] = [
      { kind: 'caption', text: '[[a phone rings]]' },
      { kind: 'text', text: 'You listen.' },
    ];
    const out = withVoiceCaptions(lines, ['[a phone rings]', "[Answering machine: a boy's voice]"]);
    expect(out.map((l) => (l.kind === 'pause' ? '' : l.text))).toEqual([
      '[[a phone rings]]', "[Answering machine: a boy's voice]", 'You listen.',
    ]);
  });
});

describe('game with no audio files present', () => {
  async function playThrough(muted: boolean, fetchImpl: (u: string) => Promise<Res>): Promise<{ text: string[]; ended: boolean }> {
    const rec: Recorder = { filters: [], buffers: [] };
    const audio = new AudioEngine({ isMuted: () => muted, createContext: () => fakeContext(rec, false), fetchImpl });
    await audio.loadVoiceIndex();
    audio.unlock();
    let state: GameState = newGame();
    const text: string[] = [];
    let ended = false;
    for (const cmd of commands) {
      const turn = await takeTurn(state, cmd);
      state = turn.state;
      audio.handleEvents(turn.events);
      for (const l of withVoiceCaptions(turn.lines, audio.captionsFor(turn.events))) {
        if (l.kind === 'caption') text.push(l.text);
      }
      ended = turn.ended;
    }
    await tick();
    return { text, ended };
  }

  it('plays to the ending with every fetch 404ing, captions still shown', async () => {
    const r = await playThrough(false, fetch404);
    expect(r.ended).toBe(true);
    expect(r.text.some((t) => t.includes('rotary dial clicks'))).toBe(true);
    expect(r.text.some((t) => t.includes("Dad's voice, over the static"))).toBe(true);
  });

  it('plays to the ending with a throwing fetch', async () => {
    const r = await playThrough(false, () => Promise.reject(new Error('offline')));
    expect(r.ended).toBe(true);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('shows the index captions when only the audio files are missing, even muted', async () => {
    const r = await playThrough(true, fetchIndexOnly);
    expect(r.ended).toBe(true);
    expect(r.text).toContain("[Answering machine: a boy's voice]");
    expect(r.text).toContain('[Home video: a boy whispering]');
    expect(r.text).toContain("[Dad's voice, over the static]");
  });
});
