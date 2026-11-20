import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ContentError, loadContent, type RawContent } from './loader';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../content/${name}.json`, import.meta.url), 'utf8'));

const fresh = (): RawContent => ({
  rooms: read('rooms'),
  items: read('items'),
  verbs: read('verbs'),
  hints: read('hints'),
  narration: read('narration'),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function problemsFor(mutate: (raw: Any) => void): string[] {
  const raw = fresh();
  mutate(raw);
  try {
    loadContent(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ContentError);
    return (e as ContentError).problems;
  }
  return [];
}

describe('content loader', () => {
  it('accepts the shipped content', () => {
    const c = loadContent(fresh());
    expect(Object.keys(c.rooms)).toHaveLength(6);
    expect(c.items.pencil?.takeable).toBe(true);
    expect(c.verbLookup['spin backwards']).toBe('REVERSE');
    expect(c.nounLookup['walkman']).toEqual(['walkman']);
  });

  it('fails on a room that lists an unknown item', () => {
    const p = problemsFor((r) => r.rooms.rooms[0].items.push('ghost'));
    expect(p.some((m) => m.includes('unknown item "ghost"'))).toBe(true);
  });

  it('fails on an exit that requires a missing key', () => {
    const p = problemsFor((r) => (r.rooms.rooms[0].exits[0].requiresKey = 'noKey'));
    expect(p.some((m) => m.includes('unknown key "noKey"'))).toBe(true);
  });

  it('fails when a key opens a different room than its door', () => {
    const p = problemsFor((r) => (r.rooms.rooms[0].exits[0].requiresKey = 'bedroomKey'));
    expect(p.some((m) => m.includes('opens "boyhoodBedroom"'))).toBe(true);
  });

  it('fails on an item inside an unknown container', () => {
    const p = problemsFor((r) => (r.items.items.find((i: Any) => i.id === 'hallwayKey').inside = 'nothing'));
    expect(p.some((m) => m.includes('unknown item "nothing"'))).toBe(true);
  });

  it('fails on a missing hint puzzle and on wrong tier count', () => {
    expect(problemsFor((r) => r.hints.hints.pop()).some((m) => m.includes('missing hints'))).toBe(true);
    expect(problemsFor((r) => r.hints.hints[0].tiers.pop()).length).toBeGreaterThan(0);
  });

  it('fails when a hint entry has no solved line', () => {
    expect(problemsFor((r) => { delete (r.hints.hints[0] as { solved?: string }).solved; }).length).toBeGreaterThan(0);
  });

  it('fails on a synonym claimed by two verbs', () => {
    const p = problemsFor((r) => r.verbs.verbs[0].synonyms.push('grab'));
    expect(p.some((m) => m.includes('"grab" maps to both'))).toBe(true);
  });

  it('fails when a warmth level has no generic narration', () => {
    const p = problemsFor((r) => {
      r.narration.narration = r.narration.narration.filter((l: Any) => !(l.key === 'cant_do' && l.warmth === 3));
    });
    expect(p.some((m) => m.includes('"cant_do" has no lines for warmth 3'))).toBe(true);
  });

  it('reports every problem at once, not just the first', () => {
    const p = problemsFor((r) => {
      r.rooms.rooms[0].items.push('ghost');
      r.hints.hints.pop();
    });
    expect(p.length).toBeGreaterThanOrEqual(2);
  });

  it('fails loudly on a schema violation', () => {
    const p = problemsFor((r) => delete r.rooms.rooms[0].description);
    expect(p.some((m) => m.startsWith('rooms.json'))).toBe(true);
  });
});
