// Puzzle 5 and the ending: Grandparents' bedroom (the emotional finale). Requirements 7.1-7.6.
//
// Flow: OPEN tape case -> INSERT tape -> PRESS PLAY (fuzzy) -> ADJUST TRACKING x3 (the video plays,
//       final silence beat, warmth 4) -> OPEN/REMOVE battery cover on the clock radio -> front door key
//       -> UNLOCK/OPEN/GO front door -> the ending.
//
// Flags (design.md): tapeFound, tapeInserted, trackingAdjusted, videoWatched, clockRadioOpened.
// Helper flags: tapePlaying, clockSet (the optional gag), ended (the ending is terminal).
// Tracking progress lives in itemStates.vcrTracking ('0'..'3'); it is reset by ejecting the tape.
//
// Gates: the picture only clears once the tape is playing and tracking is fully adjusted (7.2); the clock
// radio's cover stays stuck until the video has been seen (7.5). SET CLOCK is a gag that never gates anything (7.3).
//
// Soft-lock safety (9.4): the tape can always be ejected (REMOVE / EJECT, or TAKE while inserted). Ejecting resets
// tracking but returns the tape to the player, so the player can simply start over. Nothing consumes the tape.
//
// The ending (7.6): the moment the front door is unlocked (UNLOCK, OPEN, USE key, or GO through it) afterStep
// emits SOUND alarm_buzz, ENDING, a black screen, the wake-up scene, and the pencil as the final image, and
// sets flags.ended. `step` then ignores every further command (see step.ts), so nothing follows the pencil.
// Decision: the pencil is permanent once taken, but if the player never took it the ending puts it in their
// inventory anyway, so the final image is always true. The walkthrough takes it in the basement.
import { isInScope } from '../world';
import type { EngineEvent, GameState } from '../state';
import type { PuzzleHandler, PuzzleModule } from './types';
import { collectKey, msg, refers } from './util';
import { normalizeText } from '../parser';

const VCR = 'vcr';
const TV = 'bedroomTv';
const TAPE = 'homeTape';
const CASE = 'tapeCase';
const BETA = 'betamaxTape';
const RADIO = 'clockRadio';
const KEY = 'frontDoorKey';
const PENCIL = 'pencil';
const FRONT_DOOR = 'outside';
const ROOM = 'grandparentsBedroom';
const TRACKING = 'vcrTracking';
const TRACKING_CLEAR = 3;

/** Adult Dad's line at the end of the video. Same text as `video_adult_dad_final` in content/voice-lines.json. */
export const VIDEO_FINAL_LINE = 'Hey, bud. The gadgets were never really the point.';

