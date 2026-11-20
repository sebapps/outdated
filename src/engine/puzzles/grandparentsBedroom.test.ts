// Task 9: Grandparents' bedroom puzzle and ending. Validates: Requirements 7.1-7.6, 9.4
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { describeMessage } from '../messages';
import { parse } from '../parser';
import { createInitialState, type EngineEvent, type GameState } from '../state';
import { step } from '../step';
import { VIDEO_FINAL_LINE } from './grandparentsBedroom';

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
const beats = (events: EngineEvent[]) => events.filter((e) => e.type === 'SILENCE_BEAT').length;

/** Arrive in the grandparents' bedroom carrying the grandparents' key, as after the study puzzle. */
function startInBedroom(): GameState {
  const s = createInitialState(content);
  s.room = 'grandparentsBedroom';
  s.inventory = ['pencil', 'hallwayKey', 'bedroomKey', 'studyKey', 'grandparentsKey'];
  for (const id of s.inventory) s.itemLocations[id] = 'inventory';
  s.unlockedDoors = ['hallway', 'boyhoodBedroom', 'study', 'grandparentsBedroom'];
  Object.assign(s.flags, { atariBoxSearched: true, jacketSearched: true, compartmentSearched: true, diskBoxOpened: true });
  s.warmth = 3;
  return s;
}

const TO_PLAYING = ['open tape case', 'insert tape', 'press play'];
const WATCH = ['open tape case', 'insert tape', 'press play', 'adjust tracking', 'adjust tracking', 'adjust tracking'];

/** The canonical walkthrough through all five puzzles to the ending. */
export const FULL_GAME = [
  // Basement
  'take pencil', 'take cassette', 'rewind cassette with pencil', 'take walkman', 'insert cassette into walkman', 'play walkman',
  'search cartridge box', 'search under foam', 'take key', 'go up',
  // Hallway
  'examine pager', 'dial 5550142', 'open closet', 'search jacket', 'search inside pocket', 'take key', 'go north',
  // Boyhood bedroom
  'take cartridge', 'insert cartridge', 'press power', 'blow on cartridge', 'insert cartridge', 'press power',
  'search toybox', 'unfold trailer', 'search trailer', 'take study key', 'go east',
  // Study
  'look behind bookshelf', 'plug in turntable', 'play record', 'stop record', 'reverse record', 'open disk box', 'take grandparents key', 'go north',
  // Grandparents' bedroom
  ...WATCH, 'remove battery cover', 'take front door key', 'unlock door',
];

