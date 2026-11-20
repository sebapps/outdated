// Puzzle 2: Hallway (teaches: interact with a machine, deduce from a message). Requirements 4.1-4.6.
//
// Flow: EXAMINE pager (555-0142) -> DIAL 5550142 -> ring, answering machine plays young Dad's
//       message -> silence beat -> OPEN closet -> SEARCH jacket (outer pocket: emergency quarter,
//       a decoy) -> SEARCH / UNZIP inside pocket -> bedroom key.
//
// Flags (design.md): pagerRead, numberDialed, messageHeard, jacketSearched.
// Nothing is gated on the message: the closet, jacket and pockets can be searched in any order,
// and the phone can be dialed again and again, so no ordering of commands strands the player.
// The generic OPEN handler reveals the jacket from the closet (see content/items.json); this
// module owns the phone, the pockets, and taking the bedroom key (the hallway key in hand
// shares the "key" alias, so a bare TAKE KEY would otherwise be ambiguous).
import { isInScope } from '../world';
import type { EngineEvent, GameState } from '../state';
import type { PuzzleHandler, PuzzleModule } from './types';
import { collectKey, msg, refers } from './util';

const PAGER = 'pager';
const JACKET = 'jacket';
const OUTER = 'outerPocket';
const INNER = 'innerPocket';
const QUARTER = 'emergencyQuarter';
const KEY = 'bedroomKey';
const MACHINE = 'answeringMachine';
const PHONE = 'rotaryPhone';

/** The pager's number, digits only. */
export const PAGER_NUMBER = '5550142';

/** Young Dad's message. Same text as `hallway_message_young_dad` in content/voice-lines.json. */
export const YOUNG_DAD_MESSAGE_TEXT =
  "Hi, Mom, it's me. I'm at Kevin's. We're gonna be here, like, forever. Also, the thing is in my lucky jacket. No, I'm not telling you which pocket, because you snoop. Okay. Bye. Don't snoop.";

/** Grandma's old greeting. Same text as `hallway_greeting_grandma` in content/voice-lines.json. */
export const GRANDMA_GREETING_TEXT =
  "Hello, you've reached our house. We can't come to the phone right now, so please leave your name and number after the beep.";

const messages: Record<string, string> = {
  'hallway:pager':
    'Grandpa\'s work pager. The little screen shows 555-0142. A beeper was for when people needed to find you but did not want to hear your voice. Somebody wants to be called back.',
  'hallway:dial_which':
    'Dial what? The rotary phone needs seven digits, and a beeper in the room is practically begging to supply them.',
  'hallway:dial_not_a_number':
    'You spin the dial for a name. The rotary phone only knows numbers. Seven digits, no more, no fewer, no "Mom."',
  'hallway:dial_short':
    'You dial a handful of digits and give up. The line makes a sad little clunk. A phone number in 1987 was seven digits, and every one of them was earned.',
  'hallway:dial_busy':
    'The dial whirs back after every digit, then: beep, beep, beep, beep. Busy. Somebody in 1987 is talking to their cousin for the third hour in a row. Hang up and try a different number.',
  'hallway:dial_stranger':
    'It rings twice, then a gruff stranger picks up. "Yeah? ...Who is this? Look, if this is about the lawn, I already told Gerald it was not my dog." Click. You have been hung up on by the past.',
  'hallway:dial_grandma': `It rings, clicks, and an old recording picks up. A warm voice, a little crackly:\n\n"${GRANDMA_GREETING_TEXT}"\n\nBeep. You have nothing to say to a greeting from before you were born. You hang up. Maybe the number on the pager would get a different answer.`,
  'hallway:dial_correct': `Seven digits, seven slow whirs back. A ring. Another. Then a click, and the answering machine on the table wakes up. The red light stops blinking and holds steady.\n\nBeep.\n\nThe voice on the tape is a boy's, high and in a hurry.\n\n"${YOUNG_DAD_MESSAGE_TEXT}"\n\nThe tape runs out. Click.`,
  'hallway:machine_dead_play':
    'The light blinks, but the PLAY button is stuck under years of dust. The machine seems to want a caller, not a listener. There is a phone right there, and a number on a pager.',
  'hallway:machine_replay': `You press the button and the tape rewinds with a whine, then plays again.\n\n"${YOUNG_DAD_MESSAGE_TEXT}"\n\nThe tape runs out. Click.`,
  'hallway:jacket_out_of_reach':
    'You do not see a jacket within reach. The coat closet is slightly ajar, though, with a sleeve showing. Try opening it first.',
  'hallway:jacket_searched':
    'You go through the jacket, starting with the outer pocket. You find an emergency quarter. Always keep an emergency quarter. There is also a zippered pocket sewn inside, shut tight.',
  'hallway:jacket_searched_again':
    'You pat down the jacket again. The outer pocket is empty, and the zippered pocket inside is still zipped shut.',
  'hallway:inner_pocket_key':
    'You unzip the pocket sewn into the lining. Folded flat inside, tucked behind a ticket stub, is a silver key on a loop of yarn, tagged BEDROOM. A secret pocket for a secret plan.',
  'hallway:inner_pocket_empty': 'You unzip the inside pocket again. Just lining and a ticket stub. Whatever was in here is already in your hands.',
  'hallway:outer_pocket_empty': 'The outer pocket is empty, unless you count lint. It is not a clue, it is lint.',
};

