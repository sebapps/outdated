// Parser: turns a line of player input into a Command. Pure and deterministic.
// Task 3.1 covers normalization, verb/noun synonym tables and two-object commands.
// Ambiguity handling and in-character fallbacks are task 3.2.
import type { ItemId, LoadedContent } from '../content/types';

export interface Command {
  /** Canonical verb id, e.g. "REWIND". */
  verb: string;
  /** Cleaned noun phrase, e.g. "cassette". Resolve with `resolveNoun`. */
  directObject?: string;
  /** Cleaned noun phrase after a preposition, e.g. "pencil". */
  indirectObject?: string;
}

export type ParseResult =
  | { ok: true; command: Command }
  | { ok: false; reason: 'empty' | 'unknown_verb'; input: string };

/** Words dropped from the start of a noun phrase. */
const FILLER_WORDS = new Set(['the', 'a', 'an', 'to']);

/** Locational words dropped from the start of a noun phrase ("search under foam", "go through door"). */
const LEADING_LOCATIVES = new Set([
  'under', 'behind', 'inside', 'through', 'at', 'on', 'in', 'into', 'over', 'onto', 'from',
]);

/** Manner words that may trail the object but belong to the verb phrase. */
const TRAILING_MANNER_WORDS = new Set(['counterclockwise', 'backwards', 'backward']);

/** Particles that may trail the line but belong next to the verb ("pick it up", "turn it on"). */
const PARTICLES = new Set(['up', 'in', 'on', 'out', 'over', 'around', 'back', 'down']);

/** Articles skipped while matching verb phrases. Noun phrases keep them. */
const ARTICLES = new Set(['the', 'a', 'an']);

/** Single-letter abbreviations that are only verbs on their own ("i need a hint" is not INVENTORY). */
const SOLO_ABBREVIATIONS = new Set(['i', 'l']);

/**
 * Lowercase, strip punctuation, collapse whitespace.
 * "555-0142" -> "5550142"; "Rubik's" -> "rubiks"; "View-Master" -> "view master".
 */
export function normalizeText(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/(\d)-(?=\d)/g, '$1')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return s;
}

function tokenize(input: string): string[] {
  const norm = normalizeText(input);
  if (norm === '') return input.trim() === '?' ? ['?'] : [];
  return norm.split(' ');
}

interface Tables {
  /** Normalized verb phrase -> canonical verb id. */
  verbs: Map<string, string>;
  maxVerbWords: number;
  /** Normalized noun phrase -> item ids. */
  nouns: Map<string, ItemId[]>;
}

const tableCache = new WeakMap<LoadedContent, Tables>();

function tablesFor(content: LoadedContent): Tables {
  let t = tableCache.get(content);
  if (t) return t;
  const verbs = new Map<string, string>();
  let maxVerbWords = 1;
  for (const [phrase, id] of Object.entries(content.verbLookup)) {
    const key = phrase === '?' ? '?' : normalizeText(phrase);
    if (key === '') continue;
    // Articles inside a verb phrase are skipped when matching ("take a look at" -> "take look at").
    const words = key.split(' ');
    const bare = words.length > 1 ? words.filter((w, i) => i === 0 || !ARTICLES.has(w)).join(' ') : key;
    verbs.set(bare, id);
    maxVerbWords = Math.max(maxVerbWords, bare.split(' ').length);
  }
  const nouns = new Map<string, ItemId[]>();
  for (const [phrase, ids] of Object.entries(content.nounLookup)) {
    const key = normalizeText(phrase);
    const list = nouns.get(key) ?? [];
    for (const id of ids) if (!list.includes(id)) list.push(id);
    nouns.set(key, list);
  }
  t = { verbs, maxVerbWords, nouns };
  tableCache.set(content, t);
  return t;
}

/** Strip leading filler words and locatives, but never empty the phrase completely. */
function cleanPhrase(tokens: string[]): string | undefined {
  let i = 0;
  while (i < tokens.length - 1 && (FILLER_WORDS.has(tokens[i]!) || LEADING_LOCATIVES.has(tokens[i]!))) i++;
  const rest = tokens.slice(i);
  if (rest.length === 0) return undefined;
  if (rest.length === 1 && (FILLER_WORDS.has(rest[0]!) || LEADING_LOCATIVES.has(rest[0]!))) return undefined;
  return rest.join(' ');
}