const messages: Record<string, string> = {
  'grandparentsBedroom:case_opened':
    'You flip the lid of the aerobics case. No leotard, no leg-warmer energy. Inside sits a videotape with a handwritten label in a kid-proud, grown-up-patient hand: DAD\'S CHRISTMAS 1986.',
  'grandparentsBedroom:inserted':
    'You push the tape into the VCR. It swallows it with a mechanical gulp and the machine whirs awake. The little clock keeps blinking 12:00 like nothing happened.',
  'grandparentsBedroom:already_inserted': 'The tape is already in the VCR. PRESS PLAY, or eject it.',
  'grandparentsBedroom:no_tape': 'You do not have a tape for it. The VCR blinks 12:00 at you, hungry and patient. Somewhere in this room is a case that might hold one.',
  'grandparentsBedroom:wrong_format':
    'The Betamax is the wrong shape. It will not fit in a VHS slot, however firmly you believe in it. Wrong format. Wrong era. Wrong decade, honestly.',
  'grandparentsBedroom:eject': 'You press eject. The VCR coughs the tape back out and you take it. The picture settings go back to how they were.',
  'grandparentsBedroom:nothing_to_eject': 'The VCR is empty. There is nothing to eject.',
  'grandparentsBedroom:play_empty': 'You press play. The VCR blinks 12:00 and has nothing to play. It wants a tape.',
  'grandparentsBedroom:play_fuzzy_0':
    'You press play. The TV fills with a blizzard of static, rolling bars, and a faint shape that might be people. The picture is a mess. VCRs had a control for that.',
  'grandparentsBedroom:play_fuzzy_1':
    'You press play. The picture is still wavy, but you can make out a Christmas tree through the snow. The tracking could use more work.',
  'grandparentsBedroom:play_fuzzy_2':
    'You press play. The picture is almost there. A few bars of static roll up the screen, and a sweater pattern flickers in and out. One more nudge, maybe.',
  'grandparentsBedroom:adjust_not_playing': 'There is no picture to adjust. The tape has to be playing first. PRESS PLAY.',
  'grandparentsBedroom:adjust_no_tape': 'You fiddle with the tracking knob. Nothing is playing, so nothing changes. The VCR is waiting for a tape.',
  'grandparentsBedroom:adjust_1': 'You nudge the tracking. The static thins a little, and the shapes behind it start to look like a room.',
  'grandparentsBedroom:adjust_2': 'A little more. The rolling bars slow down and the colors begin to settle. There are people on the screen.',
  'grandparentsBedroom:adjust_clear_prefix': 'One last nudge.',
  'grandparentsBedroom:adjust_already_clear': 'The picture is as clear as a tape this old will ever get. Leave it be.',
  'grandparentsBedroom:video': `The static clears all at once.\n\nA living room in the middle of a Christmas morning. Wrapping paper everywhere. The camera swings, wobbles, and settles on a boy of about ten in pajamas, kneeling in front of a big flat box.\n\n"Okay, wave at the camera," says a man off-screen, Grandpa, the early adopter, camcorder on his shoulder. "Wave! Now open it. Slowly! It's a Nintendo!"\n\nThe boy tears the paper. "No way. No way! Are you serious?" He is Dad. He is ten, and he is the happiest person who has ever lived.\n\nThe tape cuts. Later that morning the picture jumps to this very bedroom, the camera low and sneaky. The boy whispers to the lens, glancing at the door: "Saturday morning's the best time to find it."\n\nThe picture glitches. The image tears and rolls. For a few seconds there is only static, and then a different voice comes out of it, older, close, and very sincere.\n\n"${VIDEO_FINAL_LINE}"\n\nThen the tape runs out, and the screen goes to blue.`,
  'grandparentsBedroom:video_again':
    'You watch the first part of the tape again. The wrapping paper, the shout, the whisper about Saturday morning. The static comes and goes at the end, and the screen goes blue.',
  'grandparentsBedroom:clock_gag':
    'You hold the button down and try to set the clock. You cycle through settings you never knew existed. After a while the display blinks 12:00 once more. A generation of households, united in not knowing how to set the clock.',
  'grandparentsBedroom:clock_gag_again': 'You give the clock another go. Still 12:00. It remains undefeated.',
  'grandparentsBedroom:clock_gag_late': 'You reach for the clock, then stop. It can keep blinking. It does not seem very important anymore.',
  'grandparentsBedroom:cover_stuck':
    'You try the battery cover on the back of the clock radio. It is painted shut with decades of dust, and it will not budge. It is stopped at an odd time, and you do not know why yet. Maybe something in this room will explain it.',
  'grandparentsBedroom:cover_opened':
    'You pop the battery cover off the back of the clock radio. Taped inside, flat and worn, is a house key. Dad set an alarm for 6 a.m. on Saturdays to beat everyone to the cartoons. Of course the clock stopped there.',
  'grandparentsBedroom:cover_empty': 'The battery cover is off. There is nothing left inside the clock radio.',
  'grandparentsBedroom:front_door_locked': 'The front door is locked. You will need a key.',
  'grandparentsBedroom:front_door_opened': 'The key turns in the front door. It clicks.',
  'grandparentsBedroom:not_a_vcr_thing': 'That is not something you can put in a VCR.',
  'ending:black': '[ the screen goes black ]',
  'ending:wake':
    'You wake up in your own bed. The alarm clock is still buzzing. Gray light comes through the curtains, and the house is quiet.\n\nFor a moment you are not sure where you were. A basement. A hallway. A row of locked doors, and Dad on the other side of every one of them, a step ahead, leaving the way open.\n\nYou think of him. You think of him young, and proud of himself, and trying not to giggle. You lie there for a while, smiling at the ceiling.',
  'ending:pencil': 'You reach into your pocket, and your fingers close around a pencil.',
};

