// Content types. Mirrors the JSON files in /content. See schema.ts for the JSON schemas.

export const ROOM_IDS = [
  'basement',
  'hallway',
  'boyhoodBedroom',
  'study',
  'grandparentsBedroom',
  'outside',
] as const;
export type RoomId = (typeof ROOM_IDS)[number];

export const PUZZLE_IDS = [
  'basement',
  'hallway',
  'boyhoodBedroom',
  'study',
  'grandparentsBedroom',
] as const;
export type PuzzleId = (typeof PUZZLE_IDS)[number];

export type ItemId = string;
export type Warmth = 0 | 1 | 2 | 3 | 4;

/** Generic narration banks every warmth level must provide. */
export const GENERIC_NARRATION_KEYS = ['unknown_verb', 'cant_do', 'already_done'] as const;
/** Extra narrator-voiced MESSAGE banks (task 11); allowed in narration.json but not required at every warmth. */
export const HINT_NARRATION_KEYS = ['hint_lead', 'nudge', 'help'] as const;
export type GenericNarrationKey = (typeof GENERIC_NARRATION_KEYS)[number];

export interface ExitDef {
  direction: string;
  to: RoomId;
  /** Key item that unlocks this exit. Absent means never locked. */
  requiresKey?: ItemId;
  /** Shown when the player tries to pass without the key. */
  lockedText: string;
  /** Shown when the exit is unlocked and used. */
  passText: string;
}

export interface RoomDef {
  id: RoomId;
  name: string;
  description: string;
  /** Puzzle played in this room, if any. */
  puzzle: PuzzleId | null;
  /** Items present when the game starts (top-level only; hidden items use `inside`). */
  items: ItemId[];
  exits: ExitDef[];
}

export interface ItemDef {
  id: ItemId;
  name: string;
  aliases: string[];
  description: string;
  takeable: boolean;
  /** Starting room. Exactly one of `room` or `inside` is set. */
  room?: RoomId;
  /** Starting container item (hidden until searched/opened). */
  inside?: ItemId;
  /** Present on door keys. The room this key opens a path to. */
  opens?: RoomId;
  initialState?: string;
  /** Description override per item state. Keys must include initialState if set. */
  states?: Record<string, string>;
  /** Unique one-liner for decoys. */
  decoyLine?: string;
  /** Second line for warmth 3 and 4 revisits. */
  decoyLineLate?: string;
}

export interface VerbDef {
  /** Canonical verb, upper case. */
  id: string;
  /** Alternative words or phrases that map to this verb. */
  synonyms: string[];
  /** How many objects the verb takes (0, 1 or 2). */
  objects: 0 | 1 | 2;
  /** Prepositions that introduce the second object. Only when objects is 2. */
  prepositions?: string[];
}

export interface HintDef {
  puzzle: PuzzleId;
  /** Exactly three tiers, vaguest first. */
  tiers: [string, string, string];
  /** Shown instead of a tier once the puzzle's key has been found. */
  solved: string;
}

export interface NarrationLineDef {
  /** Generic key (see GENERIC_NARRATION_KEYS), `EVENT_TYPE`, or `EVENT_TYPE:detail`. */
  key: string;
  warmth: Warmth;
  variants: string[];
}

export interface Content {
  rooms: RoomDef[];
  items: ItemDef[];
  verbs: VerbDef[];
  hints: HintDef[];
  narration: NarrationLineDef[];
}

/** Indexed view of validated content. */
export interface LoadedContent {
  rooms: Record<RoomId, RoomDef>;
  items: Record<ItemId, ItemDef>;
  verbs: Record<string, VerbDef>;
  hints: Record<PuzzleId, HintDef>;
  narration: NarrationLineDef[];
  /** Maps every lower-case verb synonym to its canonical verb id. */
  verbLookup: Record<string, string>;
  /** Maps every lower-case item name/alias to item ids. */
  nounLookup: Record<string, ItemId[]>;
}
