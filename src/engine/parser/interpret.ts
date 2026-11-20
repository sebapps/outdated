// Task 3.2: unknown-input and ambiguity handling.
// `interpret` wraps `parse` and resolves noun phrases to item ids. It never throws; every
// problem comes back as a ParserEvent for the engine to emit and the narrator to dress up.
// Each event carries a short in-character `text` fallback (never a generic error) that
// suggests what could be tried. The narrator (task 10) may replace it using warmth.
import type { ItemId, LoadedContent } from '../content/types';
import { pickVariant } from '../variant';
import { parse, resolveNoun, type Command } from './parser';

export type ParserEvent =
  | { type: 'EMPTY_INPUT'; text: string }
  | { type: 'UNKNOWN_VERB'; input: string; suggestions: string[]; text: string }
  | { type: 'UNKNOWN_NOUN'; verb: string; phrase: string; slot: 'direct' | 'indirect'; suggestions: string[]; text: string }
  | {
      type: 'AMBIGUOUS';
      verb: string;
      phrase: string;
      slot: 'direct' | 'indirect';
      candidates: ItemId[];
      /** One short clarifying question, e.g. "Which do you mean, the hallway key or the bedroom key?" */
      question: string;
      text: string;
    };

export type InterpretResult =
  | { ok: true; command: Command; direct?: ItemId; indirect?: ItemId }
  | { ok: false; event: ParserEvent };

export interface InterpretOptions {
  /** Which items count as reachable right now (current room + inventory). Default: every item. */
  inScope?: (id: ItemId) => boolean;
  /** Rotates between wording variants. Supplied by the engine's seeded selector; no Math.random here. */
  variant?: number;
  /** Items already carried. TAKE prefers items that are not (so TAKE KEY finds the new key). */
  held?: (id: ItemId) => boolean;
  /** Items of the current room. Suggestions list these before carried items. */
  roomItems?: readonly ItemId[];
}

/** Verbs whose objects are not necessarily items (numbers, directions, settings). */
const FREEFORM_OBJECT_VERBS = new Set(['GO', 'DIAL', 'SET']);

/** Safe starter verbs offered when the verb is unknown. Never reveals a puzzle solution. */
/** Door words are exits, not items: OPEN DOOR, UNLOCK DOOR and USE KEY ON DOOR go to the engine as typed. */
const DOOR_PHRASE = /^(?:the )?(?:\w+ )?(?:door|stairs|staircase)$/;
const DOOR_VERBS = new Set(['OPEN', 'UNLOCK', 'USE']);

const STARTER_SUGGESTIONS = ['LOOK', 'EXAMINE', 'TAKE', 'INVENTORY'];

const UNKNOWN_VERB_LINES = [
  (s: string) => `That's not in my 80s vocabulary. Try ${s}.`,
  (s: string) => `Nobody in 1987 would know what that means. Try ${s}.`,
  (s: string) => `Doesn't compute. Maybe ${s}?`,
  (s: string) => `Rewind and try again. ${s} are good places to start.`,
];

const UNKNOWN_NOUN_LINES = [
  (p: string, s: string) => `No "${p}" around here. ${s}`,
  (p: string, s: string) => `You look for a "${p}" and come up empty. ${s}`,
  (p: string, s: string) => `A "${p}"? Not that you can see. ${s}`,
  (p: string, s: string) => `Nothing like a "${p}" in reach. ${s}`,
];

const EMPTY_LINES = [
  'Silence on the line. Try LOOK to get your bearings.',
  'The cursor blinks at you. LOOK is a fine start.',
];

function pick<T>(list: readonly T[], variant: number): T {
  return pickVariant(list, variant);
}