const isVcr = (c: Parameters<typeof refers>[0], p: string | undefined) => refers(c, p, VCR);
const isTape = (c: Parameters<typeof refers>[0], p: string | undefined) => refers(c, p, TAPE);

const tapeInVcr = (state: GameState): boolean => state.itemLocations[TAPE] === VCR;
const revealed = (state: GameState, id: string): boolean =>
  state.itemLocations[id] !== undefined && state.itemLocations[id] !== 'hidden';
const tracking = (state: GameState): number => Number(state.itemStates[TRACKING] ?? '0');

function reveal(state: GameState, container: string, found: string): EngineEvent {
  state.itemLocations[found] = state.room;
  state.flags[`searched:${container}`] = true;
  return { type: 'ITEM_SEARCHED', item: container, found };
}

function eject(state: GameState): EngineEvent[] {
  state.itemLocations[TAPE] = 'inventory';
  state.inventory.push(TAPE);
  state.flags.tapeInserted = false;
  state.flags.tapePlaying = false;
  state.itemStates[TRACKING] = '0';
  return [{ type: 'SOUND', cue: 'tape_clunk', caption: '[the VCR ejects the tape]' }, msg('grandparentsBedroom:eject')];
}

function insertTape(state: GameState): EngineEvent[] {
  if (tapeInVcr(state)) return [msg('grandparentsBedroom:already_inserted')];
  const handy = state.inventory.includes(TAPE) || state.itemLocations[TAPE] === state.room;
  if (!handy || !isInScope(state, VCR)) return [msg('grandparentsBedroom:no_tape')];
  state.inventory = state.inventory.filter((i) => i !== TAPE);
  state.itemLocations[TAPE] = VCR;
  state.flags.tapeInserted = true;
  state.flags.tapePlaying = false;
  state.itemStates[TRACKING] = '0';
  return [{ type: 'SOUND', cue: 'vcr_whirr', caption: '[the VCR swallows the tape and whirrs]' }, msg('grandparentsBedroom:inserted')];
}

/** The video: the first full watch ends with the warmth bump and the final silence beat (7.4). */
function playVideo(state: GameState): EngineEvent[] {
  const again = state.flags.videoWatched === true;
  state.flags.videoWatched = true;
  if (again) {
    return [{ type: 'SOUND', cue: 'vcr_whirr', caption: '[the home video plays]' }, msg('grandparentsBedroom:video_again')];
  }
  const events: EngineEvent[] = [
    { type: 'SOUND', cue: 'vcr_whirr', caption: '[a camcorder tape plays: a man off-screen, a boy shouting]' },
    { type: 'SOUND', cue: 'dad_voice', caption: "[Dad's voice, over the static]" },
    msg('grandparentsBedroom:video'),
  ];
  if (state.warmth < 4) {
    state.warmth = 4;
    events.push({ type: 'WARMTH_CHANGED', level: 4 });
  }
  events.push({ type: 'SILENCE_BEAT' });
  return events;
}

const insert: PuzzleHandler = (state, command, content) => {
  const { directObject: d, indirectObject: i } = command;
  if (refers(content, d, BETA) || refers(content, i, BETA)) return [msg('grandparentsBedroom:wrong_format')];
  if (isTape(content, d) || isTape(content, i)) return insertTape(state);
  if (isVcr(content, i) && d !== undefined) return [msg('grandparentsBedroom:not_a_vcr_thing')];
  if (isVcr(content, d) && i === undefined) return insertTape(state);
  return undefined;
};

