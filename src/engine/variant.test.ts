import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { content } from './content';
import { interpret } from './parser/interpret';
import { pickVariant, pickVariantIndex } from './variant';

describe('pickVariant', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('is deterministic for the same inputs', () => {
    expect(pickVariant(list, 7, 'k')).toBe(pickVariant(list, 7, 'k'));
  });

  it('never repeats on consecutive counters', () => {
    for (const salt of ['', 'cant_do', 'x']) {
      for (let c = 0; c < 20; c++) {
        expect(pickVariant(list, c, salt)).not.toBe(pickVariant(list, c + 1, salt));
      }
    }
  });

  it('cycles through every variant', () => {
    const seen = new Set([0, 1, 2, 3].map((c) => pickVariant(list, c, 's')));
    expect(seen.size).toBe(list.length);
  });

  it('handles odd counters and tiny lists', () => {
    expect(pickVariantIndex(3, Number.NaN)).toBe(0);
    expect(pickVariantIndex(3, -4)).toBe(1);
    expect(pickVariantIndex(0, 5)).toBe(0);
    expect(pickVariant(['only'], 9, 'z')).toBe('only');
  });
});

describe('interpret variant option', () => {
  it('rotates wording with the variant counter', () => {
    const texts = [0, 1, 2].map((v) => {
      const r = interpret('', content, { variant: v });
      return !r.ok && r.event.type === 'EMPTY_INPUT' ? r.event.text : '';
    });
    expect(new Set(texts).size).toBeGreaterThan(1);
    expect(texts[0]).not.toBe(texts[1]);
  });
});

describe('engine determinism', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
    });
  }

  it('uses no Math.random or Date.now in src/engine', () => {
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const offenders = walk(__dirname).filter((f) =>
      /Math\.random|Date\.now/.test(stripComments(readFileSync(f, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });
});