function listOr(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}`;
}

function nameOf(content: LoadedContent, id: ItemId): string {
  return content.items[id]?.name ?? id;
}

function withArticle(name: string): string {
  return `the ${name}`;
}

/** Item names currently in scope, used for "try examining ..." suggestions. */
function scopedNames(
  content: LoadedContent,
  inScope: (id: ItemId) => boolean,
  max: number,
  roomItems: readonly ItemId[] = [],
): string[] {
  const all = Object.values(content.items).filter((item) => inScope(item.id) && item.inside === undefined);
  const inRoom = all.filter((item) => roomItems.includes(item.id));
  const rest = all.filter((item) => !roomItems.includes(item.id));
  return [...inRoom, ...rest].slice(0, max).map((item) => item.name.toLowerCase());
}

function resolveSlot(
  content: LoadedContent,
  command: Command,
  slot: 'direct' | 'indirect',
  phrase: string,
  opts: Required<Pick<InterpretOptions, 'inScope' | 'variant'>> & Pick<InterpretOptions, 'held' | 'roomItems'>,
): { id: ItemId } | { event: ParserEvent } {
  const known = resolveNoun(content, phrase);
  let candidates = known.filter(opts.inScope);
  if (candidates.length > 1 && command.verb === 'TAKE' && opts.held !== undefined) {
    const notHeld = candidates.filter((id) => !opts.held?.(id));
    if (notHeld.length >= 1) candidates = notHeld;
    // All carried: no question needed. The world answers already_held.
    else return { id: candidates[0] as ItemId };
  }

  if (candidates.length === 1) return { id: candidates[0] as ItemId };

  if (candidates.length > 1) {
    const names = candidates.map((id) => withArticle(nameOf(content, id).toLowerCase()));
    const question = `Which do you mean, ${listOr(names)}?`;
    return {
      event: {
        type: 'AMBIGUOUS', verb: command.verb, phrase, slot, candidates, question, text: question,
      },
    };
  }

  // Nothing in scope: suggest examining things that really are within reach.
  const here = scopedNames(content, opts.inScope, 3, opts.roomItems);
  const hint = here.length > 0 ? `Try EXAMINE with ${listOr(here)}.` : 'Try LOOK.';
  return {
    event: {
      type: 'UNKNOWN_NOUN',
      verb: command.verb,
      phrase,
      slot,
      suggestions: here,
      text: pick(UNKNOWN_NOUN_LINES, opts.variant)(phrase, hint),
    },
  };
}

/** Parse and resolve one line of input. Never throws. */
export function interpret(input: string, content: LoadedContent, options: InterpretOptions = {}): InterpretResult {
  try {
    const opts = { inScope: options.inScope ?? (() => true), variant: options.variant ?? 0, held: options.held, roomItems: options.roomItems };
    const parsed = parse(typeof input === 'string' ? input : '', content);

    if (!parsed.ok) {
      if (parsed.reason === 'empty') {
        return { ok: false, event: { type: 'EMPTY_INPUT', text: pick(EMPTY_LINES, opts.variant) } };
      }
      const suggestions = STARTER_SUGGESTIONS.filter((v) => content.verbs[v] !== undefined);
      return {
        ok: false,
        event: {
          type: 'UNKNOWN_VERB',
          input: parsed.input,
          suggestions,
          text: pick(UNKNOWN_VERB_LINES, opts.variant)(listOr(suggestions)),
        },
      };
    }

    const { command } = parsed;
    const result: { ok: true; command: Command; direct?: ItemId; indirect?: ItemId } = { ok: true, command };
    if (FREEFORM_OBJECT_VERBS.has(command.verb)) return result;

    for (const slot of ['direct', 'indirect'] as const) {
      const phrase = slot === 'direct' ? command.directObject : command.indirectObject;
      if (phrase === undefined) continue;
      if (DOOR_VERBS.has(command.verb) && DOOR_PHRASE.test(phrase.trim().toLowerCase()) && !resolveNoun(content, phrase).some(opts.inScope)) continue;
      const r = resolveSlot(content, command, slot, phrase, opts);
      if ('event' in r) return { ok: false, event: r.event };
      result[slot] = r.id;
    }
    return result;
  } catch {
    // Defensive: the contract is "never throws".
    return { ok: false, event: { type: 'EMPTY_INPUT', text: pick(EMPTY_LINES, 0) } };
  }
}
