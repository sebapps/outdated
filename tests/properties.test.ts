/**
 * Property-based tests (fast-check + Vitest).
 *
 * Instead of testing a handful of hand-written command sequences, these generate
 * hundreds of random but VALID-ISH play sessions and assert invariants that must
 * hold in every one. They map to the "Correctness properties" section of design.md.
 *
 * Setup:  npm i -D vitest fast-check
 * Run:    npx vitest run tests/properties.test.ts
 *
 * These tests use the same engine contract as the playtest MCP server
 * (tools/playtest-mcp/engineAdapter.ts): createInitialState, runInput,
 * candidateCommands, stateKey, isEnded, summarize.
 *
 * When fast-check finds a failure it prints a seed and a shrunk (minimal) failing
 * command list. Replay with: fc.assert(prop, { seed: <seed>, path: "<path>" }).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createInitialState,
  runInput,
  candidateCommands,
  stateKey,
  isEnded,
  summarize,
} from '../src/engine/index.js';

type State = ReturnType<typeof createInitialState>;

// Item id for the protagonist's pencil. Change if your content uses another id.
const PENCIL = 'pencil';

/** Max random steps per generated session. */
const MAX_STEPS = 80;

/** Generator: a list of indices; each index picks one candidate command at that step. */
const sessionArb = fc.array(fc.nat(1000), { minLength: 1, maxLength: MAX_STEPS });

interface Step {
  command: string;
  before: State;
  after: State;
  text: string;
  recognized: boolean;
}

/** Play a session by picking candidate commands with the generated indices. Stops at the ending. */
function play(picks: number[]): Step[] {
  const steps: Step[] = [];
  let state = createInitialState();
  for (const pick of picks) {
    if (isEnded(state)) break;
    const options = candidateCommands(state);
    if (options.length === 0) break;
    const command = options[pick % options.length] as string;
    const before = state;
    const r = runInput(before, command);
    steps.push({ command, before, after: r.state, text: r.text, recognized: r.recognized });
    state = r.state;
  }
  return steps;
}

/**
 * Run `check` over a played session; on failure, rethrow with the exact command list so the
 * (shrunk) counterexample fast-check reports is readable, alongside its seed and path.
 */
