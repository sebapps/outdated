// Content loader: validates every content file's shape (JSON schema) and every
// cross-reference, and throws one ContentError listing all problems.
import Ajv from 'ajv';
import {
  hintsSchema,
  itemsSchema,
  narrationSchema,
  roomsSchema,
  verbsSchema,
} from './schema';
import {
  GENERIC_NARRATION_KEYS,
  HINT_NARRATION_KEYS,
  PUZZLE_IDS,
  ROOM_IDS,
  type Content,
  type HintDef,
  type ItemDef,
  type LoadedContent,
  type NarrationLineDef,
  type PuzzleId,
  type RoomDef,
  type RoomId,
  type VerbDef,
} from './types';

/** Verbs that must exist in every room (requirement 1.5). */
export const REQUIRED_VERBS = [
  'LOOK', 'EXAMINE', 'TAKE', 'DROP', 'INVENTORY', 'OPEN', 'SEARCH', 'USE', 'GO', 'HELP', 'HINT',
] as const;

/** Event types a narration key may be bound to (see design.md). */
export const NARRATION_EVENT_TYPES = [
  'ROOM_ENTERED', 'ITEM_TAKEN', 'ITEM_SEARCHED', 'PUZZLE_SOLVED', 'DOOR_UNLOCKED',
  'SOUND', 'MESSAGE', 'SILENCE_BEAT', 'WARMTH_CHANGED', 'ENDING',
] as const;

export class ContentError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Content validation failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n - ${problems.join('\n - ')}`);
    this.name = 'ContentError';
    this.problems = problems;
  }
}

/** Raw parsed JSON of each file in /content. */
export interface RawContent {
  rooms: unknown;
  items: unknown;
  verbs: unknown;
  hints: unknown;
  narration: unknown;
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validators = {
  rooms: ajv.compile(roomsSchema),
  items: ajv.compile(itemsSchema),
  verbs: ajv.compile(verbsSchema),
  hints: ajv.compile(hintsSchema),
  narration: ajv.compile(narrationSchema),
};

function dupes<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out = new Set<T>();
  for (const v of values) (seen.has(v) ? out : seen).add(v);
  return [...out];
}

function checkSchemas(raw: RawContent, problems: string[]): boolean {
  let ok = true;
  for (const name of Object.keys(validators) as (keyof typeof validators)[]) {
    const validate = validators[name];
    if (!validate(raw[name])) {
      ok = false;
      for (const e of validate.errors ?? []) {
        problems.push(`${name}.json${e.instancePath || ''}: ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`);
      }
    }
  }
  return ok;
}

function checkRooms(rooms: RoomDef[], items: Map<string, ItemDef>, p: string[]): void {
  for (const id of dupes(rooms.map((r) => r.id))) p.push(`rooms: duplicate room id "${id}"`);
  for (const id of ROOM_IDS) {
    if (!rooms.some((r) => r.id === id)) p.push(`rooms: missing room "${id}"`);
  }
  for (const room of rooms) {
    for (const itemId of room.items) {
      const item = items.get(itemId);
      if (!item) p.push(`rooms: room "${room.id}" lists unknown item "${itemId}"`);
      else if (item.room !== room.id) {
        p.push(`rooms: room "${room.id}" lists item "${itemId}" but the item's room is "${item.room ?? '(none)'}"`);
      }
    }
    for (const exit of room.exits) {
      if (!rooms.some((r) => r.id === exit.to)) p.push(`rooms: exit from "${room.id}" leads to unknown room "${exit.to}"`);
      if (exit.requiresKey) {
        const key = items.get(exit.requiresKey);
        if (!key) p.push(`rooms: exit "${room.id}" -> "${exit.to}" requires unknown key "${exit.requiresKey}"`);
        else if (key.opens !== exit.to) {
          p.push(`rooms: exit "${room.id}" -> "${exit.to}" requires "${key.id}" but that key opens "${key.opens ?? '(nothing)'}"`);
        }
      }
    }
    if (room.puzzle !== null && room.puzzle !== room.id) {
      p.push(`rooms: room "${room.id}" has puzzle "${room.puzzle}" (puzzle id must equal room id)`);
    }
  }
  for (const id of PUZZLE_IDS) {
    if (!rooms.some((r) => r.puzzle === id)) p.push(`rooms: no room hosts puzzle "${id}"`);
  }
}

function checkItems(items: ItemDef[], rooms: RoomDef[], p: string[]): Map<string, ItemDef> {
  const map = new Map<string, ItemDef>();
  for (const id of dupes(items.map((i) => i.id))) p.push(`items: duplicate item id "${id}"`);
  for (const i of items) map.set(i.id, i);
  for (const item of items) {
    if ((item.room === undefined) === (item.inside === undefined)) {
      p.push(`items: "${item.id}" must set exactly one of "room" or "inside"`);
    }
    if (item.inside !== undefined) {
      const container = map.get(item.inside);
      if (!container) p.push(`items: "${item.id}" is inside unknown item "${item.inside}"`);
      else if (container.id === item.id) p.push(`items: "${item.id}" is inside itself`);
    }
    if (item.initialState !== undefined && !(item.states && item.initialState in item.states)) {
      p.push(`items: "${item.id}" initialState "${item.initialState}" has no entry in "states"`);
    }
    if (item.states && item.initialState === undefined) {
      p.push(`items: "${item.id}" defines "states" but no "initialState"`);
    }
    if (item.decoyLineLate !== undefined && item.decoyLine === undefined) {
      p.push(`items: "${item.id}" has decoyLineLate without decoyLine`);
    }
    if (item.room !== undefined) {
      const room = rooms.find((r) => r.id === item.room);
      if (room && !room.items.includes(item.id)) {
        p.push(`items: "${item.id}" starts in "${item.room}" but that room does not list it`);
      }
    }
  }
  // Containment chains must end in a room (no cycles, no dangling).
  for (const item of items) {
    const seen = new Set<string>();
    let cur: ItemDef | undefined = item;
    while (cur && cur.inside !== undefined) {
      if (seen.has(cur.id)) {
        p.push(`items: containment cycle through "${cur.id}"`);
        break;
      }
      seen.add(cur.id);
      cur = map.get(cur.inside);
    }
  }
  return map;
}

