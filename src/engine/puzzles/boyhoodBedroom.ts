// Puzzle 3: Dad's boyhood bedroom (teaches: the odd verb is right). Requirements 5.1-5.5.
//
// Flow: INSERT cartridge -> PRESS power (flickers and fails) -> BLOW on cartridge -> INSERT
//       cartridge -> PRESS power (boots: title card) -> OPEN toybox -> UNFOLD trailer
//       -> SEARCH compartment -> study key.
//
// Flags (design.md): cartridgeInserted, cartridgeBlown, titleSeen, toyboxOpened,
// trailerUnfolded, compartmentSearched.
// Soft-lock safety: the cartridge can always be ejected (REMOVE, or TAKE while inserted), BLOW
// works whether the cartridge is in hand or in the slot (it pops it out first), and blowing
// before the first failed boot is allowed. The only gate is the toybox lid (5.3), which opens
// as soon as the title card has been seen. The trailer and the key can be carried anywhere.
// The generic OPEN/SEARCH handlers do the reveals (toybox -> toys + trailer, trailer -> key);
// this module owns the NES, the gates, UNFOLD, and taking the study key (the bedroom and hallway
// keys in hand share the "key" alias, so a bare TAKE KEY would otherwise be ambiguous).
import { isInScope } from '../world';
import type { EngineEvent, GameState } from '../state';
import type { PuzzleHandler, PuzzleModule } from './types';
import { collectKey, msg, refers } from './util';

const NES = 'nes';
const CART = 'cartridge';
const TOYBOX = 'toybox';
const TRAILER = 'trailer';
const KEY = 'studyKey';

/** Generic robot-leader face. A stylized homage, not an official logo, and no song lyrics. */
export const TITLE_CARD_ART = [
  '      _______________      ',
  '     /  _         _  \\     ',
  '    |  | |  ___  | |  |    ',
  '    |  |_| |   | |_|  |    ',
  '    |      |___|      |    ',
  '    |   ___________   |    ',
  '     \\_|___________|_/     ',
  '       |___|   |___|       ',
].join('\n');

const messages: Record<string, string> = {
  'boyhoodBedroom:nes_empty':
    'You flip the power switch. The TV hums and shows a blue screen and a blinking nothing. The NES wants a cartridge to chew on.',
  'boyhoodBedroom:inserted':
    'You slide the cartridge into the NES and push it down until it clunks. The little spring catches it. Somewhere, a thousand kids are nodding.',
  'boyhoodBedroom:already_inserted': 'The cartridge is already in the NES. PRESS POWER, or take it out again.',
  'boyhoodBedroom:eject': 'You pop the cartridge out of the slot and into your hand.',
  'boyhoodBedroom:nothing_to_eject': 'The cartridge slot is empty. Nothing to take out.',
  'boyhoodBedroom:boot_fail':
    'You hit the power button. The screen flickers, rolls, and fills with garbled blocks that look like a robot sneezing. The picture dies. The console has opinions about your cartridge, and none of them are kind.',
  'boyhoodBedroom:blow_inserted':
    'You pull the cartridge out of the slot, hold it up like a harmonica, and blow across the contacts. A little cloud of 1987 puffs out.',
  'boyhoodBedroom:blow': 'You blow across the cartridge\'s contacts. A little cloud of 1987 puffs out. Every kid knew this was the fix, and every kid knew it was not scientifically sound.',
  'boyhoodBedroom:blow_again': 'You blow on the contacts again. They are as clean as breath is going to get them.',
  'boyhoodBedroom:blow_what': 'You blow on that. Nothing happens, unless you count your dignity. A cartridge would be a better target.',
  'boyhoodBedroom:boot': `You hit the power button. The screen flickers once, then catches. A chirpy chiptune plays, and the title card slams onto the screen.\n\n${TITLE_CARD_ART}\n\n        T H E   T O U C H\n\nI am not going to say the rest of it. You know it. Somewhere in this room is the one the card is talking about, and the lid of that toybox has been trying to tell you the same thing.`,
  'boyhoodBedroom:boot_again': `The title card plays again.\n\n${TITLE_CARD_ART}\n\n        T H E   T O U C H`,
  'boyhoodBedroom:toybox_shut':
    'The toybox lid will not budge. AUTOBOTS ONLY, it says, and the lid means it. Whatever password it wants, it has not heard it yet. There is a game console in this room that might know.',
  'boyhoodBedroom:trailer_unfold':
    'You press the little latch, and the trailer clicks, whirs, and unfolds into a tiny command platform with a hinged panel in its base. Boys in 1984 would have lost their minds.',
  'boyhoodBedroom:trailer_folded_search':
    'You turn the trailer over. A compartment is there, but it is seamed shut. The trailer looks like it wants to unfold first.',
  'boyhoodBedroom:trailer_not_here': 'You do not see a trailer within reach. A toybox in this room is rattling with toys, though.',
  'boyhoodBedroom:unfold_what': 'You try to unfold that. It is not that kind of thing. Something robot-shaped would be a better candidate.',
  'boyhoodBedroom:already_unfolded': 'The trailer is already unfolded.',
  'boyhoodBedroom:key_found':
    'You open the compartment. Taped inside, flat and bronze, is a key tagged STUDY. Dad hid the important thing in the one toy he guarded like a trophy.',
};