function withCommands(steps: Step[], check: () => void): void {
  try {
    check();
  } catch (err) {
    const cmds = steps.map((s) => s.command);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${msg}\nCommands (${cmds.length}): ${JSON.stringify(cmds)}`);
  }
}

const walkthrough = JSON.parse(readFileSync('content/walkthrough.json', 'utf8')) as {
  segments: { commands: string[] }[];
};
const WALKTHROUGH_COMMANDS = [...new Set(walkthrough.segments.flatMap((s) => s.commands))];
const DIRECTIONS = ['up', 'down', 'north', 'south', 'east', 'west'];

/** Progress score for the guided search: solved flags, open doors and warmth. */
function progress(s: State): number {
  return summarize(s).flags.length + s.unlockedDoors.length * 10 + s.warmth * 10;
}

/** Puzzle verbs from the walkthrough, movement, and take/drop of every item in reach. */
function guidedCommands(s: State): string[] {
  const out = new Set<string>([...WALKTHROUGH_COMMANDS, ...DIRECTIONS.map((d) => `go ${d}`)]);
  for (const c of candidateCommands(s)) if (c.startsWith('take ') || c.startsWith('drop ')) out.add(c);
  return [...out];
}

/**
 * Best-first search toward the ending with a small command set. It can only prove 'yes';
 * exhausting it says nothing, because the command set is restricted.
 */
function guidedReachesEnding(start: State, budget: number): boolean {
  const seen = new Set<string>([stateKey(start)]);
  const buckets = new Map<number, State[]>([[progress(start), [start]]]);
  for (let expanded = 0; expanded < budget; expanded++) {
    const keys = [...buckets.keys()].filter((k) => (buckets.get(k) as State[]).length > 0);
    if (keys.length === 0) return false;
    const s = (buckets.get(Math.max(...keys)) as State[]).shift() as State;
    for (const cmd of guidedCommands(s)) {
      const next = runInput(s, cmd).state;
      if (isEnded(next)) return true;
      const k = stateKey(next);
      if (seen.has(k)) continue;
      seen.add(k);
      const p = progress(next);
      if (!buckets.has(p)) buckets.set(p, []);
      (buckets.get(p) as State[]).push(next);
    }
  }
  return false;
}

/**
 * Bounded search: can the ending still be reached from this state?
 * Returns 'yes' | 'no' | 'unknown' (budget exhausted before an answer).
 * First a guided search (fast, can prove 'yes'); if that fails, a blind BFS over every
 * candidate command, which is the only thing allowed to answer 'no'.
 */
function canReachEnding(start: State, budget = 4000): 'yes' | 'no' | 'unknown' {
  if (isEnded(start)) return 'yes';
  if (guidedReachesEnding(start, budget)) return 'yes';
  const seen = new Set<string>([stateKey(start)]);
  const queue: State[] = [start];
  let expanded = 0;
  while (queue.length > 0) {
    if (expanded++ >= budget) return 'unknown';
    const s = queue.shift() as State;
    for (const cmd of candidateCommands(s)) {
      const next = runInput(s, cmd).state;
      if (isEnded(next)) return 'yes';
      const k = stateKey(next);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(next);
      }
    }
  }
  return 'no';
}

describe('engine properties', () => {
  it('P1 determinism: the same state and command always produce the same result', () => {
    fc.assert(
      fc.property(sessionArb, (picks) => {
        for (const step of play(picks)) {
          const again = runInput(step.before, step.command);
          expect(again.text).toBe(step.text);
          expect(stateKey(again.state)).toBe(stateKey(step.after));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('P2 purity: running a command never mutates the state it was given', () => {
    fc.assert(
      fc.property(sessionArb, (picks) => {
        for (const step of play(picks)) {
          const snapshot = JSON.stringify(step.before);
          runInput(step.before, step.command);
          expect(JSON.stringify(step.before)).toBe(snapshot);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('P3 the pencil is never lost once the player has it', () => {
    fc.assert(
      fc.property(sessionArb, (picks) => {
        let hadPencil = false;
        for (const step of play(picks)) {
          const inv = summarize(step.after).inventory;
          if (hadPencil) expect(inv).toContain(PENCIL);
          if (inv.includes(PENCIL)) hadPencil = true;
        }
      }),
      { numRuns: 300 },
    );
  });

  it('P4 warmth never decreases', () => {
    fc.assert(
      fc.property(sessionArb, (picks) => {
        let last = 0;
        for (const step of play(picks)) {
          const w = summarize(step.after).warmth;
          expect(w).toBeGreaterThanOrEqual(last);
          last = w;
        }
      }),
      { numRuns: 300 },
    );
  });

  it('P5 no soft-locks: from any reachable state, the ending is not provably unreachable', () => {
    fc.assert(
      fc.property(sessionArb, (picks) => {
        const steps = play(picks);
        const finalState = steps.length > 0 ? (steps[steps.length - 1] as Step).after : createInitialState();
        // 'unknown' means the search budget ran out; only a definite 'no' is a failure.
        expect(canReachEnding(finalState)).not.toBe('no');
      }),
      { numRuns: 60 }, // each run does a bounded search, so keep this lower
    );
  });

  it('P6 any input at all gets a non-empty, in-character response and never throws', () => {
    const leaked = /undefined|\bNaN\b|\[object|Traceback|TypeError/;
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), sessionArb, (input, picks) => {
        const steps = play(picks);
        const state = steps.length > 0 ? (steps[steps.length - 1] as Step).after : createInitialState();
        if (isEnded(state)) return; // nothing to say after the ending
        const r = runInput(state, input);
        expect(r.text.trim().length).toBeGreaterThan(0);
        expect(r.text).not.toMatch(leaked);
      }),
      { numRuns: 400 },
    );
  });

  // Validates: Requirements 14.2
  it('P7 the ending is terminal: no narration follows the final pencil image', () => {
    const ordered = walkthrough.segments.flatMap((s) => s.commands);
    let ended = createInitialState();
    for (const cmd of ordered) ended = runInput(ended, cmd).state;
    expect(isEnded(ended)).toBe(true);
    expect(summarize(ended).inventory).toContain(PENCIL);
    const key = stateKey(ended);

    const input = fc.oneof(fc.string({ maxLength: 120 }), fc.constantFrom(...WALKTHROUGH_COMMANDS));
    fc.assert(
      fc.property(fc.array(input, { minLength: 1, maxLength: 10 }), (inputs) => {
        let state = ended;
        for (const line of inputs) {
          const r = runInput(state, line);
          // Parsed commands: step() is silent after the ending. Unparsed input only gets the
          // parser's own reply (the terminal stops accepting input once `ended`), and never
          // changes game state.
          if (r.recognized) {
            expect(r.text).toBe('');
            expect(r.eventTypes).toEqual([]);
          }
          expect(isEnded(r.state)).toBe(true);
          expect(stateKey(r.state)).toBe(key);
          state = r.state;
        }
      }),
      { numRuns: 200 },
    );
  });
});