/** USE tape ON vcr is an alias for INSERT. */
const use: PuzzleHandler = (state, command, content) => {
  const { directObject: d, indirectObject: i } = command;
  if ((isTape(content, d) && isVcr(content, i)) || (isVcr(content, d) && isTape(content, i))) return insertTape(state);
  return undefined;
};

/** PLAY / PRESS PLAY (no object is fine: "press play" is a verb phrase of its own). */
const play: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (d !== undefined && !isVcr(content, d) && !isTape(content, d) && !refers(content, d, TV)) return undefined;
  if (!tapeInVcr(state)) return [msg('grandparentsBedroom:play_empty')];
  state.flags.tapePlaying = true;
  const level = tracking(state);
  if (level >= TRACKING_CLEAR) return playVideo(state);
  return [
    { type: 'SOUND', cue: 'static_burst', caption: '[the TV hisses with static]' },
    msg(`grandparentsBedroom:play_fuzzy_${level}`),
  ];
};

/** PRESS: play when aimed at the VCR; otherwise let the world decide. */
const press: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (d !== undefined && normalizeText(d) === 'play') return play(state, { ...command, directObject: undefined }, content);
  return play(state, command, content);
};

/** ADJUST TRACKING / FIX TRACKING / TRACKING: the static clears step by step (7.2). */
const adjust: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  const aimed =
    d === undefined || isVcr(content, d) || refers(content, d, TV) || ['tracking', 'picture', 'knob', 'dial'].includes(normalizeText(d));
  if (!aimed) return undefined;
  if (!tapeInVcr(state)) return [msg('grandparentsBedroom:adjust_no_tape')];
  if (!state.flags.tapePlaying) return [msg('grandparentsBedroom:adjust_not_playing')];
  const level = tracking(state);
  if (level >= TRACKING_CLEAR) return [msg('grandparentsBedroom:adjust_already_clear')];
  const next = level + 1;
  state.itemStates[TRACKING] = String(next);
  state.flags.trackingAdjusted = next >= TRACKING_CLEAR;
  const cue: EngineEvent = { type: 'SOUND', cue: 'static_burst', caption: '[the static thins and rolls away]' };
  if (next < TRACKING_CLEAR) return [cue, msg(`grandparentsBedroom:adjust_${next}`)];
  return [cue, msg('grandparentsBedroom:adjust_clear_prefix'), ...playVideo(state)];
};

/** REMOVE / EJECT the tape; REMOVE the clock radio's battery cover. */
const remove: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (isTape(content, d) || isVcr(content, d)) return tapeInVcr(state) ? eject(state) : [msg('grandparentsBedroom:nothing_to_eject')];
  if (refers(content, d, RADIO)) return openCover(state);
  return undefined;
};

/** SET CLOCK: the optional gag. It never blocks anything and it never changes state that matters (7.3). */
const set: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (!refers(content, d, RADIO) && !isVcr(content, d) && (d === undefined || normalizeText(d) !== 'time')) return undefined;
  if (state.flags.videoWatched) return [msg('grandparentsBedroom:clock_gag_late')];
  const again = state.flags.clockSet === true;
  state.flags.clockSet = true;
  return [msg(again ? 'grandparentsBedroom:clock_gag_again' : 'grandparentsBedroom:clock_gag')];
};

/** The clock radio's cover stays stuck until the video has been seen (7.5). */
function openCover(state: GameState): EngineEvent[] {
  if (!state.flags.videoWatched) return [msg('grandparentsBedroom:cover_stuck')];
  if (!revealed(state, KEY)) {
    return [reveal(state, RADIO, KEY), msg('grandparentsBedroom:cover_opened')];
  }
  return [msg('grandparentsBedroom:cover_empty')];
}

