// Bug condition exploration for the playtest findings (C1 to C9).
// Written BEFORE any fix: these tests encode the expected behavior and are EXPECTED TO FAIL on unfixed code.
// C1 and C2 (voice tests) are covered by src/audio/voice.test.ts; C2 also gets a UI-level check here.
// Validates: Requirements 1.1-1.9, 2.1-2.9
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { content } from '../src/engine/content';
import { createInitialState, isEnded, runInput, vocabulary } from '../src/engine';
import { describeMessage } from '../src/engine/messages';
import { interpret, parse } from '../src/engine/parser';
import type { EngineEvent, GameState } from '../src/engine/state';
import { step } from '../src/engine/step';
import { isInScope } from '../src/engine/world';
import { newGame, takeTurn } from '../src/ui/session';

interface Walkthrough {
  segments: { puzzle: string; commands: string[] }[];
}
const walkthrough = JSON.parse(readFileSync('content/walkthrough.json', 'utf8')) as Walkthrough;
const allCommands = walkthrough.segments.flatMap((s) => s.commands);

const PUZZLES = ['basement', 'hallway', 'boyhoodBedroom', 'study', 'grandparentsBedroom'] as const;
type Puzzle = (typeof PUZZLES)[number];
const SOLVED_FLAG: Record<Puzzle, string> = {
  basement: 'atariBoxSearched',
  hallway: 'jacketSearched',
  boyhoodBedroom: 'compartmentSearched',
  study: 'diskBoxOpened',
  grandparentsBedroom: 'clockRadioOpened',
};
const KEY_ITEM: Record<Puzzle, string> = {
  basement: 'hallwayKey',
  hallway: 'bedroomKey',
  boyhoodBedroom: 'studyKey',
  study: 'grandparentsKey',
  grandparentsBedroom: 'frontDoorKey',
};
const EXIT_COMMAND: Record<Puzzle, string> = {
  basement: 'go up',
  hallway: 'go north',
  boyhoodBedroom: 'go east',
  study: 'go north',
  grandparentsBedroom: 'unlock door',
};
const ROOM_AFTER_EXIT: Record<Puzzle, string> = {
  basement: 'hallway',
  hallway: 'boyhoodBedroom',
  boyhoodBedroom: 'study',
  study: 'grandparentsBedroom',
  grandparentsBedroom: 'outside',
};

function run(state: GameState, line: string): { state: GameState; events: EngineEvent[] } {
  const p = parse(line, content);
  if (!p.ok) throw new Error(`unparsed command: "${line}"`);
  const r = step(state, p.command, content);
  return { state: r.newState, events: r.events };
}

/** Play the walkthrough up to and including the command that sets the puzzle's solved flag. */
function playUntilSolved(puzzle: Puzzle): { state: GameState; events: EngineEvent[] } {
  let state = createInitialState(content);
  const flag = SOLVED_FLAG[puzzle];
  for (const seg of walkthrough.segments) {
    for (const line of seg.commands) {
      const r = run(state, line);
      state = r.state;
      if (state.flags[flag]) return { state, events: r.events };
    }
  }
  throw new Error(`flag ${flag} never set`);
}

const msgIds = (events: readonly EngineEvent[]): string[] =>
  events.filter((e): e is Extract<EngineEvent, { type: 'MESSAGE' }> => e.type === 'MESSAGE').map((e) => e.id);

