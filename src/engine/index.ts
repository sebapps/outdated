import { CannedNarrator } from '../narration/canned';
import { nextWarmth, renderSilenceBeat } from '../narration/render';
import { content } from './content';
import { describeMessage } from './messages';
import { interpret } from './parser';
import { cloneState, type EngineEvent, type GameState } from './state';
import { step } from './step';
import { isInScope } from './world';

export { step, type VerbHandler } from './step';
export { pickVariant, pickVariantIndex } from './variant';
export {
  createInitialState,
  cloneState,
  type GameState,
  type EngineEvent,
  type StepResult,
  type SoundCue,
  type HintTier,
  type Command,
} from './state';

// ---------------------------------------------------------------------------
// Playtest adapter surface (tools/playtest-mcp/engineAdapter.ts, task 16.1).
// Pure and synchronous: canned narration only, no LLM, DOM, audio or network.
// ---------------------------------------------------------------------------

export interface RunResult {
  state: GameState;
  text: string;
  eventTypes: string[];
  recognized: boolean;
}

export interface StateSummary {
  room: string;
  inventory: string[];
  warmth: number;
  flags: string[];
  ended: boolean;
}

const canned = new CannedNarrator(content);
const DIRECTIONS = ['up', 'down', 'north', 'south', 'east', 'west'];

/** The cartridge in the NES slot is still nameable (mirrors ui/session.ts). */
function reachable(state: GameState, id: string): boolean {
  return isInScope(state, id) || (state.itemLocations[id] === 'nes' && isInScope(state, 'nes'));
}

function narrate(events: readonly EngineEvent[], state: GameState): string {
  const out: string[] = [];
  let warmth: number = state.warmth;
  for (const event of events) {
    warmth = nextWarmth(warmth, event);
    const ctx = { warmth, variant: state.variantCounter };
    if (event.type === 'SOUND') {
      out.push(`[${event.caption.replace(/^\[|\]$/g, '')}]`);
    } else if (event.type === 'SILENCE_BEAT') {
      for (const l of renderSilenceBeat(canned, ctx)) if (l.kind === 'text') out.push(l.text);
    } else if (event.type === 'MESSAGE') {
      const text = describeMessage(event.id, content) ?? canned.lookup(event, ctx);
      if (text !== undefined && text !== '') out.push(text);
    } else if (event.type !== 'WARMTH_CHANGED') {
      const text = canned.lookup(event, ctx);
      if (text !== undefined && text !== '') out.push(text);
    }
  }
  return out.join('\n');
}

/** One player input. Never mutates `state`. */
export function runInput(state: GameState, input: string): RunResult {
  const parsed = interpret(input, content, {
    inScope: (id) => reachable(state, id),
    variant: state.variantCounter,
    held: (id) => state.inventory.includes(id),
    roomItems: content.rooms[state.room]?.items,
  });
  if (!parsed.ok) {
    const next = cloneState(state);
    next.variantCounter = state.variantCounter + 1;
    const e = parsed.event;
    const bank = e.type === 'UNKNOWN_VERB' ? narrate([{ type: 'MESSAGE', id: 'unknown_verb' }], state) : '';
    return { state: next, text: bank !== '' ? bank : e.text, eventTypes: [e.type], recognized: false };
  }
  const { newState, events } = step(state, parsed.command, content);
  return { state: newState, text: narrate(events, state), eventTypes: events.map((e) => e.type), recognized: true };
}

/** A finite set of commands worth trying from this state. */
export function candidateCommands(state: GameState): string[] {
  const out = new Set<string>(['look', 'inventory', 'help', 'hint']);
  for (const d of DIRECTIONS) out.add(`go ${d}`);
  out.add('dial 5550142');
  out.add('adjust tracking');
  out.add('unlock door');
  out.add('open door');
  const here = Object.values(content.items).filter((it) => reachable(state, it.id));
  const single = ['examine', 'take', 'drop', 'search', 'open', 'play', 'stop', 'press', 'plug in', 'unfold', 'reverse', 'blow on', 'remove'];
  for (const it of here) {
    const loc = state.itemLocations[it.id];
    for (const v of single) {
      if (v === 'take' && loc === 'inventory') continue;
      if (v === 'drop' && loc !== 'inventory') continue;
      out.add(`${v} ${it.name}`);
    }
  }
  for (const a of here) {
    for (const b of here) {
      if (a.id === b.id) continue;
      out.add(`insert ${a.name} into ${b.name}`);
      out.add(`rewind ${a.name} with ${b.name}`);
      out.add(`use ${a.name} on ${b.name}`);
    }
  }
  return [...out];
}

/** Identity of a state for exploration. Ignores variantCounter, idleTurns and hintTier. */
export function stateKey(s: GameState): string {
  const flags = Object.keys(s.flags).filter((k) => s.flags[k]).sort();
  return JSON.stringify([
    s.room,
    [...s.inventory].sort(),
    flags,
    Object.entries(s.itemStates).sort(),
    [...s.unlockedDoors].sort(),
    Object.entries(s.itemLocations).sort(),
    s.warmth,
  ]);
}

export function isEnded(s: GameState): boolean {
  return s.flags.ended === true;
}

export function summarize(s: GameState): StateSummary {
  return {
    room: s.room,
    inventory: [...s.inventory],
    warmth: s.warmth,
    flags: Object.keys(s.flags).filter((k) => s.flags[k]).sort(),
    ended: isEnded(s),
  };
}

export function vocabulary(): { verbs: string[]; nouns: string[] } {
  const verbs = new Set<string>();
  for (const v of Object.values(content.verbs)) {
    verbs.add(v.id.toLowerCase());
    for (const s of v.synonyms) verbs.add(s.toLowerCase());
  }
  const nouns = new Set<string>();
  for (const it of Object.values(content.items)) {
    nouns.add(it.name.toLowerCase());
    for (const a of it.aliases) nouns.add(a.toLowerCase());
  }
  return { verbs: [...verbs].sort(), nouns: [...nouns].sort() };
}
