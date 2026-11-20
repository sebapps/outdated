// Puzzle 4: Study (teaches: do the "wrong" thing on purpose). Requirements 6.1-6.5, 9.4.
//
// Flow: FIND cord / SEARCH bookshelf -> PLUG IN turntable -> PLAY record (gibberish, a quip)
//       -> REVERSE record (the message, a silence beat) -> OPEN disk box -> grandparents' key.
//
// Flags (design.md): turntablePlugged, recordPlayedForward (optional), recordReversed, diskBoxOpened.
// Helper flags: recordBackwards (the platter is turning the wrong way), recordScratched.
// Gates: the turntable needs the cord found and plugged in (6.1); the disk box stays shut until the
// reversed message has been heard (6.4). The generic OPEN/SEARCH handlers do the reveals
// (bookshelf -> cord, disk box -> key); this module owns the turntable, the gates, and taking the key.
// Soft-lock safety (6.5, 9.4): over-spinning scratches the record, and FLIP RECORD (or RESET) always
// restores it, plugged in or not. Nothing here removes the cord, so the turntable never becomes unusable.
import { isInScope } from '../world';
import type { EngineEvent, GameState } from '../state';
import type { PuzzleHandler, PuzzleModule } from './types';
import { collectKey, msg, refers } from './util';

const TURNTABLE = 'turntable';
const RECORD = 'record';
const CONSOLE = 'hifiConsole';
const CORD = 'turntableCord';
const BOOKSHELF = 'bookshelf';
const DISK_BOX = 'diskBox';
const KEY = 'grandparentsKey';

/** Young Dad's message. Same text as `study_record_clear` in content/voice-lines.json. */
export const REVERSED_MESSAGE_TEXT =
  "Testing, testing. This is me, on a record. I hid the thing where Dad would never dare to look. If you're hearing this backwards, you're either very clever or very bored.";

const messages: Record<string, string> = {
  'study:cord_found':
    'You squeeze behind the bookshelf, past a decade of dust and one very surprised spider. A power cord dangles there, ending in a plug. It looks like it belongs to the turntable.',
  'study:cord_known': 'You already found the cord behind the bookshelf. It is the turntable\'s, and it wants a socket.',
  'study:no_cord':
    'Plug in what? The turntable\'s cord is nowhere in sight. Something dangles behind the bookshelf, though, if you look back there.',
  'study:plugged':
    'You feed the cord out from behind the bookshelf and push the plug into the wall socket. A hum, a click, and the platter begins to turn with the record on it. The 1980s say hello.',
  'study:already_plugged': 'The turntable is already plugged in, and the platter is turning.',
  'study:no_power': 'Nothing happens. The turntable has no power, and the platter sits there like a dinner plate. Its cord is not plugged in.',
  'study:forward':
    'You lower the needle and the record answers with mush, like a cat walking across a keyboard. It is not English. Not yet.',
  'study:forward_again': 'The needle drops again. Same mush. The cat has found the keyboard again.',
  'study:reversed': `You grab the record and turn it against its grain, counterclockwise, slow and steady. The warble sorts itself into a boy's voice, proud as a peacock and trying not to giggle.\n\n"${REVERSED_MESSAGE_TEXT}"\n\nThe needle ticks in the final groove.`,
  'study:reversed_again': `You turn the record backwards again and the voice comes back.\n\n"${REVERSED_MESSAGE_TEXT}"\n\nThe needle ticks in the final groove.`,
  'study:scratched':
    'You keep spinning, and the needle skips and screeches across the grooves. That is a scratch. The record is skipping now. It is not broken, though. FLIP RECORD would give it a fresh side.',
  'study:scratched_skip': 'The record skips and crackles, scratched from all that spinning. FLIP RECORD, or RESET it, and the groove will be fine.',
  'study:flip_restore':
    'You lift the record, flip it over, and set it back on the platter. The scratch is on the other side now, and the surface is smooth. Good as old.',
  'study:flip_clean': 'You flip the record over and set it back down. Same record, same smell of 1985. The platter keeps turning.',
  'study:stopped': 'You lift the needle. The platter slows and the record settles.',
  'study:nothing_playing': 'Nothing is playing.',
  'study:turntable_plugged': 'A turntable with a record on the platter. The cord is plugged in and the platter is ready.',
  'study:disk_box_shut':
    'You reach for the lid and freeze. The sticky note on the monitor says DO NOT TOUCH MY DISKS, in handwriting that has ended arguments. Nobody would dare. Somebody who did dare is the whole story.',
  'study:key_found':
    'You lift the lid of the disk box. Taped inside, flat and a little yellowed, is an iron key tagged GRANDPARENTS. Dad had hidden it right under a sign that said not to. He really was proud of himself.',
};

const plugged = (state: GameState): boolean => state.flags.turntablePlugged === true;
const cordFound = (state: GameState): boolean =>
  state.itemLocations[CORD] !== undefined && state.itemLocations[CORD] !== 'hidden';

const isPlayer = (content: Parameters<typeof refers>[0], p: string | undefined): boolean =>
  refers(content, p, TURNTABLE) || refers(content, p, RECORD) || refers(content, p, CONSOLE);

