import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { content } from '../engine/content';
import { GENERIC_NARRATION_KEYS } from '../engine/content/types';
import { CannedNarrator } from './canned';

const narrator = new CannedNarrator(content);
const msg = (id: string) => ({ type: 'MESSAGE', id }) as const;

describe('CannedNarrator', () => {
  it('has at least 8 distinct variants per generic key per warmth level', () => {
    for (const key of GENERIC_NARRATION_KEYS) {
      for (const w of [0, 1, 2, 3, 4]) {
        const line = content.narration.find((l) => l.key === key && l.warmth === w);
        expect(line, `${key}@${w}`).toBeDefined();
        expect(new Set(line!.variants).size, `${key}@${w}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('keeps routine failure lines to three sentences or fewer, with no digits-as-names or lyrics markers', () => {
    for (const key of GENERIC_NARRATION_KEYS) {
      for (const l of content.narration.filter((n) => n.key === key)) {
        for (const v of l.variants) {
          expect((v.match(/[.!?]+(\s|$)/g) ?? []).length).toBeLessThanOrEqual(3);
          expect(v).not.toMatch(/♪|lyrics/i);
        }
      }
    }
  });

  it('cycles through all 8 variants over consecutive counters', async () => {
    const seen = new Set<string>();
    for (let c = 0; c < 8; c++) seen.add(await narrator.narrate(msg('cant_do'), { warmth: 2, variant: c }));
    expect(seen.size).toBe(8);
  });

  it('is deterministic and never repeats back to back', async () => {
    for (const key of GENERIC_NARRATION_KEYS) {
      for (let c = 0; c < 20; c++) {
        const a = await narrator.narrate(msg(key), { warmth: 1, variant: c });
        expect(a).toBe(await narrator.narrate(msg(key), { warmth: 1, variant: c }));
        expect(a).not.toBe(await narrator.narrate(msg(key), { warmth: 1, variant: c + 1 }));
      }
    }
  });

  it('answers from the requested warmth level', async () => {
    const line = content.narration.find((l) => l.key === 'unknown_verb' && l.warmth === 3)!;
    const out = await narrator.narrate(msg('unknown_verb'), { warmth: 3, variant: 5 });
    expect(line.variants).toContain(out);
  });

  it('serves event-keyed lines and returns empty string when nothing matches', async () => {
    expect(await narrator.narrate({ type: 'ENDING' }, { warmth: 4, variant: 0 })).toBe('The alarm goes off.');
    expect(await narrator.narrate(msg('no_such_id'), { warmth: 0, variant: 0 })).toBe('');
  });

  it('property: always returns a line from the matching bank for any counter and warmth', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...GENERIC_NARRATION_KEYS),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 100000 }),
        async (key, warmth, variant) => {
          const bank = content.narration.find((l) => l.key === key && l.warmth === warmth)!.variants;
          expect(bank).toContain(await narrator.narrate(msg(key), { warmth, variant }));
        },
      ),
    );
  });
});
