import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { content } from '../engine/content';
import type { EngineEvent } from '../engine/state';
import { CannedNarrator, type NarratorProvider } from './canned';
import { nextWarmth, renderEvents, renderSilenceBeat, SILENCE_PAUSE_MS } from './render';

const canned = new CannedNarrator(content);
const beat: EngineEvent = { type: 'SILENCE_BEAT' };

describe('silence beats', () => {
  it('bypass the narrator provider entirely', async () => {
    const calls: EngineEvent[] = [];
    const spy: NarratorProvider = { narrate: async (e) => (calls.push(e), 'JOKE') };
    const { lines } = await renderEvents([beat], { warmth: 2, variant: 0 }, spy, canned);
    expect(calls).toHaveLength(0);
    expect(lines[0]).toEqual({ kind: 'pause', ms: SILENCE_PAUSE_MS });
    expect(lines.some((l) => l.kind === 'text' && l.text === 'JOKE')).toBe(false);
  });

  it('render a pause plus at most one short sincere line at every warmth', () => {
    for (const warmth of [0, 1, 2, 3, 4]) {
      const lines = renderSilenceBeat(canned, { warmth, variant: 0 });
      expect(lines[0]?.kind).toBe('pause');
      expect(lines.length).toBeLessThanOrEqual(2);
    }
  });

  it('uses the sincere warmth 4 line after the video (warmth change precedes the beat)', async () => {
    const events: EngineEvent[] = [{ type: 'WARMTH_CHANGED', level: 4 }, beat];
    const { lines, warmth } = await renderEvents(events, { warmth: 3, variant: 0 }, canned, canned);
    expect(warmth).toBe(4);
    expect(lines).toEqual([
      { kind: 'pause', ms: SILENCE_PAUSE_MS },
      { kind: 'text', text: 'Some things you only understand in the dark.' },
    ]);
  });
});

describe('warmth transitions', () => {
  it('rises on WARMTH_CHANGED and ignores a lower level', () => {
    expect(nextWarmth(1, { type: 'WARMTH_CHANGED', level: 2 })).toBe(2);
    expect(nextWarmth(3, { type: 'WARMTH_CHANGED', level: 1 })).toBe(3);
    expect(nextWarmth(3, beat)).toBe(3);
  });

  it('never decreases over arbitrary event sequences', async () => {
    const ev = fc.oneof(
      fc.integer({ min: -2, max: 6 }).map((level): EngineEvent => ({ type: 'WARMTH_CHANGED', level })),
      fc.constant<EngineEvent>(beat),
    );
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 4 }), fc.array(ev, { maxLength: 12 }), async (start, events) => {
        const { warmth } = await renderEvents(events, { warmth: start, variant: 0 }, canned, canned);
        expect(warmth).toBeGreaterThanOrEqual(start);
        expect(warmth).toBeLessThanOrEqual(4);
      }),
    );
  });
});