/** OPEN / GO through the front door: with the key it unlocks (the ending fires in afterStep); without, the world says it is locked. */
function frontDoor(state: GameState, phrase: string | undefined): EngineEvent[] | undefined {
  if (phrase === undefined || !['front door', 'door', 'outside'].includes(normalizeText(phrase))) return undefined;
  if (state.unlockedDoors.includes(FRONT_DOOR)) return undefined;
  if (!state.inventory.includes(KEY)) return [msg('grandparentsBedroom:front_door_locked')];
  state.unlockedDoors.push(FRONT_DOOR);
  return [{ type: 'DOOR_UNLOCKED', room: FRONT_DOOR }, msg('grandparentsBedroom:front_door_opened')];
}

const go: PuzzleHandler = (state, command) => frontDoor(state, command.directObject);

/** OPEN / SEARCH the clock radio or its battery cover; OPEN the tape case; OPEN the front door. */
const open: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (refers(content, d, RADIO)) return openCover(state);
  if (refers(content, d, CASE) && !revealed(state, TAPE)) {
    return [reveal(state, CASE, TAPE), msg('grandparentsBedroom:case_opened')];
  }
  if (command.verb === 'OPEN') return frontDoor(state, d);
  return undefined;
};

/** TAKE tape (also while it is in the VCR) and TAKE key: other tapes and keys in hand share the aliases. */
const take: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (isTape(content, d) && !state.inventory.includes(TAPE)) {
    if (tapeInVcr(state)) return eject(state);
    if (state.itemLocations[TAPE] === state.room) {
      state.inventory.push(TAPE);
      state.itemLocations[TAPE] = 'inventory';
      return [{ type: 'ITEM_TAKEN', item: TAPE }, msg(`taken:${TAPE}`)];
    }
  }
  if (refers(content, d, KEY) && !state.inventory.includes(KEY) && state.itemLocations[KEY] === state.room) {
    state.inventory.push(KEY);
    state.itemLocations[KEY] = 'inventory';
    return [{ type: 'ITEM_TAKEN', item: KEY }, msg(`taken:${KEY}`)];
  }
  return undefined;
};

/** EXAMINE tape: the plain "tape" alias is shared with the basement cassette, so resolve it here. */
const examine: PuzzleHandler = (state, command, content) => {
  const d = command.directObject;
  if (isTape(content, d) && (tapeInVcr(state) || isInScope(state, TAPE))) return [msg(`item:${TAPE}`)];
  return undefined;
};

export const grandparentsBedroomPuzzle: PuzzleModule = {
  room: ROOM,
  handlers: {
    INSERT: insert,
    USE: use,
    PLAY: play,
    PRESS: press,
    ADJUST: adjust,
    REMOVE: remove,
    SET: set,
    OPEN: open,
    SEARCH: open,
    TAKE: take,
    GO: go,
    EXAMINE: examine,
  },
  messages,
  afterStep(state) {
    const events: EngineEvent[] = [];
    if (revealed(state, TAPE)) state.flags.tapeFound = true;
    if (revealed(state, KEY) && !state.flags.clockRadioOpened) {
      state.flags.clockRadioOpened = true;
      events.push(...collectKey(state, KEY), { type: 'PUZZLE_SOLVED', puzzle: ROOM });
      // Defensive: the key can only be revealed after the video, which already set warmth 4.
      if (state.warmth < 4) {
        state.warmth = 4;
        events.push({ type: 'WARMTH_CHANGED', level: 4 });
      }
    }
    // The ending (7.6): triggered by whatever unlocked the front door.
    if (state.unlockedDoors.includes(FRONT_DOOR) && !state.flags.ended) {
      state.flags.ended = true;
      if (!state.inventory.includes(PENCIL)) {
        state.inventory.push(PENCIL);
      }
      state.itemLocations[PENCIL] = 'inventory';
      events.push(
        { type: 'SOUND', cue: 'alarm_buzz', caption: '[an alarm clock buzzes]' },
        { type: 'ENDING' },
        msg('ending:black'),
        msg('ending:wake'),
        msg('ending:pencil'),
      );
    }
    return events;
  },
};
