// Task 5: Basement puzzle. Validates: Requirements 3.1-3.6, 9.4
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { describeMessage } from '../messages';
import { parse } from '../parser';
import { createInitialState, type EngineEvent, type GameState } from '../state';
import { step } from '../step';

/** Play raw player input through the real parser and engine. */
function play(state: GameState, ...lines: string[]): { state: GameState; events: EngineEvent[]; all: EngineEvent[] } {
  let s = state;
  let events: EngineEvent[] = [];
  const all: EngineEvent[] = [];
  for (const line of lines) {
    const p = parse(line, content);
    if (!p.ok) throw new Error(`unparsed: ${line}`);
    const r = step(s, p.command, content);
    s = r.newState;
    events = r.events;
    all.push(...events);
  }
  return { state: s, events, all };
}

const msgIds = (events: EngineEvent[]) => events.filter((e) => e.type === 'MESSAGE').map((e) => (e as { id: string }).id);
const start = () => createInitialState(content);

describe('basement: solve path', () => {
  it('examining the cassette shows the tangle (3.1)', () => {
    const r = play(start(), 'examine cassette');
    expect(describeMessage(msgIds(r.events)[0]!, content)).toMatch(/tangle/);
  });

  it('solves end to end and gives the hallway key (3.2-3.4)', () => {
    let r = play(start(), 'take pencil', 'take cassette');
    expect(r.state.flags.hasPencil).toBe(true);

    r = play(r.state, 'rewind cassette with pencil');
    expect(r.state.flags.tapeRewound).toBe(true);
    expect(r.state.itemStates.cassette).toBe('rewound');
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'SOUND', cue: 'tape_hiss' }));

    r = play(r.state, 'take walkman', 'insert cassette into walkman');
    expect(r.state.flags.tapeLoaded).toBe(true);

    r = play(r.state, 'play walkman');
    expect(r.state.flags.tapePlayed).toBe(true);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'SOUND', cue: 'dad_voice' }));
    expect(msgIds(r.events)).toContain('basement:dad_tape');
    expect(describeMessage('basement:dad_tape', content)).toMatch(/under the things/i);

    r = play(r.state, 'search cartridge box');
    expect(r.state.flags.atariBoxSearched).toBeFalsy();
    r = play(r.state, 'search under foam');
    expect(r.state.flags.atariBoxSearched).toBe(true);
    expect(r.events).toContainEqual({ type: 'PUZZLE_SOLVED', puzzle: 'basement' });
    expect(r.events).toContainEqual({ type: 'WARMTH_CHANGED', level: 1 });
    expect(r.state.warmth).toBe(1);

    r = play(r.state, 'take key');
    expect(r.state.inventory).toContain('hallwayKey');
    expect(r.state.inventory).toContain('pencil');
    r = play(r.state, 'go up');
    expect(r.state.room).toBe('hallway');
  });

  it('solves with the bible synonyms (fix tape, load walkman, lift foam)', () => {
    const r = play(start(), 'take pencil', 'fix tape with pencil', 'load walkman', 'play walkman', 'search box', 'lift foam', 'take key');
    expect(r.state.inventory).toContain('hallwayKey');
    expect(r.state.warmth).toBe(1);
  });

  it('USE pencil ON cassette rewinds it (3.2)', () => {
    const r = play(start(), 'take pencil', 'use pencil on cassette');
    expect(r.state.flags.tapeRewound).toBe(true);
  });

  it('Dad tape text matches the voice manifest', () => {
    const manifest = JSON.parse(readFileSync('content/voice-lines.json', 'utf8')) as { lines: { id: string; text: string }[] };
    const line = manifest.lines.find((l) => l.id === 'basement_tape_dad');
    expect(describeMessage('basement:dad_tape', content)).toContain(line!.text);
  });

  it('warmth is 0 until the key is found', () => {
    const r = play(start(), 'take pencil', 'rewind tape with pencil', 'load walkman', 'play walkman');
    expect(r.state.warmth).toBe(0);
  });
});