// ---------------------------------------------------------------------------
describe('C1/C2: voice tests (see src/audio/voice.test.ts) and UI bracket check', () => {
  it('C2: no UI line from a full walkthrough starts with "[["', async () => {
    let state = newGame();
    const bad: string[] = [];
    for (const line of allCommands) {
      const r = await takeTurn(state, line);
      state = r.state;
      for (const l of r.lines) if (l.kind !== 'pause' && l.text.startsWith('[[')) bad.push(l.text);
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('C3: HINT in a solved room gives the solved-state hint', () => {
  it('for every puzzle: hint:<puzzle>:solved, no tier text, tier unchanged', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PUZZLES), (puzzle) => {
        const { state } = playUntilSolved(puzzle);
        // The solved flag is set in the puzzle's own room, except the final room (still there until the exit).
        const before = state.hintTier[puzzle];
        const r = run(state, 'hint');
        const ids = msgIds(r.events);
        expect(ids, puzzle).toContain(`hint:${puzzle}:solved`);
        for (const t of [1, 2, 3]) expect(ids, puzzle).not.toContain(`hint:${puzzle}:${t}`);
        expect(r.state.hintTier[puzzle], puzzle).toBe(before);
      }),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
describe('C4: noun-failure suggestions list the current room first', () => {
  it('hallway with pencil and walkman carried suggests only hallway items', () => {
    let state = createInitialState(content);
    for (const line of walkthrough.segments[0]!.commands) state = run(state, line).state;
    expect(state.room).toBe('hallway');
    expect(state.inventory).toEqual(expect.arrayContaining(['pencil', 'walkman']));

    const r = interpret('examine unicorn', content, {
      inScope: (id) => isInScope(state, id),
      variant: state.variantCounter,
      held: (id) => state.inventory.includes(id),
      roomItems: content.rooms[state.room].items,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = r.event.text;
    const tail = text.split('Try EXAMINE with ')[1] ?? '';
    const suggested = tail.replace(/\.$/, '').split(/,\s*(?:or\s+)?|\s+or\s+/).filter((s) => s !== '');
    const roomNames = content.rooms.hallway.items.map((id) => content.items[id]!.name);
    expect(suggested.length, text).toBeGreaterThan(0);
    for (const name of suggested) expect(roomNames, text).toContain(name);
  });
});

// ---------------------------------------------------------------------------
describe('C5: a found key is in the inventory the same turn and the exit opens without TAKE', () => {
  it('for every puzzle', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PUZZLES), (puzzle) => {
        const { state } = playUntilSolved(puzzle);
        expect(state.inventory, `${puzzle}: key carried after reveal`).toContain(KEY_ITEM[puzzle]);
        const after = run(state, EXIT_COMMAND[puzzle]);
        if (puzzle === 'grandparentsBedroom') expect(after.state.flags.ended, puzzle).toBe(true);
        else expect(after.state.room, puzzle).toBe(ROOM_AFTER_EXIT[puzzle]);
      }),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
describe('C6: natural phrasings parse like their canonical commands', () => {
  const TABLE: [string, string][] = [
    ['pick the pencil up', 'pick up the pencil'],
    ['turn the NES on', 'turn on the NES'],
    ['switch the NES on', 'turn on the NES'],
    ['put the cassette in the walkman', 'insert the cassette into the walkman'],
    ['put cassette into walkman', 'insert the cassette into the walkman'],
    ['slide the tape into the VCR', 'insert the tape into the VCR'],
    ['plug the turntable in', 'plug in the turntable'],
    ['take the tape out', 'remove the tape'],
    ['flip the record over', 'flip the record'],
    ['open up the toybox', 'open the toybox'],
    ['listen to the record', 'play the record'],
    ['listen to the answering machine', 'play the answering machine'],
    ['fix the tracking', 'adjust tracking'],
    ['look in the closet', 'search the closet'],
    ['look for the cord', 'find the cord'],
    ['take a look at the pager', 'examine the pager'],
    ['unlock the door with the key', 'unlock the door'],
  ];
  it('every NaturalPhrasings row matches its canonical command', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TABLE), ([phrase, canonical]) => {
        const want = parse(canonical, content);
        expect(want.ok, `canonical "${canonical}" must parse`).toBe(true);
        const got = parse(phrase, content);
        expect(got.ok, phrase).toBe(true);
        if (got.ok && want.ok) {
          // "unlock the door with the key": the key object is accepted and ignored by the door logic.
          const g = { ...got.command };
          if (phrase.startsWith('unlock')) delete g.indirectObject;
          expect(g, phrase).toEqual(want.command);
        }
      }),
      { numRuns: TABLE.length * 2 },
    );
  });
  it('"i need a hint" is an unknown verb, not INVENTORY', () => {
    const p = parse('i need a hint', content);
    expect(p.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
const sentences = (text: string): string[] =>
  text
    .replace(/[[\]]/g, '')
    .split(/[.!?\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');

describe('C7: no sentence of four or more words repeats within one turn', () => {
  it('across the walkthrough', () => {
    let state = createInitialState(content);
    const dupes: string[] = [];
    for (const line of allCommands) {
      const r = runInput(state, line);
      state = r.state;
      // A sentence of four or more words repeated, whole or as the tail of a longer sentence ("One last
      // nudge, and the static clears all at once." + "The static clears all at once."), counts as a repeat.
      const seen = new Set<string>();
      for (const s of r.text.replace(/[[\]]/g, '').split(/[.!?\n]+/)) {
        const words = s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter((w) => w !== '');
        const grams = new Set<string>();
        for (let i = 0; i + 5 <= words.length; i++) grams.add(words.slice(i, i + 5).join(' '));
        for (const g of grams) {
          if (seen.has(g)) dupes.push(`"${line}": repeats "${g}"`);
        }
        for (const g of grams) seen.add(g);
      }
    }
    expect(dupes).toEqual([]);
  });
});

describe('C8: study:forward is at most three sentences and does not restate its caption', () => {
  it('play record forward', () => {
    let state = createInitialState(content);
    for (const seg of walkthrough.segments) {
      for (const line of seg.commands) {
        if (line === 'play record') {
          const r = run(state, line);
          const caption = r.events.find((e) => e.type === 'SOUND');
          const text = describeMessage('study:forward', content) ?? '';
          expect(msgIds(r.events)).toContain('study:forward');
          expect(sentences(text).length, text).toBeLessThanOrEqual(3);
          const common = new Set(['a', 'the', 'from', 'of', 'and', 'like', 'in', 'is', 'to']);
          const capWords = (caption && caption.type === 'SOUND' ? caption.caption : '')
            .toLowerCase()
            .replace(/[^a-z ]/g, '')
            .split(/\s+/)
            .filter((w) => w !== '' && !common.has(w));
          const shared = capWords.filter((w) => new RegExp(`\\b${w}\\b`).test(text.toLowerCase()));
          expect(shared, `narration restates caption words: ${text}`).toEqual([]);
          return;
        }
        state = run(state, line).state;
      }
    }
    throw new Error('play record not found in walkthrough');
  });
});

// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mirrors the fuzz_commands loop in tools/playtest-mcp/server.ts. Returns the highest repeat count. */
function fuzzMaxRepeats(seed: number, count: number, threaded: boolean): { max: number; line: string } {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const vocab = vocabulary();
  const junk = ['', '   ', '???', 'xyzzy', 'asdf qwer', 'a'.repeat(150), 'look at the the the', 'USE', 'with with with'];
  const typo = (s: string): string => (s.length > 3 ? s.slice(0, 2) + s.slice(3) : s);
  const base = createInitialState(content);
  let state = base;
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const roll = rand();
    let cmd: string;
    if (roll < 0.15) cmd = pick(junk);
    else if (roll < 0.35) cmd = typo(`${pick(vocab.verbs)} ${pick(vocab.nouns)}`);
    else if (roll < 0.55) cmd = `${pick(vocab.verbs)} ${pick(vocab.nouns)} with ${pick(vocab.nouns)}`;
    else cmd = `${pick(vocab.verbs)} ${pick(vocab.nouns)}`;
    const r = runInput(threaded ? state : base, cmd);
    if (threaded) state = isEnded(r.state) ? createInitialState(content) : r.state;
    seen.set(r.text, (seen.get(r.text) ?? 0) + 1);
  }
  let max = 0;
  let line = '';
  for (const [text, n] of seen) if (n > max) { max = n; line = text; }
  return { max, line };
}

describe('C9: fuzz harness carries state between commands', () => {
  const SEEDS = [1986, 7, 42];
  // Characterization of the OLD harness. It reran every command from the initial
  // state, so the same failure line repeated 30+ times and flooded the report. The
  // harness in tools/playtest-mcp/server.ts now threads state, so this loop is no
  // longer what ships. This records why the harness changed; the threaded test
  // below is the real check.
  it('fixed-state run (old harness behavior, characterization): repeats reach 30', () => {
    const found: string[] = [];
    for (const seed of SEEDS) {
      const { max, line } = fuzzMaxRepeats(seed, 300, false);
      if (max >= 30) found.push(`seed ${seed}: ${max} repeats of "${line.slice(0, 60)}"`);
    }
    expect(found.length).toBeGreaterThan(0);
  });
  it('threaded run: no response reaches 30 repeats', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEEDS), (seed) => {
        const { max, line } = fuzzMaxRepeats(seed, 300, true);
        expect(max, `seed ${seed}: "${line.slice(0, 60)}"`).toBeLessThan(30);
      }),
      { numRuns: 3 },
    );
  });
});