const isCart = (c: Parameters<typeof refers>[0], p: string | undefined) => refers(c, p, CART);
const isNes = (c: Parameters<typeof refers>[0], p: string | undefined) => refers(c, p, NES);

const inSlot = (state: GameState): boolean => state.itemLocations[CART] === 'nes';
const cartReachable = (state: GameState): boolean => inSlot(state) || isInScope(state, CART);

function eject(state: GameState): EngineEvent[] {
  state.itemLocations[CART] = 'inventory';
  state.inventory.push(CART);
  state.flags.cartridgeInserted = false;
  return [{ type: 'SOUND', cue: 'tape_clunk', caption: '[cartridge pops out of the slot]' }, msg('boyhoodBedroom:eject')];
}

function insertCart(state: GameState): EngineEvent[] {
  if (inSlot(state)) return [msg('boyhoodBedroom:already_inserted')];
  if (!isInScope(state, NES) || !isInScope(state, CART)) return [msg('not_here')];
  state.inventory = state.inventory.filter((i) => i !== CART);
  state.itemLocations[CART] = 'nes';
  state.flags.cartridgeInserted = true;
  return [{ type: 'SOUND', cue: 'tape_clunk', caption: '[cartridge clunks into the NES]' }, msg('boyhoodBedroom:inserted')];
}

function power(state: GameState): EngineEvent[] {
  if (!isInScope(state, NES)) return [msg('not_here')];
  if (!inSlot(state)) return [msg('boyhoodBedroom:nes_empty')];
  if (!state.flags.cartridgeBlown) {
    return [
      { type: 'SOUND', cue: 'static_burst', caption: '[the screen flickers and dies in a burst of static]' },
      msg('boyhoodBedroom:boot_fail'),
    ];
  }
  const again = state.flags.titleSeen === true;
  state.flags.titleSeen = true;
  return [
    { type: 'SOUND', cue: 'nes_chime', caption: '[a cheerful chiptune plays]' },
    msg(again ? 'boyhoodBedroom:boot_again' : 'boyhoodBedroom:boot'),
  ];
}

const insert: PuzzleHandler = (state, command, content) => {
  const { directObject: d, indirectObject: i } = command;
  if (isCart(content, d) || isCart(content, i) || isNes(content, d) || isNes(content, i)) return insertCart(state);
  return undefined;
};

const press: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (isNes(content, d) || (isCart(content, d) && inSlot(state))) return power(state);
  return undefined;
};

const blow: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (!isCart(content, d) && !isNes(content, d)) return [msg('boyhoodBedroom:blow_what')];
  if (!cartReachable(state)) return [msg('not_here')];
  const events: EngineEvent[] = [];
  if (inSlot(state)) {
    events.push(...eject(state));
    events.pop();
    events.push(msg('boyhoodBedroom:blow_inserted'));
  } else {
    events.push(msg(state.flags.cartridgeBlown ? 'boyhoodBedroom:blow_again' : 'boyhoodBedroom:blow'));
  }
  state.flags.cartridgeBlown = true;
  return events;
};