function checkVerbs(verbs: VerbDef[], p: string[]): void {
  for (const id of dupes(verbs.map((v) => v.id))) p.push(`verbs: duplicate verb "${id}"`);
  for (const id of REQUIRED_VERBS) {
    if (!verbs.some((v) => v.id === id)) p.push(`verbs: missing required verb "${id}"`);
  }
  const owner = new Map<string, string>();
  for (const v of verbs) {
    if (v.prepositions && v.objects !== 2) p.push(`verbs: "${v.id}" has prepositions but takes ${v.objects} objects`);
    if (v.objects === 2 && (!v.prepositions || v.prepositions.length === 0)) {
      p.push(`verbs: "${v.id}" takes two objects but lists no prepositions`);
    }
    for (const word of [v.id.toLowerCase(), ...v.synonyms.map((s) => s.toLowerCase())]) {
      const prev = owner.get(word);
      if (prev !== undefined && prev !== v.id) p.push(`verbs: "${word}" maps to both "${prev}" and "${v.id}"`);
      owner.set(word, v.id);
    }
  }
}

function checkHints(hints: HintDef[], p: string[]): void {
  for (const id of dupes(hints.map((h) => h.puzzle))) p.push(`hints: duplicate hints for puzzle "${id}"`);
  for (const id of PUZZLE_IDS) {
    if (!hints.some((h) => h.puzzle === id)) p.push(`hints: missing hints for puzzle "${id}"`);
  }
}

function checkNarration(lines: NarrationLineDef[], p: string[]): void {
  const pairs = lines.map((l) => `${l.key}@${l.warmth}`);
  for (const d of dupes(pairs)) p.push(`narration: duplicate entry "${d}"`);
  const generic = new Set<string>([...GENERIC_NARRATION_KEYS, ...HINT_NARRATION_KEYS]);
  const events = new Set<string>(NARRATION_EVENT_TYPES);
  for (const l of lines) {
    if (generic.has(l.key)) continue;
    const [type, detail] = l.key.split(':', 2) as [string, string | undefined];
    if (!events.has(type!)) {
      p.push(`narration: key "${l.key}" is neither a generic key nor an event type`);
    } else if (type === 'ROOM_ENTERED' && detail !== undefined && !(ROOM_IDS as readonly string[]).includes(detail)) {
      p.push(`narration: key "${l.key}" refers to unknown room "${detail}"`);
    }
  }
  for (const key of GENERIC_NARRATION_KEYS) {
    for (const w of [0, 1, 2, 3, 4]) {
      if (!lines.some((l) => l.key === key && l.warmth === w)) p.push(`narration: "${key}" has no lines for warmth ${w}`);
    }
  }
}

/** Validate raw content and return an indexed view. Throws ContentError on any problem. */
export function loadContent(raw: RawContent): LoadedContent {
  const problems: string[] = [];
  if (!checkSchemas(raw, problems)) throw new ContentError(problems);

  const content: Content = {
    rooms: (raw.rooms as { rooms: RoomDef[] }).rooms,
    items: (raw.items as { items: ItemDef[] }).items,
    verbs: (raw.verbs as { verbs: VerbDef[] }).verbs,
    hints: (raw.hints as { hints: HintDef[] }).hints,
    narration: (raw.narration as { narration: NarrationLineDef[] }).narration,
  };

  const itemMap = checkItems(content.items, content.rooms, problems);
  checkRooms(content.rooms, itemMap, problems);
  checkVerbs(content.verbs, problems);
  checkHints(content.hints, problems);
  checkNarration(content.narration, problems);
  if (problems.length > 0) throw new ContentError(problems);

  const verbLookup: Record<string, string> = {};
  for (const v of content.verbs) {
    verbLookup[v.id.toLowerCase()] = v.id;
    for (const s of v.synonyms) verbLookup[s.toLowerCase()] = v.id;
  }
  const nounLookup: Record<string, string[]> = {};
  for (const i of content.items) {
    for (const n of [i.name, ...i.aliases]) {
      const k = n.toLowerCase();
      const ids = (nounLookup[k] ??= []);
      if (!ids.includes(i.id)) ids.push(i.id);
    }
  }

  return {
    rooms: Object.fromEntries(content.rooms.map((r) => [r.id, r])) as Record<RoomId, RoomDef>,
    items: Object.fromEntries(content.items.map((i) => [i.id, i])),
    verbs: Object.fromEntries(content.verbs.map((v) => [v.id, v])),
    hints: Object.fromEntries(content.hints.map((h) => [h.puzzle, h])) as Record<PuzzleId, HintDef>,
    narration: content.narration,
    verbLookup,
    nounLookup,
  };
}
