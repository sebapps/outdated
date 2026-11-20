// Task 6: Hallway puzzle. Validates: Requirements 4.1-4.6, 9.4
import { readFileSync } from 'node:fs';
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

/** Arrive in the hallway carrying the hallway key, as after the basement puzzle. */
function startInHallway(): GameState {
  const s = createInitialState(content);
  s.room = 'hallway';
  s.inventory = ['pencil', 'hallwayKey'];
  s.itemLocations.pencil = 'inventory';
  s.itemLocations.hallwayKey = 'inventory';
  s.flags.atariBoxSearched = true;
  s.warmth = 1;
  return s;
}

describe('hallway: solve path', () => {
  it('solves end to end and gives the bedroom key (4.1, 4.2, 4.5)', () => {
    let r = play(startInHallway(), 'examine pager');
    expect(r.state.flags.pagerRead).toBe(true);
    expect(describeMessage(msgIds(r.events)[0]!, content)).toContain('555-0142');

    r = play(r.state, 'dial 5550142');
    expect(r.state.flags.numberDialed).toBe(true);
    expect(r.state.flags.messageHeard).toBe(true);
    expect(sounds(r.events)).toEqual(['dial_clicks', 'phone_ring', 'machine_beep']);
    expect(r.events).toContainEqual({ type: 'SILENCE_BEAT' });
    expect(r.events[r.events.length - 1]).toEqual({ type: 'SILENCE_BEAT' });
    expect(r.state.warmth).toBe(1);

    r = play(r.state, 'open closet');
    expect(r.state.itemLocations.jacket).toBe('hallway');
    r = play(r.state, 'search jacket');
    expect(r.state.flags.jacketSearched).toBeFalsy();
    r = play(r.state, 'search inside pocket');
    expect(r.state.flags.jacketSearched).toBe(true);
    expect(r.events).toContainEqual({ type: 'PUZZLE_SOLVED', puzzle: 'hallway' });
    expect(r.events).toContainEqual({ type: 'WARMTH_CHANGED', level: 2 });
    expect(r.state.warmth).toBe(2);

    r = play(r.state, 'take key');
    expect(r.state.inventory).toContain('bedroomKey');
    r = play(r.state, 'go north');
    expect(r.state.room).toBe('boyhoodBedroom');
  });

  it('accepts 555-0142, DIAL NUMBER and call', () => {
    for (const line of ['dial 555-0142', 'dial 555 0142', 'dial number', 'call 5550142', 'dial pager']) {
      expect(play(startInHallway(), line).state.flags.messageHeard, line).toBe(true);
    }
  });

  it('the message text matches the voice manifest (4.2)', () => {
    const manifest = JSON.parse(readFileSync('content/voice-lines.json', 'utf8')) as { lines: { id: string; text: string }[] };
    const text = (id: string) => manifest.lines.find((l) => l.id === id)!.text;
    expect(describeMessage('hallway:dial_correct', content)).toContain(text('hallway_message_young_dad'));
    expect(describeMessage('hallway:dial_grandma', content)).toContain(text('hallway_greeting_grandma'));
  });

  it('works with bible synonyms (unzip pocket)', () => {
    const r = play(startInHallway(), 'open closet', 'unzip pocket', 'take key');
    expect(r.state.inventory).toContain('bedroomKey');
    expect(r.state.warmth).toBe(2);
  });
});

describe('hallway: jacket pockets', () => {
  it('outer pocket gives the quarter decoy and not the key (4.6)', () => {
    const r = play(startInHallway(), 'open closet', 'search jacket', 'take quarter');
    expect(r.state.inventory).toContain('emergencyQuarter');
    expect(r.state.itemLocations.bedroomKey).toBe('hidden');
    expect(r.state.warmth).toBe(1);
    expect(r.state.flags.jacketSearched).toBeFalsy();
  });

  it('searching the outer pocket directly also gives the quarter only', () => {
    const r = play(startInHallway(), 'open closet', 'search outer pocket');
    expect(r.state.itemLocations.emergencyQuarter).toBe('hallway');
    expect(r.state.itemLocations.bedroomKey).toBe('hidden');
  });

  it('a second jacket or pocket search is harmless', () => {
    const r = play(startInHallway(), 'open closet', 'search jacket', 'search jacket', 'search outer pocket');
    expect(msgIds(r.events)).toEqual(['hallway:outer_pocket_empty']);
    const k = play(r.state, 'unzip pocket', 'unzip pocket');
    expect(msgIds(k.events)).toEqual(['hallway:inner_pocket_empty']);
  });

  it('the inside pocket works without searching the jacket or hearing the message first', () => {
    const r = play(startInHallway(), 'open closet', 'search inside pocket', 'take key');
    expect(r.state.inventory).toContain('bedroomKey');
    expect(r.state.flags.messageHeard).toBeFalsy();
  });
});