const heard = (state: GameState): boolean => state.flags.messageHeard === true;

function dialCorrect(state: GameState): EngineEvent[] {
  state.flags.numberDialed = true;
  state.flags.messageHeard = true;
  return [
    { type: 'SOUND', cue: 'dial_clicks', caption: '[rotary dial clicks]' },
    { type: 'SOUND', cue: 'phone_ring', caption: '[a phone rings twice]' },
    { type: 'SOUND', cue: 'machine_beep', caption: '[answering machine beep]' },
    msg('hallway:dial_correct'),
    { type: 'SILENCE_BEAT' },
  ];
}

/** Wrong numbers each get a distinct result, picked by the digits (deterministic, no randomness). */
function dialWrong(digits: string): EngineEvent[] {
  const pick = [...digits].reduce((sum, d) => sum + Number(d), 0) % 3;
  const clicks: EngineEvent = { type: 'SOUND', cue: 'dial_clicks', caption: '[rotary dial clicks]' };
  if (pick === 0) {
    return [clicks, { type: 'SOUND', cue: 'machine_beep', caption: '[a busy signal: beep, beep, beep]' }, msg('hallway:dial_busy')];
  }
  if (pick === 1) {
    return [clicks, { type: 'SOUND', cue: 'phone_ring', caption: '[a phone rings twice, then a stranger answers]' }, msg('hallway:dial_stranger')];
  }
  return [
    clicks,
    { type: 'SOUND', cue: 'phone_ring', caption: '[a phone rings, then an old recording clicks on]' },
    { type: 'SOUND', cue: 'machine_beep', caption: '[answering machine beep]' },
    msg('hallway:dial_grandma'),
  ];
}

const dial: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (d === undefined) return [msg('hallway:dial_which')];
  if (refers(content, d, PAGER) || /^(the |that |this )?(pager |beeper )?number$/.test(d)) return dialCorrect(state);
  const digits = d.replace(/\D/g, '');
  if (digits === '') {
    // "dial phone" is a request for a number, not a number.
    return [msg(refers(content, d, PHONE) ? 'hallway:dial_which' : 'hallway:dial_not_a_number')];
  }
  if (digits.length < 7) return [msg('hallway:dial_short')];
  if (digits === PAGER_NUMBER) return dialCorrect(state);
  return dialWrong(digits);
};

const examine: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (refers(content, d, PAGER) && isInScope(state, PAGER)) {
    state.flags.pagerRead = true;
    return [msg('hallway:pager')];
  }
  if ((refers(content, d, INNER) || refers(content, d, OUTER)) && !isInScope(state, JACKET)) {
    return [msg('hallway:jacket_out_of_reach')];
  }
  return undefined;
};