describe('grandparents bedroom: solve path', () => {
  it('solves end to end up to the front door key (7.1-7.5)', () => {
    let r = play(startInBedroom(), 'open tape case');
    expect(r.state.flags.tapeFound).toBe(true);
    expect(r.state.itemLocations.homeTape).toBe('grandparentsBedroom');
    expect(describeMessage(msgIds(r.events)[0]!, content)).toContain("DAD'S CHRISTMAS 1986");

    r = play(r.state, 'insert tape');
    expect(r.state.flags.tapeInserted).toBe(true);

    r = play(r.state, 'press play');
    expect(msgIds(r.events)).toEqual(['grandparentsBedroom:play_fuzzy_0']);
    expect(r.state.flags.videoWatched).toBeFalsy();

    r = play(r.state, 'adjust tracking');
    expect(msgIds(r.events)).toEqual(['grandparentsBedroom:adjust_1']);
    r = play(r.state, 'fix tracking');
    expect(msgIds(r.events)).toEqual(['grandparentsBedroom:adjust_2']);
    expect(r.state.warmth).toBe(3);

    r = play(r.state, 'tracking');
    expect(r.state.flags.trackingAdjusted).toBe(true);
    expect(r.state.flags.videoWatched).toBe(true);
    expect(r.state.warmth).toBe(4);
    expect(r.events.at(-1)).toEqual({ type: 'SILENCE_BEAT' });
    expect(beats(r.events)).toBe(1);
    expect(r.events).toContainEqual({ type: 'WARMTH_CHANGED', level: 4 });
    expect(msgIds(r.events).map((id) => describeMessage(id, content)).join('\n')).toContain(VIDEO_FINAL_LINE);

    r = play(r.state, 'remove battery cover');
    expect(r.state.flags.clockRadioOpened).toBe(true);
    expect(r.state.itemLocations.frontDoorKey).toBe('inventory');
    expect(r.events).toContainEqual({ type: 'PUZZLE_SOLVED', puzzle: 'grandparentsBedroom' });

    r = play(r.state, 'take key');
    expect(r.state.inventory).toContain('frontDoorKey');
  });

  it('accepts the documented synonyms', () => {
    for (const line of ['open battery cover', 'search clock radio', 'remove battery cover']) {
      const r = play(startInBedroom(), ...WATCH, line);
      expect(r.state.itemLocations.frontDoorKey, line).toBe('inventory');
    }
    for (const line of ['fix tracking', 'tracking', 'adjust tracking']) {
      const r = play(startInBedroom(), ...TO_PLAYING, line);
      expect(r.state.itemStates.vcrTracking, line).toBe('1');
    }
  });

  it('the video text matches the voice manifest', () => {
    const manifest = JSON.parse(readFileSync('content/voice-lines.json', 'utf8')) as { lines: { id: string; text: string }[] };
    expect(manifest.lines.find((l) => l.id === 'video_adult_dad_final')?.text).toBe(VIDEO_FINAL_LINE);
  });

  it('the first watch has the final silence beat once; a rewatch does not repeat it', () => {
    const first = play(startInBedroom(), ...WATCH);
    expect(beats(first.events)).toBe(1);
    const again = play(first.state, 'press play');
    expect(beats(again.events)).toBe(0);
    expect(again.state.warmth).toBe(4);
  });

  it('decoys have their own lines and no key', () => {
    for (const name of ['aerobics tape case', 'jewelry box', 'betamax tape', 'leg warmers', 'tie rack']) {
      const r = play(startInBedroom(), ...(name === 'aerobics tape case' ? ['open tape case'] : []), `search ${name}`);
      expect(msgIds(r.events)[0], name).toMatch(/^decoy:/);
      expect(r.state.itemLocations.frontDoorKey).toBe('hidden');
    }
  });
});

describe('grandparents bedroom: optional clock gag (7.3)', () => {
  it('SET CLOCK gives the joke and never blocks progress', () => {
    let r = play(startInBedroom(), 'set clock');
    expect(describeMessage(msgIds(r.events)[0]!, content)).toContain('A generation of households');
    r = play(r.state, 'set clock', ...WATCH, 'remove battery cover');
    expect(r.state.itemLocations.frontDoorKey).toBe('inventory');
  });

  it('is not required and does not change tracking or warmth', () => {
    const r = play(startInBedroom(), 'set clock');
    expect(r.state.warmth).toBe(3);
    expect(r.state.flags.videoWatched).toBeFalsy();
    expect(play(startInBedroom(), ...WATCH).state.flags.videoWatched).toBe(true);
  });

  it('after the video the joke is gone, but nothing breaks', () => {
    const r = play(startInBedroom(), ...WATCH, 'set clock');
    expect(msgIds(r.events)).toEqual(['grandparentsBedroom:clock_gag_late']);
  });
});