/** All item ids whose name or alias equals the phrase (after normalization). Order follows content order. */
export function resolveNoun(content: LoadedContent, phrase: string): ItemId[] {
  return [...(tablesFor(content).nouns.get(normalizeText(phrase)) ?? [])];
}

/** Parse one line of input. Never throws. */
export function parse(input: string, content: LoadedContent): ParseResult {
  let tokens = tokenize(input);
  if (tokens.length === 0) return { ok: false, reason: 'empty', input };

  const { verbs, maxVerbWords } = tablesFor(content);

  // "turn record counterclockwise" -> "turn counterclockwise record": a trailing
  // manner word that completes a verb phrase is moved next to the verb.
  if (tokens.length >= 3) {
    const last = tokens[tokens.length - 1]!;
    if (TRAILING_MANNER_WORDS.has(last) && verbs.has(`${tokens[0]} ${last}`)) {
      tokens = [tokens[0]!, last, ...tokens.slice(1, -1)];
    }
  }

  // "pick the pencil up" -> "pick up the pencil": a trailing particle that completes a verb
  // phrase is moved next to the verb. Otherwise it is dropped from the noun phrase below.
  if (tokens.length >= 3) {
    const last = tokens[tokens.length - 1]!;
    if (PARTICLES.has(last) && verbs.has(`${tokens[0]} ${last}`)) {
      tokens = [tokens[0]!, last, ...tokens.slice(1, -1)];
    }
  }

  // Longest verb phrase wins: "look at" beats "look", "plug in" beats "plug".
  // Articles between verb words are skipped ("fix the tracking" matches "fix tracking").
  const at: number[] = [];
  tokens.forEach((w, i) => {
    if (i === 0 || !ARTICLES.has(w)) at.push(i);
  });
  let verb: string | undefined;
  let used = 0;
  let objectFromSkip: string | undefined;
  for (let n = Math.min(maxVerbWords, at.length); n >= 1; n--) {
    const hit = verbs.get(at.slice(0, n).map((i) => tokens[i]).join(' '));
    if (hit !== undefined) {
      verb = hit;
      used = at[n - 1]! + 1;
      // "fix the tracking": an article right before the last verb word means that word is the object.
      if (n > 1 && at[n - 1]! - at[n - 2]! > 1 && used === tokens.length) objectFromSkip = tokens[used - 1];
      break;
    }
  }
  if (verb === undefined) return { ok: false, reason: 'unknown_verb', input };
  if (used === 1 && SOLO_ABBREVIATIONS.has(tokens[0]!) && tokens.length > 1) {
    return { ok: false, reason: 'unknown_verb', input };
  }

  const def = content.verbs[verb];
  let rest = tokens.slice(used);
  const command: Command = { verb };
  if (objectFromSkip !== undefined && def && def.objects > 0) {
    command.directObject = objectFromSkip;
    return { ok: true, command };
  }
  // "flip the record over": drop a trailing particle when something else remains.
  if (rest.length > 1 && PARTICLES.has(rest[rest.length - 1]!)) rest = rest.slice(0, -1);

  if (!def || def.objects === 0 || rest.length === 0) return { ok: true, command };

  if (def.objects === 2) {
    const preps = new Set((def.prepositions ?? []).map((p) => p.toLowerCase()));
    const at = rest.findIndex((w) => preps.has(w));
    if (at !== -1) {
      const direct = cleanPhrase(rest.slice(0, at));
      const indirect = cleanPhrase(rest.slice(at + 1));
      if (direct !== undefined) command.directObject = direct;
      if (indirect !== undefined) command.indirectObject = indirect;
      return { ok: true, command };
    }
  }

  const direct = cleanPhrase(rest);
  if (direct !== undefined) command.directObject = direct;
  return { ok: true, command };
}
