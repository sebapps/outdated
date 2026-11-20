// Task 7: Boyhood bedroom puzzle. Validates: Requirements 5.1-5.5, 9.4
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { describeMessage } from '../messages';
import { parse } from '../parser';
import { createInitialState, type EngineEvent, type GameState } from '../state';
import { step } from '../step';

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
const sounds = (events: EngineEvent[]) => events.filter((e) => e.type === 'SOUND').map((e) => (e as { cue: string }).cue);

/** Arrive in the bedroom carrying the bedroom key, as after the hallway puzzle. */
function startInBedroom(): GameState {
  const s = createInitialState(content);
  s.room = 'boyhoodBedroom';
  s.inventory = ['pencil', 'hallwayKey', 'bedroomKey'];
  for (const id of s.inventory) s.itemLocations[id] = 'inventory';
  s.unlockedDoors = ['hallway', 'boyhoodBedroom'];
  s.flags.atariBoxSearched = true;
  s.flags.jacketSearched = true;
  s.warmth = 2;
  return s;
}

const BOOT = ['take cartridge', 'insert cartridge', 'press power', 'blow on cartridge', 'insert cartridge', 'press power'];

describe('boyhood bedroom: solve path', () => {
  it('solves end to end and gives the study key (5.1-5.5)', () => {
    let r = play(startInBedroom(), 'take cartridge', 'insert cartridge', 'press power');
    expect(r.state.flags.titleSeen).toBeFalsy();
    expect(msgIds(r.events)).toEqual(['boyhoodBedroom:boot_fail']);
    expect(sounds(r.events)).toEqual(['static_burst']);

    r = play(r.state, 'blow on cartridge');
    expect(r.state.flags.cartridgeBlown).toBe(true);
    expect(r.state.inventory).toContain('cartridge');
    r = play(r.state, 'insert cartridge', 'press power');
    expect(r.state.flags.titleSeen).toBe(true);
    expect(sounds(r.events)).toEqual(['nes_chime']);
    expect(describeMessage(msgIds(r.events)[0]!, content)).toContain('T H E   T O U C H');

    r = play(r.state, 'open toybox');
    expect(r.state.flags.toyboxOpened).toBe(true);
    expect(r.state.itemLocations.trailer).toBe('boyhoodBedroom');
    expect(r.state.itemLocations.studyKey).toBe('hidden');

    r = play(r.state, 'unfold trailer');
    expect(r.state.flags.trailerUnfolded).toBe(true);
    expect(sounds(r.events)).toEqual(['toy_transform']);

    r = play(r.state, 'search compartment');
    expect(r.state.flags.compartmentSearched).toBe(true);
    expect(r.events).toContainEqual({ type: 'PUZZLE_SOLVED', puzzle: 'boyhoodBedroom' });
    expect(r.state.warmth).toBe(2);

    r = play(r.state, 'take key');
    expect(r.state.inventory).toContain('studyKey');
    r = play(r.state, 'go east');
    expect(r.state.room).toBe('study');
  });

  it('accepts bible synonyms (turn on NES, blow into cartridge, search toybox, take key later)', () => {
    const r = play(
      startInBedroom(),
      'take cartridge', 'insert cartridge', 'turn on nes', 'blow into cartridge', 'insert cartridge', 'turn on nes',
      'search toybox', 'unfold trailer', 'search trailer', 'take study key',
    );
    expect(r.state.inventory).toContain('studyKey');
  });

  it('the title card has no lyrics and says THE TOUCH', () => {
    const text = describeMessage('boyhoodBedroom:boot', content)!;
    expect(text).toContain('T H E   T O U C H');
    expect(text.toLowerCase()).not.toMatch(/more than meets|transform|autobots|you got the touch|you got the power/);
  });

  it('warmth is monotonic: a higher warmth is kept', () => {
    const s = startInBedroom();
    s.warmth = 3;
    const r = play(s, ...BOOT, 'open toybox', 'unfold trailer', 'search compartment');
    expect(r.state.warmth).toBe(3);
  });
});