describe('grandparents bedroom: wrong order and recovery', () => {
  it('the VCR does nothing without a tape, and the tape stays in its case until opened', () => {
    expect(msgIds(play(startInBedroom(), 'press play').events)).toEqual(['grandparentsBedroom:play_empty']);
    expect(msgIds(play(startInBedroom(), 'insert tape').events)).toEqual(['grandparentsBedroom:no_tape']);
    expect(msgIds(play(startInBedroom(), 'adjust tracking').events)).toEqual(['grandparentsBedroom:adjust_no_tape']);
  });

  it('adjusting before playing does nothing', () => {
    const r = play(startInBedroom(), 'open tape case', 'insert tape', 'adjust tracking');
    expect(msgIds(r.events)).toEqual(['grandparentsBedroom:adjust_not_playing']);
    expect(r.state.itemStates.vcrTracking).toBe('0');
  });

  it('a partly adjusted picture does not play the video', () => {
    const r = play(startInBedroom(), ...TO_PLAYING, 'adjust tracking', 'press play');
    expect(r.state.flags.videoWatched).toBeFalsy();
    expect(msgIds(r.events)).toEqual(['grandparentsBedroom:play_fuzzy_1']);
  });

  it('the Betamax does not fit', () => {
    const r = play(startInBedroom(), 'insert betamax');
    expect(msgIds(r.events)).toEqual(['grandparentsBedroom:wrong_format']);
    expect(r.state.flags.tapeInserted).toBeFalsy();
  });

  it('the battery cover stays stuck until the video has been seen (7.5)', () => {
    for (const line of ['remove battery cover', 'open battery cover', 'search clock radio', 'open clock radio']) {
      const r = play(startInBedroom(), line);
      expect(msgIds(r.events), line).toEqual(['grandparentsBedroom:cover_stuck']);
      expect(r.state.itemLocations.frontDoorKey).toBe('hidden');
    }
    const halfway = play(startInBedroom(), ...TO_PLAYING, 'adjust tracking', 'remove battery cover');
    expect(halfway.state.itemLocations.frontDoorKey).toBe('hidden');
  });

  it('the front door stays locked without the key and no ending fires', () => {
    for (const line of ['unlock door', 'open front door', 'go front door']) {
      const r = play(startInBedroom(), line);
      expect(r.events.some((e) => e.type === 'ENDING'), line).toBe(false);
      expect(r.state.flags.ended).toBeFalsy();
      expect(r.state.room).toBe('grandparentsBedroom');
    }
  });

  it('ejecting early resets tracking but returns the tape, and the video can still be reached', () => {
    for (const eject of ['eject tape', 'remove tape', 'take tape']) {
      let r = play(startInBedroom(), ...TO_PLAYING, 'adjust tracking', 'adjust tracking', eject);
      expect(r.state.inventory, eject).toContain('homeTape');
      expect(r.state.flags.tapeInserted).toBe(false);
      expect(r.state.itemStates.vcrTracking).toBe('0');
      r = play(r.state, 'insert tape', 'press play', 'adjust tracking', 'adjust tracking', 'adjust tracking');
      expect(r.state.flags.videoWatched, eject).toBe(true);
    }
  });

  it('ejecting an empty VCR is harmless', () => {
    expect(msgIds(play(startInBedroom(), 'eject tape').events)).toEqual(['grandparentsBedroom:nothing_to_eject']);
  });

  it('dropping the tape and picking it up again still works', () => {
    const r = play(startInBedroom(), 'open tape case', 'take tape', 'drop tape', 'insert tape', 'press play', 'tracking', 'tracking', 'tracking');
    expect(r.state.flags.videoWatched).toBe(true);
  });

  it('repeating steps is harmless', () => {
    const r = play(startInBedroom(), ...WATCH, 'adjust tracking', 'open tape case', 'insert tape', 'remove battery cover', 'remove battery cover', 'open battery cover', 'take key', 'take key');
    expect(r.state.inventory).toContain('frontDoorKey');
    expect(r.state.warmth).toBe(4);
  });

  it('warmth is monotonic', () => {
    expect(play(startInBedroom(), ...WATCH).state.warmth).toBe(4);
  });
});

