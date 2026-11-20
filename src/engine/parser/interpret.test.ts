import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { interpret } from './interpret';

describe('interpret', () => {
  it('resolves a unique noun', () => {
    const r = interpret('take the pencil', content);
    expect(r).toMatchObject({ ok: true, direct: 'pencil' });
  });

  it('returns an in-character UNKNOWN_VERB event with suggestions', () => {
    const r = interpret('xyzzy', content);
    expect(r.ok).toBe(false);
    if (!r.ok && r.event.type === 'UNKNOWN_VERB') {
      expect(r.event.suggestions).toContain('LOOK');
      expect(r.event.text).toContain('LOOK');
      expect(r.event.text.toLowerCase()).not.toContain('error');
    } else throw new Error('expected UNKNOWN_VERB');
  });

  it('returns UNKNOWN_NOUN that suggests reachable things', () => {
    const r = interpret('take unicorn', content, { inScope: (id) => id === 'pencil' });
    expect(r.ok).toBe(false);
    if (!r.ok && r.event.type === 'UNKNOWN_NOUN') {
      expect(r.event.phrase).toBe('unicorn');
      expect(r.event.suggestions).toEqual(['pencil']);
    } else throw new Error('expected UNKNOWN_NOUN');
  });

  it('asks one short question when several in-scope items match', () => {
    const r = interpret('take key', content, { inScope: (id) => id === 'hallwayKey' || id === 'bedroomKey' });
    expect(r.ok).toBe(false);
    if (!r.ok && r.event.type === 'AMBIGUOUS') {
      expect(r.event.candidates.sort()).toEqual(['bedroomKey', 'hallwayKey']);
      expect(r.event.question.match(/\?/g)).toHaveLength(1);
    } else throw new Error('expected AMBIGUOUS');
  });

  it('scope disambiguates an otherwise ambiguous noun', () => {
    const r = interpret('take key', content, { inScope: (id) => id === 'hallwayKey' });
    expect(r).toMatchObject({ ok: true, direct: 'hallwayKey' });
  });

  it('leaves free-form objects such as phone numbers alone', () => {
    expect(interpret('dial 555-0142', content)).toMatchObject({ ok: true });
  });

  it('never throws on odd input and returns empty-input event', () => {
    expect(interpret('   ', content)).toMatchObject({ ok: false, event: { type: 'EMPTY_INPUT' } });
    expect(() => interpret(undefined as unknown as string, content)).not.toThrow();
    expect(() => interpret('\u0000 ?? !!', content)).not.toThrow();
  });
});
