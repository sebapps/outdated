import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { normalizeText, parse, resolveNoun } from './parser';

const cmd = (s: string) => {
  const r = parse(s, content);
  if (!r.ok) throw new Error(`parse failed: ${s} (${r.reason})`);
  return r.command;
};

describe('normalizeText', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeText('  Dial 555-0142!! ')).toBe('dial 5550142');
    expect(normalizeText("Rubik's   Cube.")).toBe('rubiks cube');
  });
});

describe('parse', () => {
  it('maps verb synonyms to the canonical verb', () => {
    expect(cmd('spin backwards record').verb).toBe('REVERSE');
    expect(cmd('Turn counterclockwise record').verb).toBe('REVERSE');
    expect(cmd('rotate backward record').verb).toBe('REVERSE');
    expect(cmd('look at pager')).toEqual({ verb: 'EXAMINE', directObject: 'pager' });
    expect(cmd('fix tracking').verb).toBe('ADJUST');
    expect(cmd('l')).toEqual({ verb: 'LOOK' });
    expect(cmd('?')).toEqual({ verb: 'HELP' });
  });

  it('drops filler words and leading locatives', () => {
    expect(cmd('take the pencil')).toEqual({ verb: 'TAKE', directObject: 'pencil' });
    expect(cmd('search under the foam')).toEqual({ verb: 'SEARCH', directObject: 'foam' });
    expect(cmd('go through door')).toEqual({ verb: 'GO', directObject: 'door' });
  });

  it('parses two-object commands on prepositions', () => {
    expect(cmd('rewind the tape with a pencil')).toEqual({
      verb: 'REWIND', directObject: 'tape', indirectObject: 'pencil',
    });
    expect(cmd('insert cassette into walkman')).toEqual({
      verb: 'INSERT', directObject: 'cassette', indirectObject: 'walkman',
    });
    expect(cmd('use pencil on tape')).toEqual({ verb: 'USE', directObject: 'pencil', indirectObject: 'tape' });
  });

  it('handles single-object forms of verbs and multi-word verbs', () => {
    expect(cmd('insert cartridge')).toEqual({ verb: 'INSERT', directObject: 'cartridge' });
    expect(cmd('blow on cartridge')).toEqual({ verb: 'BLOW', directObject: 'cartridge' });
    expect(cmd('plug in turntable')).toEqual({ verb: 'PLUG', directObject: 'turntable' });
    expect(cmd('dial 555-0142')).toEqual({ verb: 'DIAL', directObject: '5550142' });
    expect(cmd('fix tape')).toEqual({ verb: 'REWIND', directObject: 'tape' });
  });

  it('reports empty and unknown input without throwing', () => {
    expect(parse('   ', content)).toMatchObject({ ok: false, reason: 'empty' });
    expect(parse('xyzzy', content)).toMatchObject({ ok: false, reason: 'unknown_verb' });
  });
});

describe('resolveNoun', () => {
  it('resolves aliases to item ids', () => {
    expect(resolveNoun(content, 'cassette player')).toEqual(['walkman']);
    expect(resolveNoun(content, 'Walkman')).toEqual(['walkman']);
    expect(resolveNoun(content, 'etch a sketch')).toEqual(['etchASketch']);
    expect(resolveNoun(content, 'nothing here')).toEqual([]);
  });
});
