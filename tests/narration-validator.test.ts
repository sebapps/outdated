// Task 14.3: content and LLM-validator checks (Requirement 8.5).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { content, GENERIC_NARRATION_KEYS, PUZZLE_IDS } from '../src/engine/content';
import { DEFAULT_BLOCKED_NAMES, validateNarration } from '../src/narration/llm';

const dir = join(__dirname, '..', 'content');
const readJson = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));

/** Every string value in the file, except under keys that are not player-facing. */
function strings(v: unknown, skipKeys: string[] = ['notes', '_note', 'speaker', 'voice', 'engine', 'effect', 'id']): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap((x) => strings(x, skipKeys));
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => (skipKeys.includes(k) ? [] : strings(x, skipKeys)));
  }
  return [];
}

const PLAYER_FILES = ['rooms.json', 'items.json', 'hints.json', 'narration.json', 'voice-lines.json'];
const playerText = PLAYER_FILES.flatMap((f) => strings(readJson(f)).map((s) => ({ f, s })));

const REAL_NAMES = [
  ...DEFAULT_BLOCKED_NAMES,
  'elvis', 'john lennon', 'paul mccartney', 'tom cruise', 'arnold schwarzenegger', 'sylvester stallone',
  'harrison ford', 'mr. rogers', 'bill gates', 'steve jobs', 'steve wozniak', 'shigeru miyamoto',
  'nancy reagan', 'jane fonda', 'olivia newton-john', 'stevie wonder', 'billy joel', 'phil collins',
  'george michael', 'tina turner', 'bon jovi', 'journey', 'queen',
];

// Distinctive phrases from well-known 80s songs. Titles and moods are allowed; lyrics are not.
const LYRIC_FRAGMENTS = [
  'is this the real life', 'billie jean is not my lover', 'we will we will rock you', 'never gonna give you up',
  'just a small town girl', "girls just want to have fun", "don't stop believin", 'sweet dreams are made of this',
  'take on me', 'every breath you take', 'like a virgin', 'i want to know what love is',
];

// Bible solutions: exact commands/codes that early hints and failure banks must not hand over.
const SOLUTION_CODES = ['5550142', '555-0142', '555 0142'];
const walkthrough = readJson('walkthrough.json') as { segments: { puzzle: string; commands: string[] }[] };
const SOLUTION_COMMANDS = walkthrough.segments
  .flatMap((s) => s.commands)
  .filter((c) => c.split(' ').length >= 3 || /\d/.test(c))
  .map((c) => c.toLowerCase());

describe('player-facing content', () => {
  it('has text to scan', () => {
    expect(playerText.length).toBeGreaterThan(100);
  });

  it('contains no lyric markers or known lyric fragments', () => {
    for (const { f, s } of playerText) {
      expect(s, `${f}: ${s}`).not.toMatch(/♪|♫|\blyrics?\b/i);
      const l = s.toLowerCase();
      for (const frag of LYRIC_FRAGMENTS) expect(l, `${f}: ${s}`).not.toContain(frag);
    }
  });

  it('names no real people or celebrities', () => {
    for (const { f, s } of playerText) {
      const l = s.toLowerCase();
      for (const name of REAL_NAMES) {
        expect(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l), `${f}: "${name}" in "${s}"`).toBe(false);
      }
    }
  });

  it('never mocks Dad', () => {
    const insult = /\b(dad|your father|david|he)\b[^.!?]{0,40}\b(was|is|were)\s+(a\s+|an\s+)?(loser|dork|nerd|pathetic|stupid|idiot|sad|embarrassing|ridiculous)\b/i;
    const direct = /\b(dad|your father)\b[^.!?]{0,30}\b(loser|dork|pathetic|idiot)\b/i;
    for (const { f, s } of playerText) {
      expect(s, `${f}: ${s}`).not.toMatch(insult);
      expect(s, `${f}: ${s}`).not.toMatch(direct);
    }
  });

  it('has no profanity and no player-facing generic "I don\'t understand"', () => {
    for (const l of content.narration.filter((n) => (GENERIC_NARRATION_KEYS as readonly string[]).includes(n.key))) {
      for (const v of l.variants) {
        expect(v).not.toMatch(/\b(damn|hell|shit|fuck|crap|ass)\b/i);
        expect(v).not.toMatch(/^i don'?t understand\.?$/i);
      }
    }
  });
});

