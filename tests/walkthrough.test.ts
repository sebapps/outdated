// Task 14.1: plays the whole game start to finish. Validates: Requirements 11.1
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from '../src/engine/content';
import { parse } from '../src/engine/parser';
import { createInitialState, type EngineEvent, type GameState } from '../src/engine/state';
import { step } from '../src/engine/step';

interface Walkthrough {
  segments: { puzzle: string; commands: string[] }[];
  expect: { warmthAtEnd: number; inventoryContains: string[] };
}

const walkthrough = JSON.parse(readFileSync('content/walkthrough.json', 'utf8')) as Walkthrough;

const ORDER = ['basement', 'hallway', 'boyhoodBedroom', 'study', 'grandparentsBedroom'];
const ROOM_AFTER = ['hallway', 'boyhoodBedroom', 'study', 'grandparentsBedroom'];
const WARMTH_AFTER = [1, 2, 2, 3, 4];
const SILENT_PUZZLES = ['hallway', 'study', 'grandparentsBedroom'];

interface Turn {
  puzzle: string;
  line: string;
  before: GameState;
  after: GameState;
  events: EngineEvent[];
}

function playAll(): Turn[] {
  const turns: Turn[] = [];
  let state = createInitialState(content);
  for (const seg of walkthrough.segments) {
    for (const line of seg.commands) {
      const p = parse(line, content);
      if (!p.ok) throw new Error(`unparsed walkthrough command: "${line}"`);
      const r = step(state, p.command, content);
      turns.push({ puzzle: seg.puzzle, line, before: state, after: r.newState, events: r.events });
      state = r.newState;
    }
  }
  return turns;
}

const turns = playAll();
const last = turns[turns.length - 1]!;

describe('full walkthrough', () => {
  it('covers the five puzzles in order', () => {
    expect(walkthrough.segments.map((s) => s.puzzle)).toEqual(ORDER);
  });

  it('starts in the basement at warmth 0 with nothing unlocked', () => {
    const s = createInitialState(content);
    expect(s.room).toBe('basement');
    expect(s.warmth).toBe(0);
    expect(s.unlockedDoors).toEqual([]);
  });

  it('solves each puzzle exactly once, in order', () => {
    const solved = turns.flatMap((t) => t.events.filter((e) => e.type === 'PUZZLE_SOLVED').map((e) => (e as { puzzle: string }).puzzle));
    expect(solved).toEqual(ORDER);
  });

  it('each puzzle ends with the next room unlocked and entered', () => {
    ROOM_AFTER.forEach((room, i) => {
      const seg = walkthrough.segments[i]!;
      const segTurns = turns.filter((t) => t.puzzle === seg.puzzle);
      const end = segTurns[segTurns.length - 1]!;
      expect(end.after.room, seg.puzzle).toBe(room);
      expect(end.after.unlockedDoors, seg.puzzle).toContain(room);
      expect(segTurns.some((t) => t.events.some((e) => e.type === 'DOOR_UNLOCKED' && e.room === room)), seg.puzzle).toBe(true);
    });
  });

  it('never leaves a room before its puzzle is solved', () => {
    let current = 'basement';
    for (const t of turns) {
      if (t.after.room !== current) {
        const solved = t.events.some((e) => e.type === 'PUZZLE_SOLVED') || t.before.flags.ended;
        const solvedEarlier = turns.slice(0, turns.indexOf(t)).some((x) => x.events.some((e) => e.type === 'PUZZLE_SOLVED' && e.puzzle === t.puzzle));
        expect(solved || solvedEarlier, t.line).toBe(true);
        current = t.after.room;
      }
    }
  });

  it('warmth rises 0 to 4 and never drops', () => {
    let prev = 0;
    const seen = new Set<number>([0]);
    for (const t of turns) {
      expect(t.after.warmth, t.line).toBeGreaterThanOrEqual(prev);
      prev = t.after.warmth;
      seen.add(prev);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(prev).toBe(walkthrough.expect.warmthAtEnd);
    const levels = turns.flatMap((t) => t.events.filter((e) => e.type === 'WARMTH_CHANGED').map((e) => (e as { level: number }).level));
    expect(levels[levels.length - 1]).toBe(4);
    expect(levels).toEqual([...levels].sort());
  });

  it('warmth matches the ladder after each puzzle', () => {
    ORDER.forEach((puzzle, i) => {
      const segTurns = turns.filter((t) => t.puzzle === puzzle);
      const end = segTurns[segTurns.length - 1]!;
      expect(end.after.warmth, puzzle).toBe(WARMTH_AFTER[i]);
    });
  });

  it('plays a silence beat in the hallway, study and bedroom puzzles, and nowhere else', () => {
    for (const puzzle of ORDER) {
      const count = turns.filter((t) => t.puzzle === puzzle).reduce((n, t) => n + t.events.filter((e) => e.type === 'SILENCE_BEAT').length, 0);
      expect(count, puzzle).toBe(SILENT_PUZZLES.includes(puzzle) ? 1 : 0);
    }
  });

  it('the ending fires once, on the last command, and nothing follows it', () => {
    const endings = turns.filter((t) => t.events.some((e) => e.type === 'ENDING'));
    expect(endings).toEqual([last]);
    expect(last.after.flags.ended).toBe(true);
    expect(last.events.at(-1)).toEqual({ type: 'MESSAGE', id: 'ending:pencil' });
    expect(last.events.some((e) => e.type === 'SOUND' && e.cue === 'alarm_buzz')).toBe(true);
  });

  it('ends with the pencil in the pocket', () => {
    for (const item of walkthrough.expect.inventoryContains) expect(last.after.inventory).toContain(item);
  });

  it('is terminal: every command after the ending is silent and changes nothing', () => {
    for (const line of ['look', 'inventory', 'go south', 'hint', 'take pencil', 'unlock door', 'xyzzy']) {
      const p = parse(line, content);
      if (!p.ok) continue;
      const r = step(last.after, p.command, content);
      expect(r.events, line).toEqual([]);
      expect(r.newState, line).toEqual(last.after);
    }
  });

  it('does not mutate the states it is given', () => {
    const s = createInitialState(content);
    const snap = JSON.stringify(s);
    const p = parse('take pencil', content);
    if (!p.ok) throw new Error('unparsed');
    step(s, p.command, content);
    expect(JSON.stringify(s)).toBe(snap);
  });
});
