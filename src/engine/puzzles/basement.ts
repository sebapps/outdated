// Puzzle 1: Basement (tutorial: use item on item). Requirements 3.1-3.6.
//
// Flow: TAKE pencil -> REWIND tape WITH pencil -> INSERT tape (into Walkman) -> PLAY Walkman
//       -> SEARCH cartridge box -> SEARCH foam -> TAKE key (hallway key).
// The cartridge box hides a foam insert, and the foam hides the key (see content/items.json),
// so the generic SEARCH handler does the reveal; this module owns everything about the tape.
//
// Flags (design.md): hasPencil, tapeRewound, tapeLoaded, tapePlayed, atariBoxSearched.
// Extra optional flag: batteriesInstalled (the battery gate; it never blocks, see `play`).
// Cassette item states: 'tangled' -> 'rewound' -> 'loaded'. While loaded the cassette sits
// inside the Walkman (itemLocations.cassette === 'walkman') and REMOVE/TAKE ejects it, so
// no ordering of commands can strand the tape.
import { isInScope } from '../world';
import type { LoadedContent } from '../content/types';
import type { EngineEvent, GameState } from '../state';
import type { PuzzleHandler, PuzzleModule } from './types';
import { collectKey, msg, refers } from './util';

const PENCIL = 'pencil';
const CASSETTE = 'cassette';
const WALKMAN = 'walkman';
const JAR = 'batteryJar';
const KEY = 'hallwayKey';

/** Dad's recorded clue. Same text as `basement_tape_dad` in content/voice-lines.json. */
export const DAD_TAPE_TEXT =
  "Okay, is this thing recording? Good. Here's a secret from the very first video games. Someone hid a room in one, just to sign their name. Nobody told them to. So when you're looking for something, don't look where everybody looks. Look under the things you'd never think to lift.";

const messages: Record<string, string> = {
  'basement:rewind_needs_tool':
    "Rewind it with what? You'll need something long, thin and slightly chewed. Every kid in the '80s kept one nearby.",
  'basement:wrong_tool': "That won't fit in the spool. You need something long, thin and hexagonal.",
  'basement:pick_up_pencil': 'The pencil is still in the coffee can. Pick it up first. Gripping things is step one of technology.',
  'basement:tape_rewound':
    'You poke the pencil into the spool and crank. The tangle winds back in, shiny side out. Fifty years of technology and the best tool is still a pencil. The pencil goes back in your pocket.',
  'basement:tape_tangled_insert':
    "You can't load that. It's a brown, shiny tangle, and the Walkman would chew it into spaghetti. It needs rewinding first, and every kid in the '80s knew what to use for that: a pencil.",
  'basement:tape_tangled_play':
    "Play a tangled tape? That's not music, that's a bird's nest. It needs rewinding first. Something pencil-shaped would do the job.",
  'basement:tape_loaded': 'You snap the cassette into the Walkman and close the door. Clunk. It is ready to play.',
  'basement:already_loaded': 'The cassette is already in the Walkman. PLAY it, or REMOVE it to get it back.',
  'basement:walkman_empty': 'The Walkman is empty. It needs a cassette.',
  'basement:walkman_empty_tape_ready': 'The Walkman is empty. The rewound cassette would fit nicely, though.',
  'basement:walkman_loaded': 'A chunky portable cassette player with a rewound cassette snapped inside.',
  'basement:batteries_installed': 'You fish the one working pair out of the jar and snap it into the Walkman. The little door clicks shut.',
  'basement:batteries_auto':
    'The Walkman is dead. You dig through the jar of batteries and find exactly one working pair. Of course there is exactly one.',
  'basement:dad_tape': `The tape hisses, and then a familiar voice, younger than you remember, fills the basement.\n\n"${DAD_TAPE_TEXT}"\n\nClick. The tape runs out.`,
  'basement:stopped': 'You press STOP. The Walkman clicks and goes quiet.',
  'basement:nothing_playing': 'Nothing is playing.',
  'basement:tape_ejected': 'The cassette pops out of the Walkman and into your hand.',
  'basement:nothing_to_eject': 'There is nothing to take out.',
  'basement:key_found': 'Under the foam, taped flat to the bottom of the box, is a small brass key.',
};

const loaded = (state: GameState): boolean => state.itemStates[CASSETTE] === 'loaded';

/** Cassette and Walkman references, ignoring where the items are. */
const isTape = (c: LoadedContent, phrase: string | undefined): boolean => refers(c, phrase, CASSETTE);
const isWalkman = (c: LoadedContent, phrase: string | undefined): boolean => refers(c, phrase, WALKMAN);

function rewind(state: GameState, content: LoadedContent, tapePhrase: string | undefined, toolPhrase: string | undefined): EngineEvent[] | undefined {
  if (tapePhrase === undefined) return [msg('need_object')];
  if (!isTape(content, tapePhrase)) return undefined;
  if (loaded(state)) return [msg('already_done')];
  if (!isInScope(state, CASSETTE)) return [msg('not_here')];
  if (state.itemStates[CASSETTE] === 'rewound') return [msg('already_done')];

  if (toolPhrase === undefined) {
    if (!state.inventory.includes(PENCIL)) return [msg('basement:rewind_needs_tool')];
  } else if (!refers(content, toolPhrase, PENCIL)) {
    return [msg('basement:wrong_tool')];
  } else if (!state.inventory.includes(PENCIL)) {
    return [msg(isInScope(state, PENCIL) ? 'basement:pick_up_pencil' : 'not_here')];
  }

  // The pencil is only ever used, never consumed.
  state.itemStates[CASSETTE] = 'rewound';
  state.flags.tapeRewound = true;
  return [
    { type: 'SOUND', cue: 'tape_hiss', caption: '[a pencil cranks the tape back onto the spool]' },
    msg('basement:tape_rewound'),
  ];
}

