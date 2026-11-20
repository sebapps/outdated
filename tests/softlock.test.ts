// Task 14.2: soft-lock exploration. Validates: Requirements 11.2, 9.3
//
// Breadth-first explores states reachable with a bounded candidate command set (the puzzle's
// walkthrough commands in any order and any number of times, movement in every direction, and
// take/drop of the puzzle's items plus the pencil), deduplicating by a state key that ignores
// cosmetic fields (variantCounter, idleTurns, hintTier). It then walks the explored graph
// backwards from the goal. Any fully-expanded state that cannot reach the goal is a soft-lock.
// If a search hits its state cap the result is NOT a proof; the log line says so explicitly.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from '../src/engine/content';
import { parse, type Command } from '../src/engine/parser';
import { createInitialState, type GameState } from '../src/engine/state';
import { step } from '../src/engine/step';

const DIRECTIONS = ['up', 'down', 'north', 'south', 'east', 'west'];

interface Walkthrough {
  segments: { commands: string[] }[];
}
const walkthrough = JSON.parse(readFileSync('content/walkthrough.json', 'utf8')) as Walkthrough;

const parsedCache = new Map<string, Command | null>();
function parseCached(line: string): Command | null {
  let c = parsedCache.get(line);
  if (c === undefined) {
    const p = parse(line, content);
    c = p.ok ? p.command : null;
    parsedCache.set(line, c);
  }
  return c;
}

function stateKey(s: GameState): string {
  const flags = Object.keys(s.flags).filter((k) => s.flags[k]).sort();
  return JSON.stringify([
    s.room,
    [...s.inventory].sort(),
    flags,
    Object.entries(s.itemStates).sort(),
    [...s.unlockedDoors].sort(),
    Object.entries(s.itemLocations).sort(),
    s.warmth,
  ]);
}


const items = Object.values(content.items) as { id: string; name: string; aliases?: string[] }[];
const MAX_STATES_PER_LAYER = 150000;

function candidates(s: GameState, local: string[]): string[] {
  const out = [...local, ...DIRECTIONS.map((d) => `go ${d}`)];
  const text = ' ' + local.join(' ') + ' ';
  for (const it of items) {
    // Only items the layer's puzzle commands mention (plus the pencil): keeps the search tractable.
    const names = [it.name, ...(it.aliases ?? [])];
    if (it.id !== 'pencil' && !names.some((n) => text.includes(' ' + n + ' '))) continue;
    const loc = s.itemLocations[it.id];
    if (loc === 'inventory') out.push(`drop ${it.name}`);
    else if (loc === s.room) out.push(`take ${it.name}`);
  }
  return out;
}

function run(s: GameState, line: string): GameState {
  const cmd = parseCached(line);
  if (!cmd) throw new Error(`unparsed: ${line}`);
  return step(s, cmd, content).newState;
}

interface LayerResult {
  states: number;
  truncated: boolean;
  goalFound: boolean;
  stuck: string[];
}

/**
 * BFS the layer's state space. A state is "good" if it satisfies `isGoal` or can reach one.
 * Unexpanded frontier states (cap hit) are treated as unknown, so only definite soft-locks
 * (fully explored, no path to the goal) are reported.
 */
function exploreLayer(start: GameState, local: string[], isGoal: (s: GameState) => boolean): LayerResult {
  const states: GameState[] = [start];
  const index = new Map<string, number>([[stateKey(start), 0]]);
  const edges: number[][] = [[]];
  const expanded: boolean[] = [false];
  const goal: boolean[] = [isGoal(start)];
  let truncated = false;

  for (let i = 0; i < states.length; i++) {
    if (goal[i]) {
      expanded[i] = true;
      continue;
    }
    if (states.length >= MAX_STATES_PER_LAYER) {
      truncated = true;
      break;
    }
    const s = states[i]!;
    for (const line of candidates(s, local)) {
      const cmd = parseCached(line);
      if (!cmd) continue;
      const next = step(s, cmd, content).newState;
      const k = stateKey(next);
      let j = index.get(k);
      if (j === undefined) {
        j = states.length;
        index.set(k, j);
        states.push(next);
        edges.push([]);
        expanded.push(false);
        goal.push(isGoal(next));
      }
      edges[i]!.push(j);
    }
    expanded[i] = true;
  }

  const rev: number[][] = states.map(() => []);
  edges.forEach((outs, i) => outs.forEach((j) => rev[j]!.push(i)));
  const good = new Array<boolean>(states.length).fill(false);
  const stack: number[] = [];
  states.forEach((_, i) => {
    if (goal[i] || !expanded[i]) {
      good[i] = true;
      stack.push(i);
    }
  });
  while (stack.length) {
    const j = stack.pop()!;
    for (const i of rev[j]!) {
      if (!good[i]) {
        good[i] = true;
        stack.push(i);
      }
    }
  }
  const stuck = states
    .map((_, i) => i)
    .filter((i) => !good[i])
    .slice(0, 3)
    .map((i) => stateKey(states[i]!));
  return { states: states.length, truncated, goalFound: goal.some(Boolean), stuck };
}

describe('soft-lock exploration', () => {
  // The state space is the product of every puzzle's sub-states, so a single global BFS
  // is not tractable. Instead each puzzle is explored as a layer: start from the canonical
  // solved state of the previous layers, explore every wrong-order, drop, take and movement
  // combination, and require every state to still reach the next room (or the ending).
  const layers: { name: string; start: GameState; local: string[]; isGoal: (s: GameState) => boolean }[] = [];
  let finalState = createInitialState(content);
  {
    let s = createInitialState(content);
    walkthrough.segments.forEach((seg, idx) => {
      const before = s;
      let after = s;
      for (const c of seg.commands) after = run(after, c);
      const last = idx === walkthrough.segments.length - 1;
      const nextRoom = after.room;
      layers.push({
        name: `layer ${idx + 1}`,
        start: before,
        local: [...new Set(seg.commands)],
        isGoal: last ? (x) => x.flags.ended === true : (x) => x.room === nextRoom && x.room !== before.room,
      });
      s = after;
    });
    finalState = s;
  }

  it('the walkthrough reaches the ending', () => {
    expect(finalState.flags.ended).toBe(true);
  });

  layers.forEach((layer, idx) => {
    it(`${layer.name}: every reachable state can still progress`, { timeout: 600000 }, () => {
      const r = exploreLayer(layer.start, layer.local, layer.isGoal);
      console.log(
        `[softlock] ${layer.name}: states=${r.states} goalFound=${r.goalFound} truncated=${r.truncated}` +
          (r.truncated ? ' (NOT a proof: search hit the state cap)' : ' (exhaustive within candidate set)'),
      );
      expect(r.goalFound, `layer ${idx + 1} goal reachable`).toBe(true);
      expect(r.stuck, 'soft-locked states (up to 3)').toEqual([]);
    });
  });
});