/** SEARCH jacket / outer pocket: the quarter (a decoy). Reveals the pockets too. */
function searchJacket(state: GameState): EngineEvent[] {
  if (state.itemLocations[QUARTER] !== 'hidden') return [msg('hallway:jacket_searched_again')];
  const events: EngineEvent[] = [];
  for (const id of [QUARTER, OUTER, INNER]) {
    if (state.itemLocations[id] === 'hidden') state.itemLocations[id] = state.room;
  }
  events.push({ type: 'ITEM_SEARCHED', item: JACKET, found: QUARTER }, msg('hallway:jacket_searched'));
  return events;
}

/** SEARCH / OPEN / UNZIP inside pocket: the bedroom key. */
function openInnerPocket(state: GameState): EngineEvent[] {
  if (state.itemLocations[KEY] !== 'hidden') return [msg('hallway:inner_pocket_empty')];
  state.itemLocations[KEY] = state.room;
  if (state.itemLocations[INNER] === 'hidden') state.itemLocations[INNER] = state.room;
  return [{ type: 'ITEM_SEARCHED', item: INNER, found: KEY }, msg('hallway:inner_pocket_key')];
}

const search: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  const jacket = refers(content, d, JACKET);
  const outer = refers(content, d, OUTER);
  const inner = refers(content, d, INNER);
  if (!jacket && !outer && !inner) return undefined;
  if (!isInScope(state, JACKET)) return [msg('hallway:jacket_out_of_reach')];
  if (inner) return openInnerPocket(state);
  if (outer && state.itemLocations[QUARTER] !== 'hidden') return [msg('hallway:outer_pocket_empty')];
  return searchJacket(state);
};

const open: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (refers(content, d, INNER)) {
    return isInScope(state, JACKET) ? openInnerPocket(state) : [msg('hallway:jacket_out_of_reach')];
  }
  if (refers(content, d, OUTER)) {
    return isInScope(state, JACKET) ? search(state, command, content) : [msg('hallway:jacket_out_of_reach')];
  }
  // OPEN jacket just means going through it.
  if (refers(content, d, JACKET) && isInScope(state, JACKET)) return searchJacket(state);
  return undefined;
};

/** TAKE key while holding the hallway key: the bedroom key on the floor wins. */
const take: PuzzleHandler = (state, command, content) => {
  if (!refers(content, command.directObject, KEY) || state.inventory.includes(KEY)) return undefined;
  if (state.itemLocations[KEY] !== state.room) return undefined;
  state.inventory.push(KEY);
  state.itemLocations[KEY] = 'inventory';
  return [{ type: 'ITEM_TAKEN', item: KEY }, msg(`taken:${KEY}`)];
};

/** PLAY / PRESS the machine: replays the message once heard, otherwise points at the phone. */
const playMachine: PuzzleHandler = (state, command, content) => {
  if (!refers(content, command.directObject, MACHINE)) return undefined;
  if (!heard(state)) return [msg('hallway:machine_dead_play')];
  return [
    { type: 'SOUND', cue: 'machine_beep', caption: '[answering machine beep]' },
    msg('hallway:machine_replay'),
    { type: 'SILENCE_BEAT' },
  ];
};

export const hallwayPuzzle: PuzzleModule = {
  room: 'hallway',
  handlers: {
    DIAL: dial,
    EXAMINE: examine,
    SEARCH: search,
    OPEN: open,
    TAKE: take,
    PLAY: playMachine,
    PRESS: playMachine,
  },
  messages,
  afterStep(state) {
    const events: EngineEvent[] = [];
    const keyFound = state.itemLocations[KEY] !== undefined && state.itemLocations[KEY] !== 'hidden';
    if (keyFound && !state.flags.jacketSearched) {
      state.flags.jacketSearched = true;
      events.push(...collectKey(state, KEY), { type: 'PUZZLE_SOLVED', puzzle: 'hallway' });
      if (state.warmth < 2) {
        state.warmth = 2;
        events.push({ type: 'WARMTH_CHANGED', level: 2 });
      }
    }
    return events;
  },
};