function findCord(state: GameState): EngineEvent[] {
  if (cordFound(state)) return [msg('study:cord_known')];
  state.itemLocations[CORD] = state.room;
  state.flags[`searched:${BOOKSHELF}`] = true;
  return [{ type: 'ITEM_SEARCHED', item: BOOKSHELF, found: CORD }, msg('study:cord_found')];
}

const find: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (refers(content, d, CORD) || refers(content, d, BOOKSHELF)) return findCord(state);
  return undefined;
};

const plug: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (!isPlayer(content, d) && !refers(content, d, CORD)) return undefined;
  if (plugged(state)) return [msg('study:already_plugged')];
  if (!cordFound(state)) return [msg('study:no_cord')];
  state.flags.turntablePlugged = true;
  return [{ type: 'SOUND', cue: 'tape_clunk', caption: '[a plug slides home; the platter hums to life]' }, msg('study:plugged')];
};

const play: PuzzleHandler = (state, command, content) => {
  if (!isPlayer(content, command.directObject)) return undefined;
  if (!plugged(state)) return [msg('study:no_power')];
  if (state.flags.recordScratched) return [msg('study:scratched_skip')];
  const again = state.flags.recordPlayedForward === true;
  state.flags.recordPlayedForward = true;
  state.flags.recordBackwards = false;
  return [
    { type: 'SOUND', cue: 'tape_hiss', caption: '[a garbled, warbling voice from the speakers]' },
    msg(again ? 'study:forward_again' : 'study:forward'),
  ];
};

const stop: PuzzleHandler = (state, command, content) => {
  if (!isPlayer(content, command.directObject)) return undefined;
  if (!plugged(state) || !state.flags.recordBackwards) return [msg('study:nothing_playing')];
  state.flags.recordBackwards = false;
  return [msg('study:stopped')];
};

const reverse: PuzzleHandler = (state, command, content) => {
  if (!isPlayer(content, command.directObject)) return undefined;
  if (!plugged(state)) return [msg('study:no_power')];
  if (state.flags.recordScratched) return [msg('study:scratched_skip')];
  if (state.flags.recordBackwards) {
    // Over-spinning scratches the record. FLIP or RESET puts it right (6.5).
    state.flags.recordScratched = true;
    state.flags.recordBackwards = false;
    return [{ type: 'SOUND', cue: 'static_burst', caption: '[the needle screeches across the record]' }, msg('study:scratched')];
  }
  const again = state.flags.recordReversed === true;
  state.flags.recordReversed = true;
  state.flags.recordBackwards = true;
  return [
    { type: 'SOUND', cue: 'record_reversed', caption: "[a boy's voice, playing backwards]" },
    msg(again ? 'study:reversed_again' : 'study:reversed'),
    { type: 'SILENCE_BEAT' },
  ];
};

/** FLIP RECORD / RESET RECORD: always restores a scratched record, with or without power. */
const flip: PuzzleHandler = (state, command, content) => {
  if (!isPlayer(content, command.directObject)) return undefined;
  const wasScratched = state.flags.recordScratched === true;
  state.flags.recordScratched = false;
  state.flags.recordBackwards = false;
  return [msg(wasScratched ? 'study:flip_restore' : 'study:flip_clean')];
};

const examine: PuzzleHandler = (state, command, content) => {
  if (refers(content, command.directObject, TURNTABLE) && isInScope(state, TURNTABLE) && plugged(state)) {
    return [msg('study:turntable_plugged')];
  }
  return undefined;
};

/** OPEN / SEARCH disk box: sealed until the reversed message has been heard (6.4), then the generic reveal. */
const gateDiskBox: PuzzleHandler = (state, command, content) => {
  if (!refers(content, command.directObject, DISK_BOX) || !isInScope(state, DISK_BOX)) return undefined;
  return state.flags.recordReversed ? undefined : [msg('study:disk_box_shut')];
};

/** TAKE key prefers the grandparents' key on the floor (other keys in hand share the "key" alias). */
const take: PuzzleHandler = (state, command, content) => {
  if (!refers(content, command.directObject, KEY) || state.inventory.includes(KEY)) return undefined;
  if (state.itemLocations[KEY] !== state.room) return undefined;
  state.inventory.push(KEY);
  state.itemLocations[KEY] = 'inventory';
  return [{ type: 'ITEM_TAKEN', item: KEY }, msg(`taken:${KEY}`)];
};

export const studyPuzzle: PuzzleModule = {
  room: 'study',
  handlers: {
    FIND: find,
    PLUG: plug,
    PLAY: play,
    PRESS: play,
    STOP: stop,
    REVERSE: reverse,
    FLIP: flip,
    SET: flip,
    EXAMINE: examine,
    OPEN: gateDiskBox,
    SEARCH: gateDiskBox,
    TAKE: take,
  },
  messages,
  afterStep(state) {
    const events: EngineEvent[] = [];
    const keyFound = state.itemLocations[KEY] !== undefined && state.itemLocations[KEY] !== 'hidden';
    if (keyFound && !state.flags.diskBoxOpened) {
      state.flags.diskBoxOpened = true;
      events.push(msg('study:key_found'), ...collectKey(state, KEY), { type: 'PUZZLE_SOLVED', puzzle: 'study' });
      if (state.warmth < 3) {
        state.warmth = 3;
        events.push({ type: 'WARMTH_CHANGED', level: 3 });
      }
    }
    return events;
  },
};
