// Engine data model. Mirrors "Data model" in the design doc.
import type { Command } from './parser';
import { content as defaultContent } from './content';
import type { ItemId, LoadedContent, PuzzleId, RoomId, Warmth } from './content/types';
import { PUZZLE_IDS } from './content/types';

export type { Command, ItemId, PuzzleId, RoomId, Warmth };

export type HintTier = 0 | 1 | 2 | 3;

export type SoundCue =
  | 'dial_clicks'
  | 'phone_ring'
  | 'machine_beep'
  | 'tape_hiss'
  | 'tape_clunk'
  | 'vcr_whirr'
  | 'static_burst'
  | 'nes_chime'
  | 'toy_transform'
  | 'alarm_buzz'
  | 'record_reversed'
  | 'dad_voice';

export interface GameState {
  room: RoomId;
  inventory: ItemId[];
  /** Puzzle progress flags, set only by the engine in response to valid commands. */
  flags: Record<string, boolean>;
  /** e.g. cassette: 'tangled' | 'rewound' | 'loaded'. */
  itemStates: Record<ItemId, string>;
  unlockedDoors: RoomId[];
  /**
   * Where every item currently is: a RoomId, 'inventory', or 'hidden' (still inside an
   * unopened container). This is what keeps room state unchanged when the player leaves.
   */
  itemLocations: Record<ItemId, string>;
  warmth: Warmth;
  hintTier: Record<PuzzleId, HintTier>;
  idleTurns: number;
  /** Seeded counter for canned line selection. No randomness anywhere in the engine. */
  variantCounter: number;
}

export type EngineEvent =
  | { type: 'ROOM_ENTERED'; room: RoomId }
  | { type: 'ITEM_TAKEN'; item: ItemId }
  | { type: 'ITEM_SEARCHED'; item: ItemId; found?: ItemId }
  | { type: 'PUZZLE_SOLVED'; puzzle: PuzzleId }
  | { type: 'DOOR_UNLOCKED'; room: RoomId }
  | { type: 'SOUND'; cue: SoundCue; caption: string }
  | { type: 'MESSAGE'; id: string }
  | { type: 'SILENCE_BEAT' }
  | { type: 'WARMTH_CHANGED'; level: number }
  | { type: 'ENDING' };

export interface StepResult {
  newState: GameState;
  events: EngineEvent[];
}

/** Fresh game: basement, empty hands, every item in its content-defined starting state. */
export function createInitialState(content: LoadedContent = defaultContent): GameState {
  const itemStates: Record<ItemId, string> = {};
  for (const id of Object.keys(content.items).sort()) {
    const initial = content.items[id]?.initialState;
    if (initial !== undefined) itemStates[id] = initial;
  }
  const itemLocations: Record<ItemId, string> = {};
  for (const id of Object.keys(content.items).sort()) {
    const item = content.items[id];
    if (item) itemLocations[id] = item.room ?? 'hidden';
  }
  const hintTier = {} as Record<PuzzleId, HintTier>;
  for (const p of PUZZLE_IDS) hintTier[p] = 0;
  return {
    room: 'basement',
    inventory: [],
    flags: {},
    itemStates,
    unlockedDoors: [],
    itemLocations,
    warmth: 0,
    hintTier,
    idleTurns: 0,
    variantCounter: 0,
  };
}

/** Deep copy so `step` never shares mutable structure with its input. */
export function cloneState(s: GameState): GameState {
  return {
    room: s.room,
    inventory: [...s.inventory],
    flags: { ...s.flags },
    itemStates: { ...s.itemStates },
    unlockedDoors: [...s.unlockedDoors],
    itemLocations: { ...s.itemLocations },
    warmth: s.warmth,
    hintTier: { ...s.hintTier },
    idleTurns: s.idleTurns,
    variantCounter: s.variantCounter,
  };
}