describe('basement: wrong order and optional batteries', () => {
  it('playing an unrewound tape points at the pencil without changing state (3.6)', () => {
    const r = play(start(), 'play cassette');
    expect(msgIds(r.events)).toEqual(['basement:tape_tangled_play']);
    expect(describeMessage('basement:tape_tangled_play', content)).toMatch(/pencil/);
    expect(r.state.flags.tapePlayed).toBeFalsy();
  });

  it('refuses to load a tangled tape and points at the pencil', () => {
    const r = play(start(), 'insert tape into walkman');
    expect(msgIds(r.events)).toEqual(['basement:tape_tangled_insert']);
    expect(r.state.itemStates.cassette).toBe('tangled');
    expect(describeMessage('basement:tape_tangled_insert', content)).toMatch(/pencil/);
  });

  it('PLAY WALKMAN on an empty Walkman, with and without a rewound tape, recovers in character', () => {
    expect(msgIds(play(start(), 'play walkman').events)).toEqual(['basement:tape_tangled_play']);
    const carried = play(start(), 'take pencil', 'rewind tape with pencil', 'load walkman', 'remove tape', 'drop cassette', 'take walkman');
    expect(carried.state.itemLocations.cassette).toBe('basement');
    const r = play(start(), 'take pencil', 'rewind tape with pencil', 'play walkman');
    expect(msgIds(r.events)).toEqual(['basement:walkman_empty_tape_ready']);
  });

  it('rewinding without or with the wrong tool, or before holding the pencil, does nothing', () => {
    expect(msgIds(play(start(), 'rewind tape').events)).toEqual(['basement:rewind_needs_tool']);
    expect(msgIds(play(start(), 'rewind tape with walkman').events)).toEqual(['basement:wrong_tool']);
    const r = play(start(), 'rewind tape with pencil');
    expect(msgIds(r.events)).toEqual(['basement:pick_up_pencil']);
    expect(r.state.itemStates.cassette).toBe('tangled');
  });

  it('rewinding twice or while loaded is harmless', () => {
    let r = play(start(), 'take pencil', 'rewind tape with pencil', 'rewind tape with pencil');
    expect(msgIds(r.events)).toEqual(['already_done']);
    r = play(r.state, 'load walkman', 'rewind tape with pencil');
    expect(msgIds(r.events)).toEqual(['already_done']);
    expect(r.state.itemStates.cassette).toBe('loaded');
  });

  it('REMOVE or TAKE ejects a loaded tape back to the player, and it can be reloaded', () => {
    let r = play(start(), 'take pencil', 'rewind tape with pencil', 'load walkman', 'remove tape');
    expect(r.state.inventory).toContain('cassette');
    expect(r.state.itemStates.cassette).toBe('rewound');
    expect(r.state.flags.tapeLoaded).toBe(false);
    r = play(r.state, 'load walkman', 'take tape');
    expect(r.state.inventory).toContain('cassette');
    r = play(r.state, 'load walkman', 'play walkman');
    expect(r.state.flags.tapePlayed).toBe(true);
  });

  it('batteries are optional: explicit install and automatic fallback both work', () => {
    const base = ['take pencil', 'rewind tape with pencil', 'load walkman'];
    const auto = play(start(), ...base, 'play walkman');
    expect(msgIds(auto.all)).toContain('basement:batteries_auto');
    expect(auto.state.flags.tapePlayed).toBe(true);

    const manual = play(start(), 'insert batteries into walkman', ...base, 'play walkman');
    expect(manual.state.flags.batteriesInstalled).toBe(true);
    expect(msgIds(manual.all)).not.toContain('basement:batteries_auto');
    expect(manual.state.flags.tapePlayed).toBe(true);
  });

  it('the key cannot be searched out of order and decoys give nothing', () => {
    expect(msgIds(play(start(), 'search foam').events)).toEqual(['not_here']);
    const r = play(start(), 'search simon', 'search magic 8 ball', 'search battery jar');
    expect(r.state.itemLocations.hallwayKey).toBe('hidden');
    expect(r.state.warmth).toBe(0);
  });

  it('searching the box before the tape puzzle still works (never a dead end)', () => {
    const r = play(start(), 'search box', 'search foam', 'take key');
    expect(r.state.inventory).toContain('hallwayKey');
  });
});

describe('basement: the pencil is never consumed (3.5)', () => {
  it('survives the full solve and cannot be dropped', () => {
    const r = play(
      start(),
      'take pencil', 'take cassette', 'rewind cassette with pencil', 'take walkman', 'insert cassette into walkman',
      'play walkman', 'search cartridge box', 'search foam', 'take key', 'drop pencil',
    );
    expect(r.state.inventory).toContain('pencil');
  });

  it('property: no sequence of basement commands removes the pencil or throws', () => {
    const lines = [
      'take pencil', 'take cassette', 'take walkman', 'rewind cassette with pencil', 'rewind tape', 'use pencil on cassette',
      'insert cassette into walkman', 'load walkman', 'insert batteries into walkman', 'play walkman', 'stop walkman',
      'remove tape', 'drop pencil', 'drop cassette', 'drop walkman', 'search cartridge box', 'search foam', 'take key',
      'examine cassette', 'examine walkman', 'look',
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...lines), { maxLength: 30 }), (seq) => {
        let s = start();
        let wasHeld = false;
        for (const line of seq) {
          const p = parse(line, content);
          if (!p.ok) continue;
          s = step(s, p.command, content).newState;
          if (s.inventory.includes('pencil')) wasHeld = true;
          if (wasHeld && !s.inventory.includes('pencil')) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