describe('hallway: wrong numbers and wrong order (4.3, 9.4)', () => {
  it('different wrong numbers give distinct in-character results and never the message', () => {
    const seen = new Set<string>();
    for (const n of ['5550000', '5550001', '5550002', '5551234', '5559999']) {
      const r = play(startInHallway(), `dial ${n}`);
      expect(r.state.flags.messageHeard).toBeFalsy();
      seen.add(msgIds(r.events)[0]!);
    }
    expect(seen).toEqual(new Set(['hallway:dial_busy', 'hallway:dial_stranger', 'hallway:dial_grandma']));
    for (const id of seen) expect(describeMessage(id, content)).toBeTruthy();
  });

  it('dialing nothing, a name, or too few digits recovers with a message', () => {
    expect(msgIds(play(startInHallway(), 'dial').events)).toEqual(['hallway:dial_which']);
    expect(msgIds(play(startInHallway(), 'dial phone').events)).toEqual(['hallway:dial_which']);
    expect(msgIds(play(startInHallway(), 'dial mom').events)).toEqual(['hallway:dial_not_a_number']);
    expect(msgIds(play(startInHallway(), 'dial 911').events)).toEqual(['hallway:dial_short']);
  });

  it('the pockets and jacket are out of reach until the closet is open', () => {
    expect(msgIds(play(startInHallway(), 'search jacket').events)).toEqual(['hallway:jacket_out_of_reach']);
    expect(msgIds(play(startInHallway(), 'unzip pocket').events)).toEqual(['hallway:jacket_out_of_reach']);
  });

  it('the machine does not play until called, then replays on demand', () => {
    expect(msgIds(play(startInHallway(), 'play machine').events)).toEqual(['hallway:machine_dead_play']);
    const r = play(startInHallway(), 'dial 5550142', 'play machine');
    expect(msgIds(r.events)).toEqual(['hallway:machine_replay']);
    expect(r.events).toContainEqual({ type: 'SILENCE_BEAT' });
  });

  it('decoys give their lines and no key', () => {
    const r = play(startInHallway(), 'search bowl of keys', 'search yellow pages', 'search rolodex', 'search umbrella stand', 'search wall calendar');
    expect(r.state.itemLocations.bedroomKey).toBe('hidden');
    expect(r.state.warmth).toBe(1);
  });

  it('the room keeps its state when the player leaves and returns', () => {
    const r = play(startInHallway(), 'open closet', 'search jacket', 'go down', 'go up');
    expect(r.state.itemLocations.jacket).toBe('hallway');
    expect(r.state.itemLocations.emergencyQuarter).toBe('hallway');
  });

  it('property: no hallway command sequence throws or leaves the key unreachable', () => {
    const lines = [
      'examine pager', 'dial 5550142', 'dial 5550001', 'dial 5550002', 'dial mom', 'dial', 'play machine', 'open closet',
      'search jacket', 'search outer pocket', 'search inside pocket', 'unzip pocket', 'take key', 'take quarter', 'drop quarter',
      'examine jacket', 'look',
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...lines), { maxLength: 25 }), (seq) => {
        let s = startInHallway();
        for (const line of seq) {
          const p = parse(line, content);
          if (!p.ok) continue;
          s = step(s, p.command, content).newState;
        }
        // From any reachable state the solve is still available.
        const tail = play(s, 'open closet', 'unzip pocket', 'take key');
        return tail.state.inventory.includes('bedroomKey') && tail.state.flags.jacketSearched === true;
      }),
      { numRuns: 150 },
    );
  });
});
