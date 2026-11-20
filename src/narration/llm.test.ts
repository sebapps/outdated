import { describe, expect, it } from 'vitest';
import { LlmNarrator, validateNarration } from './llm';

const event = { type: 'MESSAGE', id: 'x' } as const;
const ctx = { warmth: 2, variant: 0 };
const fallback = { narrate: async () => 'canned line.' };
const make = (complete: (r: never) => Promise<string>, timeoutMs = 50) =>
  new LlmNarrator({ complete: complete as never, fallback, timeoutMs });

describe('validateNarration', () => {
  it('accepts short plain text', () => {
    expect(validateNarration('  The dust settles. Nothing stirs.  ')).toBe('The dust settles. Nothing stirs.');
  });
  it.each([
    ['empty', '   '],
    ['too long', 'a'.repeat(400)],
    ['too many sentences', 'One. Two. Three. Four.'],
    ['lyrics marker', '♪ la la la'],
    ['state claim', 'You pick up the key.'],
    ['solution reveal', 'The code is 1984.'],
    ['real name', 'Madonna would approve.'],
  ])('rejects %s', (_n, text) => {
    expect(validateNarration(text)).toBeUndefined();
  });
  it('rejects non-strings', () => {
    expect(validateNarration(42)).toBeUndefined();
  });
});

describe('LlmNarrator', () => {
  it('returns valid LLM output', async () => {
    expect(await make(async () => 'A quiet hum fills the room.').narrate(event, ctx)).toBe('A quiet hum fills the room.');
  });
  it('falls back on timeout', async () => {
    const n = make(() => new Promise<string>(() => {}));
    expect(await n.narrate(event, ctx)).toBe('canned line.');
  });
  it('falls back on error', async () => {
    expect(await make(async () => { throw new Error('boom'); }).narrate(event, ctx)).toBe('canned line.');
  });
  it('falls back on invalid output', async () => {
    expect(await make(async () => 'The code is 1984.').narrate(event, ctx)).toBe('canned line.');
  });
});