describe('boyhood bedroom: wrong order and recovery', () => {
  it('toybox stays shut until the title card has been seen (5.3)', () => {
    expect(msgIds(play(startInBedroom(), 'open toybox').events)).toEqual(['boyhoodBedroom:toybox_shut']);
    expect(msgIds(play(startInBedroom(), 'search toybox').events)).toEqual(['boyhoodBedroom:toybox_shut']);
    const failed = play(startInBedroom(), 'take cartridge', 'insert cartridge', 'press power', 'open toybox');
    expect(msgIds(failed.events)).toEqual(['boyhoodBedroom:toybox_shut']);
    expect(failed.state.itemLocations.trailer).toBe('hidden');
  });

  it('power with no cartridge, and the first boot fails (5.1)', () => {
    expect(msgIds(play(startInBedroom(), 'press power').events)).toEqual(['boyhoodBedroom:nes_empty']);
    const r = play(startInBedroom(), 'take cartridge', 'insert cartridge', 'press power', 'press power');
    expect(r.state.flags.titleSeen).toBeFalsy();
  });

  it('blowing while the cartridge is in the slot ejects it first (5.2)', () => {
    const r = play(startInBedroom(), 'take cartridge', 'insert cartridge', 'blow on cartridge');
    expect(r.state.itemLocations.cartridge).toBe('inventory');
    expect(r.state.flags.cartridgeInserted).toBe(false);
    expect(play(r.state, 'insert cartridge', 'press power').state.flags.titleSeen).toBe(true);
  });

  it('blowing first, then inserting, also boots', () => {
    const r = play(startInBedroom(), 'blow on cartridge', 'insert cartridge', 'press power');
    expect(r.state.flags.titleSeen).toBe(true);
  });

  it('the cartridge can be taken out and the trailer cannot be searched or unfolded early', () => {
    const r = play(startInBedroom(), 'take cartridge', 'insert cartridge', 'take cartridge');
    expect(r.state.inventory).toContain('cartridge');
    expect(msgIds(play(startInBedroom(), 'unfold trailer').events)).toEqual(['boyhoodBedroom:trailer_not_here']);
    expect(msgIds(play(startInBedroom(), 'search compartment').events)).toEqual(['boyhoodBedroom:trailer_not_here']);
    const open = play(startInBedroom(), ...BOOT, 'open toybox', 'search compartment');
    expect(msgIds(open.events)).toEqual(['boyhoodBedroom:trailer_folded_search']);
    expect(open.state.itemLocations.studyKey).toBe('hidden');
  });

  it('repeating steps is harmless', () => {
    const r = play(startInBedroom(), ...BOOT, 'open toybox', 'search toybox', 'unfold trailer', 'unfold trailer', 'search compartment', 'search compartment');
    expect(r.state.itemLocations.studyKey).toBe('inventory');
    expect(play(r.state, 'press power', 'take key').state.inventory).toContain('studyKey');
  });
});

describe('boyhood bedroom: decoys (5.4)', () => {
  it('each decoy toy has its own line and none gives a key', () => {
    const opened = play(startInBedroom(), ...BOOT, 'open toybox').state;
    const toys: [string, string][] = [
      ['cabbage patch kid', 'Adopted. No key in the paperwork.'],
      ['rubik\'s cube', 'Unsolved since 1983.'],
      ['etch a sketch', 'A drawing of a stick figure. Hang it in the Louvre.'],
      ['action figure', "He's lost more than a key."],
      ['villain robot', 'Hostile. Probably holding a grudge.'],
    ];
    const seen = new Set<string>();
    for (const [name, line] of toys) {
      const r = play(opened, `search ${name}`);
      const text = describeMessage(msgIds(r.events)[0]!, content);
      expect(text).toBe(line);
      seen.add(text!);
      expect(r.state.itemLocations.studyKey).toBe('hidden');
      expect(play(opened, `examine ${name}`).state.itemLocations.studyKey).toBe('hidden');
    }
    expect(seen.size).toBe(5);
  });

  it('the trailer description changes once unfolded', () => {
    const s = play(startInBedroom(), ...BOOT, 'open toybox').state;
    const before = describeMessage(msgIds(play(s, 'examine trailer').events)[0]!, content);
    const after = describeMessage(msgIds(play(s, 'unfold trailer', 'examine trailer').events)[0]!, content);
    expect(before).not.toBe(after);
  });
});

describe('boyhood bedroom: property', () => {
  it('no command sequence throws or makes the study key unreachable', () => {
    const lines = [
      'take cartridge', 'insert cartridge', 'press power', 'blow on cartridge', 'blow into nes', 'remove cartridge', 'drop cartridge',
      'open toybox', 'search toybox', 'unfold trailer', 'search compartment', 'search trailer', 'take key', 'take trailer',
      'drop trailer', 'examine trailer', 'search cabbage patch kid', 'take rubik\'s cube', 'look',
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...lines), { maxLength: 25 }), (seq) => {
        let s = startInBedroom();
        for (const line of seq) {
          const p = parse(line, content);
          if (!p.ok) continue;
          s = step(s, p.command, content).newState;
          if (s.room !== 'boyhoodBedroom' && s.room !== 'hallway') return false;
        }
        const warmthBefore = s.warmth;
        const tail = play(s, ...(s.room === 'hallway' ? ['go north'] : []), 'remove cartridge', ...BOOT, 'open toybox', 'unfold trailer', 'search compartment', 'take key');
        return tail.state.inventory.includes('studyKey') && tail.state.warmth >= warmthBefore;
      }),
      { numRuns: 150 },
    );
  });
});