describe('no early solution reveals', () => {
  const early = content.narration.filter(
    (n) => (GENERIC_NARRATION_KEYS as readonly string[]).includes(n.key) || n.key === 'hint_lead' || n.key === 'nudge',
  );

  it('keeps hint tiers 1 and 2 free of solution codes and full solution commands', () => {
    for (const p of PUZZLE_IDS) {
      for (const tier of content.hints[p].tiers.slice(0, 2)) {
        const l = tier.toLowerCase();
        for (const code of SOLUTION_CODES) expect(l, `${p}: ${tier}`).not.toContain(code);
        for (const cmd of SOLUTION_COMMANDS) expect(l, `${p}: ${tier}`).not.toContain(cmd);
      }
    }
  });

  it('keeps failure, hint-lead and nudge banks free of solution codes and commands', () => {
    expect(early.length).toBeGreaterThan(0);
    for (const line of early) {
      for (const v of line.variants) {
        const l = v.toLowerCase();
        for (const code of SOLUTION_CODES) expect(l, `${line.key}: ${v}`).not.toContain(code);
        for (const cmd of SOLUTION_COMMANDS) expect(l, `${line.key}: ${v}`).not.toContain(cmd);
      }
    }
  });
});

describe('failure banks', () => {
  it('have at least 8 distinct variants per generic key at every warmth level', () => {
    for (const key of GENERIC_NARRATION_KEYS) {
      for (const w of [0, 1, 2, 3, 4]) {
        const line = content.narration.find((n) => n.key === key && n.warmth === w);
        expect(line, `${key}@${w}`).toBeDefined();
        expect(new Set(line!.variants).size, `${key}@${w}`).toBeGreaterThanOrEqual(8);
      }
    }
  });
});

describe('voice-lines manifest', () => {
  const lines = (readJson('voice-lines.json') as { lines: { id: string; caption?: string; text: string }[] }).lines;
  it('gives every line a caption', () => {
    for (const l of lines) expect(l.caption?.trim(), l.id).toBeTruthy();
  });
});

describe('validateNarration rejects bad LLM output', () => {
  const bad: [string, unknown][] = [
    ['non-string', 42],
    ['empty', '   '],
    ['too long', 'a'.repeat(400)],
    ['four sentences', 'One. Two. Three. Four.'],
    ['music note', '♪ la la la'],
    ['lyrics word', 'Here are the lyrics.'],
    ['long quotation', 'He sang "' + 'x'.repeat(50) + '" at you.'],
    ['real name', 'Even Michael Jackson would pass on this.'],
    ['real name, mixed case', 'Ask MADONNA.'],
    ['state change', 'You unlock the door and you picked up the key.'],
    ['solution reveal', 'The code is 5550142.'],
    ['win claim', 'You escaped.'],
  ];
  for (const [label, text] of bad) {
    it(`rejects: ${label}`, () => {
      expect(validateNarration(text)).toBeUndefined();
    });
  }

  it('accepts a short in-voice line', () => {
    expect(validateNarration('A pencil. Cutting-edge technology.')).toBe('A pencil. Cutting-edge technology.');
  });

  it('every canned variant passes the validator (bank is held to the same bar)', () => {
    for (const l of content.narration.filter((n) => (GENERIC_NARRATION_KEYS as readonly string[]).includes(n.key))) {
      for (const v of l.variants) expect(validateNarration(v), v).toBeDefined();
    }
  });
});

// Sanity: the directory listing includes the files we scan.
describe('content directory', () => {
  it('contains the scanned files', () => {
    const files = readdirSync(dir);
    for (const f of PLAYER_FILES) expect(files).toContain(f);
  });
});
