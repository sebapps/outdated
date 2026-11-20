// Task 8: Study puzzle. Validates: Requirements 6.1-6.5, 9.4
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { describeMessage } from '../messages';
import { parse } from '../parser';
import { createInitialState, type EngineEvent, type GameState } from '../state';
import { step } from '../step';
import { REVERSED_MESSAGE_TEXT } from './study';

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

/** Arrive in the study carrying the study key, as after the boyhood bedroom puzzle. */
function startInStudy(): GameState {
  const s = createInitialState(content);
  s.room = 'study';
  s.inventory = ['pencil', 'hallwayKey', 'bedroomKey', 'studyKey'];
  for (const id of s.inventory) s.itemLocations[id] = 'inventory';
  s.unlockedDoors = ['hallway', 'boyhoodBedroom', 'study'];
  s.flags.atariBoxSearched = true;
  s.flags.jacketSearched = true;
  s.flags.compartmentSearched = true;
  s.warmth = 2;
  return s;
}

const SETUP = ['look behind bookshelf', 'plug in turntable'];

describe('study: solve path', () => {
  it('solves end to end and gives the grandparents key (6.1-6.4)', () => {
    let r = play(startInStudy(), 'look behind bookshelf');
    expect(r.state.itemLocations.turntableCord).toBe('study');
    r = play(r.state, 'plug in turntable');
    expect(r.state.flags.turntablePlugged).toBe(true);

    r = play(r.state, 'play record');
    expect(r.state.flags.recordPlayedForward).toBe(true);
    expect(msgIds(r.events)).toEqual(['study:forward']);
    expect(describeMessage('study:forward', content)).toContain('cat');

    r = play(r.state, 'stop record', 'reverse record');
    expect(r.state.flags.recordReversed).toBe(true);
    expect(sounds(r.events)).toEqual(['record_reversed']);
    expect(r.events.at(-1)).toEqual({ type: 'SILENCE_BEAT' });
    expect(describeMessage(msgIds(r.events)[0]!, content)).toContain(REVERSED_MESSAGE_TEXT);

    r = play(r.state, 'open disk box');
    expect(r.state.flags.diskBoxOpened).toBe(true);
    expect(r.state.itemLocations.grandparentsKey).toBe('inventory');
    expect(r.events).toContainEqual({ type: 'PUZZLE_SOLVED', puzzle: 'study' });
    expect(r.state.warmth).toBe(3);

    r = play(r.state, 'take key');
    expect(r.state.inventory).toContain('grandparentsKey');
  });

  it('accepts reversal synonyms and skips the optional forward play', () => {
    for (const line of ['turn record counterclockwise', 'spin record backwards', 'rotate record backward', 'reverse record', 'turn record backwards']) {
      const r = play(startInStudy(), ...SETUP, line);
      expect(r.state.flags.recordReversed, line).toBe(true);
      expect(r.state.flags.recordPlayedForward, line).toBeFalsy();
    }
  });

  it('the reversed text matches the voice manifest', () => {
    const manifest = JSON.parse(readFileSync('content/voice-lines.json', 'utf8')) as { lines: { id: string; text: string }[] };
    expect(manifest.lines.find((l) => l.id === 'study_record_clear')?.text).toBe(REVERSED_MESSAGE_TEXT);
  });

  it('warmth is monotonic: a higher warmth is kept', () => {
    const s = startInStudy();
    s.warmth = 4;
    expect(play(s, ...SETUP, 'reverse record', 'open disk box').state.warmth).toBe(4);
  });

  it('decoys have their own lines and no key', () => {
    for (const name of ['typewriter', 'stack of vinyl', 'desk lamp', 'globe', 'letter opener']) {
      const r = play(startInStudy(), `search ${name}`);
      expect(msgIds(r.events)[0]).toMatch(/^decoy:/);
      expect(r.state.itemLocations.grandparentsKey).toBe('hidden');
    }
  });

  it('sticky note and clipping can be read', () => {
    expect(describeMessage(msgIds(play(startInStudy(), 'examine sticky note').events)[0]!, content)).toContain('DO NOT TOUCH MY DISKS');
    expect(describeMessage(msgIds(play(startInStudy(), 'examine clipping').events)[0]!, content)).toContain('DAVID. NO.');
  });
});