const remove: PuzzleHandler = (state, command, content) => {
  if (!isCart(content, command.directObject) && !isNes(content, command.directObject)) return undefined;
  return inSlot(state) ? eject(state) : [msg('boyhoodBedroom:nothing_to_eject')];
};

/** TAKE cartridge while it is in the slot ejects it; TAKE key prefers the study key on the floor. */
const take: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (isCart(content, d) && inSlot(state)) return eject(state);
  if (refers(content, d, KEY) && !state.inventory.includes(KEY) && state.itemLocations[KEY] === state.room) {
    state.inventory.push(KEY);
    state.itemLocations[KEY] = 'inventory';
    return [{ type: 'ITEM_TAKEN', item: KEY }, msg(`taken:${KEY}`)];
  }
  return undefined;
};

const examine: PuzzleHandler = (state, command, content) => {
  if (isCart(content, command.directObject) && inSlot(state)) return [msg('boyhoodBedroom:already_inserted')];
  return undefined;
};

/** OPEN / SEARCH toybox: sealed until the title card has been seen (5.3), then the generic reveal. */
const gateToybox: PuzzleHandler = (state, command, content) => {
  if (!refers(content, command.directObject, TOYBOX) || !isInScope(state, TOYBOX)) return undefined;
  return state.flags.titleSeen ? undefined : [msg('boyhoodBedroom:toybox_shut')];
};

/** OPEN / SEARCH trailer or its compartment: needs UNFOLD first, then the generic reveal. */
const gateTrailer: PuzzleHandler = (state, command, content) => {
  if (!refers(content, command.directObject, TRAILER)) return undefined;
  if (!isInScope(state, TRAILER)) return [msg('boyhoodBedroom:trailer_not_here')];
  return state.flags.trailerUnfolded ? undefined : [msg('boyhoodBedroom:trailer_folded_search')];
};

const gates: PuzzleHandler = (state, command, content) =>
  gateToybox(state, command, content) ?? gateTrailer(state, command, content);

const unfold: PuzzleHandler = (state, command, content) => {
  if (!refers(content, command.directObject, TRAILER)) return [msg('boyhoodBedroom:unfold_what')];
  if (!isInScope(state, TRAILER)) return [msg('boyhoodBedroom:trailer_not_here')];
  if (state.flags.trailerUnfolded) return [msg('boyhoodBedroom:already_unfolded')];
  state.flags.trailerUnfolded = true;
  state.itemStates[TRAILER] = 'unfolded';
  return [{ type: 'SOUND', cue: 'toy_transform', caption: '[a toy transforms with a ratchety whirr]' }, msg('boyhoodBedroom:trailer_unfold')];
};

/** USE cartridge ON NES, as an alias for INSERT. */
const use: PuzzleHandler = (state, command, content) => {
  const { directObject: d, indirectObject: i } = command;
  if ((isCart(content, d) && isNes(content, i)) || (isNes(content, d) && isCart(content, i))) return insertCart(state);
  return undefined;
};

export const boyhoodBedroomPuzzle: PuzzleModule = {
  room: 'boyhoodBedroom',
  handlers: {
    INSERT: insert,
    USE: use,
    PRESS: press,
    PLAY: press,
    BLOW: blow,
    REMOVE: remove,
    TAKE: take,
    EXAMINE: examine,
    OPEN: gates,
    SEARCH: gates,
    UNFOLD: unfold,
  },
  messages,
  afterStep(state) {
    const events: EngineEvent[] = [];
    const revealed = (id: string) => state.itemLocations[id] !== undefined && state.itemLocations[id] !== 'hidden';
    if (revealed(TRAILER)) state.flags.toyboxOpened = true;
    if (revealed(KEY) && !state.flags.compartmentSearched) {
      state.flags.compartmentSearched = true;
      events.push(msg('boyhoodBedroom:key_found'), ...collectKey(state, KEY), { type: 'PUZZLE_SOLVED', puzzle: 'boyhoodBedroom' });
      // Warmth stays at 2 here and never goes down.
      if (state.warmth < 2) {
        state.warmth = 2;
        events.push({ type: 'WARMTH_CHANGED', level: 2 });
      }
    }
    return events;
  },
};
