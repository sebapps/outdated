import { describe, expect, it } from 'vitest';
import { AudioEngine, type AudioContextLike } from './audio';
import { CUE_RECIPES, cuesFromEvents, recipeFor } from './cues';

const ENGINE_CUES = [
  'dial_clicks', 'phone_ring', 'machine_beep', 'tape_hiss', 'tape_clunk', 'vcr_whirr',
  'static_burst', 'nes_chime', 'toy_transform', 'alarm_buzz', 'record_reversed', 'dad_voice',
];

function fakeContext(counts: { osc: number; src: number }, state = 'running'): AudioContextLike {
  const param = () => ({ value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined });
  const node = () => ({ connect: () => undefined });
  return {
    currentTime: 0,
    sampleRate: 8000,
    state,
    destination: {},
    resume: () => Promise.resolve(),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param() }),
    createOscillator: () => {
      counts.osc++;
      return { ...node(), type: '', frequency: param(), start: () => undefined, stop: () => undefined };
    },
    createBuffer: (_c, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      counts.src++;
      return { ...node(), buffer: null, start: () => undefined, stop: () => undefined };
    },
    decodeAudioData: () => Promise.reject(new Error('no sample')),
  };
}

describe('cue mapping', () => {
  it('has a recipe for every engine cue', () => {
    for (const cue of ENGINE_CUES) expect(recipeFor(cue), cue).toBeDefined();
    expect(Object.keys(CUE_RECIPES).sort()).toEqual([...ENGINE_CUES].sort());
  });

  it('returns undefined for unknown cues, including prototype names', () => {
    expect(recipeFor('nope')).toBeUndefined();
    expect(recipeFor('constructor')).toBeUndefined();
  });

  it('extracts only SOUND cues', () => {
    expect(cuesFromEvents([{ type: 'MESSAGE' }, { type: 'SOUND', cue: 'tape_hiss' }, { type: 'SOUND' }])).toEqual(['tape_hiss']);
  });
});

describe('AudioEngine', () => {
  const ev = [{ type: 'SOUND', cue: 'machine_beep' }];

  it('plays nothing when muted', () => {
    const counts = { osc: 0, src: 0 };
    const a = new AudioEngine({ isMuted: () => true, createContext: () => fakeContext(counts) });
    a.unlock();
    a.handleEvents(ev);
    expect(counts.osc + counts.src).toBe(0);
  });

  it('plays synthesized sound when unmuted', () => {
    const counts = { osc: 0, src: 0 };
    const a = new AudioEngine({ isMuted: () => false, createContext: () => fakeContext(counts) });
    a.unlock();
    a.handleEvents(ev);
    expect(counts.osc).toBe(1);
  });

  it('respects a mute change between turns', () => {
    const counts = { osc: 0, src: 0 };
    let muted = false;
    const a = new AudioEngine({ isMuted: () => muted, createContext: () => fakeContext(counts) });
    a.unlock();
    muted = true;
    a.setMuted(true);
    a.handleEvents(ev);
    expect(counts.osc).toBe(0);
  });

  it('never throws when the context is missing or broken', () => {
    const none = new AudioEngine({ isMuted: () => false, createContext: () => null });
    expect(() => { none.unlock(); none.handleEvents(ev); none.setMuted(true); }).not.toThrow();
    const broken = new AudioEngine({ isMuted: () => false, createContext: () => { throw new Error('boom'); } });
    expect(() => { broken.unlock(); broken.handleEvents(ev); }).not.toThrow();
  });

  it('falls back to a reversed stand-in when the record sample is missing', async () => {
    const counts = { osc: 0, src: 0 };
    const a = new AudioEngine({
      isMuted: () => false,
      createContext: () => fakeContext(counts),
      fetchImpl: () => Promise.resolve({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
    });
    a.unlock();
    a.handleEvents([{ type: 'SOUND', cue: 'record_reversed' }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(counts.src).toBe(1);
  });
});