describe('study: wrong order and recovery', () => {
  it('the turntable does nothing without the cord (6.1)', () => {
    expect(msgIds(play(startInStudy(), 'plug in turntable').events)).toEqual(['study:no_cord']);
    for (const line of ['play record', 'reverse record']) {
      const r = play(startInStudy(), line);
      expect(msgIds(r.events), line).toEqual(['study:no_power']);
      expect(r.state.flags.recordReversed).toBeFalsy();
    }
    // Found but not plugged in is still silent.
    expect(msgIds(play(startInStudy(), 'find cord', 'play record').events)).toEqual(['study:no_power']);
  });

  it('the disk box stays shut until the reversed message was heard (6.4)', () => {
    for (const line of ['open disk box', 'search disk box']) {
      const r = play(startInStudy(), line);
      expect(msgIds(r.events)).toEqual(['study:disk_box_shut']);
      expect(r.state.itemLocations.grandparentsKey).toBe('hidden');
    }
    const forwardOnly = play(startInStudy(), ...SETUP, 'play record', 'open disk box');
    expect(msgIds(forwardOnly.events)).toEqual(['study:disk_box_shut']);
    expect(forwardOnly.state.flags.diskBoxOpened).toBeFalsy();
  });

  it('over-spinning scratches the record, and FLIP or RESET restores it (6.5)', () => {
    for (const fix of ['flip record', 'reset record', 'turn over record']) {
      let r = play(startInStudy(), ...SETUP, 'reverse record', 'reverse record');
      expect(r.state.flags.recordScratched).toBe(true);
      expect(msgIds(r.events)).toEqual(['study:scratched']);
      expect(msgIds(play(r.state, 'play record').events)).toEqual(['study:scratched_skip']);
      r = play(r.state, fix);
      expect(r.state.flags.recordScratched).toBe(false);
      expect(msgIds(r.events), fix).toEqual(['study:flip_restore']);
      expect(play(r.state, 'reverse record').state.flags.recordReversed).toBe(true);
    }
  });

  it('a scratch before the message was ever heard cannot block it', () => {
    const s = startInStudy();
    s.flags.turntablePlugged = true;
    s.flags.recordScratched = true;
    s.flags.recordBackwards = true;
    const r = play(s, 'reverse record', 'flip record', 'reverse record', 'open disk box');
    expect(r.state.itemLocations.grandparentsKey).toBe('inventory');
  });

  it('repeating steps is harmless', () => {
    const r = play(startInStudy(), ...SETUP, 'plug in turntable', 'find cord', 'play record', 'play record', 'stop record', 'stop record',
      'reverse record', 'stop record', 'reverse record', 'open disk box', 'open disk box', 'search disk box');
    expect(r.state.itemLocations.grandparentsKey).toBe('inventory');
    expect(play(r.state, 'take key').state.inventory).toContain('grandparentsKey');
  });
});

describe('study: property', () => {
  it('no command sequence throws or makes the grandparents key unreachable', () => {
    const lines = [
      'look behind bookshelf', 'find cord', 'plug in turntable', 'play record', 'stop record', 'reverse record', 'spin record backwards',
      'flip record', 'reset record', 'open disk box', 'search disk box', 'take key', 'examine turntable', 'examine clipping',
      'take clipping', 'drop clipping', 'search typewriter', 'look',
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...lines), { maxLength: 25 }), (seq) => {
        let s = startInStudy();
        for (const line of seq) {
          const p = parse(line, content);
          if (!p.ok) continue;
          s = step(s, p.command, content).newState;
          if (s.room !== 'study') return false;
        }
        const warmthBefore = s.warmth;
        const tail = play(s, 'flip record', ...SETUP, 'reverse record', 'open disk box', 'take key');
        return tail.state.inventory.includes('grandparentsKey') && tail.state.warmth >= warmthBefore && tail.state.warmth >= 3;
      }),
      { numRuns: 150 },
    );
  });
});
