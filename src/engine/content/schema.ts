// JSON schemas for each content file. Shape only; cross-reference checks live in loader.ts.
import { PUZZLE_IDS, ROOM_IDS } from './types';

const str = { type: 'string', minLength: 1 } as const;
const idStr = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]*$' } as const;
const strList = { type: 'array', items: str } as const;
const roomEnum = { enum: [...ROOM_IDS] } as const;
const puzzleEnum = { enum: [...PUZZLE_IDS] } as const;

const file = (key: string, item: object) => ({
  type: 'object',
  required: [key],
  additionalProperties: false,
  properties: { _note: { type: 'string' }, [key]: { type: 'array', items: item } },
});

export const roomsSchema = file('rooms', {
  type: 'object',
  required: ['id', 'name', 'description', 'puzzle', 'items', 'exits'],
  additionalProperties: false,
  properties: {
    id: roomEnum,
    name: str,
    description: str,
    puzzle: { enum: [...PUZZLE_IDS, null] },
    items: { type: 'array', items: idStr },
    exits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['direction', 'to', 'lockedText', 'passText'],
        additionalProperties: false,
        properties: {
          direction: str,
          to: roomEnum,
          requiresKey: idStr,
          lockedText: str,
          passText: str,
        },
      },
    },
  },
});

export const itemsSchema = file('items', {
  type: 'object',
  required: ['id', 'name', 'aliases', 'description', 'takeable'],
  additionalProperties: false,
  properties: {
    id: idStr,
    name: str,
    aliases: strList,
    description: str,
    takeable: { type: 'boolean' },
    room: roomEnum,
    inside: idStr,
    opens: roomEnum,
    initialState: str,
    states: { type: 'object', additionalProperties: str },
    decoyLine: str,
    decoyLineLate: str,
  },
});

export const verbsSchema = file('verbs', {
  type: 'object',
  required: ['id', 'synonyms', 'objects'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[A-Z]+$' },
    synonyms: strList,
    objects: { enum: [0, 1, 2] },
    prepositions: strList,
  },
});

export const hintsSchema = file('hints', {
  type: 'object',
  required: ['puzzle', 'tiers', 'solved'],
  additionalProperties: false,
  properties: {
    puzzle: puzzleEnum,
    tiers: { type: 'array', items: str, minItems: 3, maxItems: 3 },
    solved: str,
  },
});

export const narrationSchema = file('narration', {
  type: 'object',
  required: ['key', 'warmth', 'variants'],
  additionalProperties: false,
  properties: {
    key: str,
    warmth: { enum: [0, 1, 2, 3, 4] },
    variants: { type: 'array', items: str, minItems: 1 },
  },
});