function installBatteries(state: GameState): EngineEvent[] {
  if (!isInScope(state, WALKMAN)) return [msg('not_here')];
  if (state.flags.batteriesInstalled) return [msg('already_done')];
  state.flags.batteriesInstalled = true;
  return [msg('basement:batteries_installed')];
}

function load(state: GameState): EngineEvent[] {
  if (loaded(state)) return [msg('basement:already_loaded')];
  if (!isInScope(state, WALKMAN) || !isInScope(state, CASSETTE)) return [msg('not_here')];
  if (state.itemStates[CASSETTE] === 'tangled') return [msg('basement:tape_tangled_insert')];
  state.itemStates[CASSETTE] = 'loaded';
  state.inventory = state.inventory.filter((i) => i !== CASSETTE);
  state.itemLocations[CASSETTE] = 'walkman';
  state.flags.tapeLoaded = true;
  return [{ type: 'SOUND', cue: 'tape_clunk', caption: '[cassette clunks into the Walkman]' }, msg('basement:tape_loaded')];
}

function eject(state: GameState): EngineEvent[] {
  if (!loaded(state)) return [msg('basement:nothing_to_eject')];
  state.itemStates[CASSETTE] = 'rewound';
  state.itemLocations[CASSETTE] = 'inventory';
  state.inventory.push(CASSETTE);
  state.flags.tapeLoaded = false;
  return [{ type: 'SOUND', cue: 'tape_clunk', caption: '[cassette pops out]' }, msg('basement:tape_ejected')];
}

const insert: PuzzleHandler = (state, command, content) => {
  const { directObject: d, indirectObject: i } = command;
  if (refers(content, d, JAR) || refers(content, i, JAR)) return installBatteries(state);
  if (isTape(content, d) || isWalkman(content, d) || isTape(content, i) || isWalkman(content, i)) return load(state);
  return undefined;
};

const play: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (d === undefined ? !(isInScope(state, WALKMAN)) : !(isTape(content, d) || isWalkman(content, d))) return undefined;

  if (!loaded(state)) {
    if (isInScope(state, CASSETTE)) {
      return [msg(state.itemStates[CASSETTE] === 'tangled' ? 'basement:tape_tangled_play' : 'basement:walkman_empty_tape_ready')];
    }
    return [msg('basement:walkman_empty')];
  }

  const events: EngineEvent[] = [];
  // Optional battery gate: dead batteries are a joke, never a wall.
  if (!state.flags.batteriesInstalled) {
    state.flags.batteriesInstalled = true;
    events.push(msg('basement:batteries_auto'));
  }
  state.flags.tapePlayed = true;
  events.push(
    { type: 'SOUND', cue: 'tape_hiss', caption: '[tape hiss]' },
    { type: 'SOUND', cue: 'dad_voice', caption: "[Dad's voice on the cassette]" },
    msg('basement:dad_tape'),
  );
  return events;
};

const stop: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (!(isTape(content, d) || isWalkman(content, d))) return undefined;
  return [msg(loaded(state) ? 'basement:stopped' : 'basement:nothing_playing')];
};

const remove: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (!(isTape(content, d) || isWalkman(content, d))) return undefined;
  return eject(state);
};

/** Taking a loaded cassette ejects it, so "take tape" always works. */
const take: PuzzleHandler = (state, command, content) =>
  loaded(state) && isTape(content, command.directObject) ? eject(state) : undefined;

const examine: PuzzleHandler = (state, command, content) => {
  if (!loaded(state)) return undefined;
  if (isTape(content, command.directObject)) return [msg(`item:${CASSETTE}:loaded`)];
  if (isWalkman(content, command.directObject)) return [msg('basement:walkman_loaded')];
  return undefined;
};

/** USE pencil ON cassette, USE cassette ON Walkman, USE batteries ON Walkman. */
const use: PuzzleHandler = (state, command, content) => {
  const { directObject: d, indirectObject: i } = command;
  const pair = (a: (c: LoadedContent, p: string | undefined) => boolean, b: (c: LoadedContent, p: string | undefined) => boolean) =>
    (a(content, d) && b(content, i)) || (b(content, d) && a(content, i));
  const pencil = (c: LoadedContent, p: string | undefined) => refers(c, p, PENCIL);
  const jar = (c: LoadedContent, p: string | undefined) => refers(c, p, JAR);
  if (pair(pencil, isTape)) return rewind(state, content, isTape(content, d) ? d : i, 'pencil');
  if (pair(isTape, isWalkman)) return load(state);
  if (pair(jar, isWalkman)) return installBatteries(state);
  return undefined;
};

const rewindVerb: PuzzleHandler = (state, command, content) =>
  rewind(state, content, command.directObject, command.indirectObject);

export const basementPuzzle: PuzzleModule = {
  room: 'basement',
  handlers: {
    REWIND: rewindVerb,
    INSERT: insert,
    PLAY: play,
    STOP: stop,
    REMOVE: remove,
    TAKE: take,
    EXAMINE: examine,
    USE: use,
  },
  messages,
  afterStep(state) {
    const events: EngineEvent[] = [];
    if (state.inventory.includes(PENCIL)) state.flags.hasPencil = true;

    const keyFound = state.itemLocations[KEY] !== undefined && state.itemLocations[KEY] !== 'hidden';
    if (keyFound && !state.flags.atariBoxSearched) {
      state.flags.atariBoxSearched = true;
      events.push(msg('basement:key_found'), ...collectKey(state, KEY), { type: 'PUZZLE_SOLVED', puzzle: 'basement' });
      if (state.warmth < 1) {
        state.warmth = 1;
        events.push({ type: 'WARMTH_CHANGED', level: 1 });
      }
    }
    return events;
  },
};