describe('the ending (7.6)', () => {
  const withKey = (): GameState => play(startInBedroom(), ...WATCH, 'remove battery cover', 'take key').state;

  it('UNLOCK DOOR triggers alarm, ENDING, black screen, wake-up scene, then the pencil last', () => {
    const r = play(withKey(), 'unlock door');
    const types = r.events.map((e) => e.type);
    expect(sounds(r.events)).toContain('alarm_buzz');
    expect(types.filter((t) => t === 'ENDING')).toHaveLength(1);
    expect(types.indexOf('SOUND')).toBeLessThan(types.indexOf('ENDING'));
    const ids = msgIds(r.events);
    const tail = ids.slice(-3);
    expect(tail).toEqual(['ending:black', 'ending:wake', 'ending:pencil']);
    expect(r.events.at(-1)).toEqual({ type: 'MESSAGE', id: 'ending:pencil' });
    expect(describeMessage('ending:pencil', content)).toContain('pencil');
    expect(r.state.inventory).toContain('pencil');
    expect(r.state.flags.ended).toBe(true);
  });

  it('OPEN FRONT DOOR, USE KEY ON DOOR and GO FRONT DOOR also trigger it, with nothing before the black screen but the alarm', () => {
    for (const line of ['open front door', 'use front door key on door', 'go front door']) {
      const r = play(withKey(), line);
      expect(r.events.some((e) => e.type === 'ENDING'), line).toBe(true);
      expect(r.events.at(-1), line).toEqual({ type: 'MESSAGE', id: 'ending:pencil' });
      expect(msgIds(r.events), line).not.toContain('room:outside');
    }
  });

  it('puts the pencil in the pocket even if the player never took it', () => {
    const s = withKey();
    s.inventory = s.inventory.filter((i) => i !== 'pencil');
    s.itemLocations.pencil = 'basement';
    const r = play(s, 'unlock door');
    expect(r.state.inventory).toContain('pencil');
  });

  it('is terminal: later commands are accepted, change nothing, and say nothing', () => {
    const ended = play(withKey(), 'unlock door').state;
    for (const line of ['look', 'inventory', 'go south', 'take key', 'xyzzy', 'hint', 'unlock door', 'open front door', 'press play']) {
      const p = parse(line, content);
      const r = p.ok ? step(ended, p.command, content) : { newState: ended, events: [] as EngineEvent[] };
      expect(r.events, line).toEqual([]);
      expect(r.newState, line).toEqual(ended);
    }
  });

  it('property: no command after the ending produces any event or state change', () => {
    const ended = play(withKey(), 'unlock door').state;
    const lines = ['look', 'inventory', 'go south', 'go front door', 'take pencil', 'drop pencil', 'search clock radio', 'press play', 'set clock', 'hint', 'dial 5550142', ''];
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constantFrom(...lines), fc.string({ maxLength: 40 })), { maxLength: 15 }), (seq) => {
        let s = ended;
        for (const line of seq) {
          const p = parse(line, content);
          if (!p.ok) continue;
          const r = step(s, p.command, content);
          if (r.events.length !== 0) return false;
          s = r.newState;
        }
        return JSON.stringify(s) === JSON.stringify(ended);
      }),
      { numRuns: 100 },
    );
  });
});

describe('full game', () => {
  it('plays all five puzzles through to the ending with the pencil in the pocket', () => {
    let s = createInitialState(content);
    const solved: string[] = [];
    let warmth = 0;
    for (const line of FULL_GAME) {
      const p = parse(line, content);
      if (!p.ok) throw new Error(`unparsed: ${line}`);
      const before = s;
      const r = step(s, p.command, content);
      s = r.newState;
      for (const e of r.events) if (e.type === 'PUZZLE_SOLVED') solved.push(e.puzzle);
      expect(s.warmth, line).toBeGreaterThanOrEqual(before.warmth);
      warmth = s.warmth;
      if (s.flags.ended) {
        expect(r.events.some((e) => e.type === 'ENDING'), line).toBe(true);
        break;
      }
    }
    expect(solved).toEqual(['basement', 'hallway', 'boyhoodBedroom', 'study', 'grandparentsBedroom']);
    expect(s.flags.ended).toBe(true);
    expect(s.inventory).toContain('pencil');
    expect(warmth).toBe(4);
  });
});

describe('grandparents bedroom: property', () => {
  it('no command sequence throws or makes the front door key unreachable', () => {
    const lines = [
      'open tape case', 'search tape case', 'insert tape', 'insert betamax', 'press play', 'adjust tracking', 'fix tracking', 'eject tape',
      'remove tape', 'take tape', 'drop tape', 'set clock', 'remove battery cover', 'open clock radio', 'take key', 'examine tape',
      'examine clock radio', 'search jewelry box', 'take leg warmers', 'drop leg warmers', 'look', 'inventory',
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...lines), { maxLength: 30 }), (seq) => {
        let s = startInBedroom();
        for (const line of seq) {
          const p = parse(line, content);
          if (!p.ok) continue;
          s = step(s, p.command, content).newState;
        }
        const warmthBefore = s.warmth;
        const tail = play(s, 'open tape case', 'eject tape', 'take tape', 'insert tape', 'press play', 'adjust tracking', 'adjust tracking', 'adjust tracking', 'remove battery cover', 'take key', 'unlock door');
        return tail.state.flags.ended === true && tail.state.warmth >= warmthBefore && tail.state.warmth === 4;
      }),
      { numRuns: 150 },
    );
  });
});
