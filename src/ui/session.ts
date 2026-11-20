// Task 12: glue between the UI and the pure engine. No DOM here, so it is unit-testable.
// input -> interpret -> step -> events -> narrator -> lines. Never throws.
import { content as defaultContent } from '../engine/content';
import type { LoadedContent } from '../engine/content/types';
import { describeMessage } from '../engine/messages';
import { interpret } from '../engine/parser';
import { cloneState, createInitialState, type EngineEvent, type GameState } from '../engine/state';
import { step } from '../engine/step';
import { isInScope } from '../engine/world';
import { CannedNarrator, type NarratorProvider } from '../narration/canned';
import { renderEvents, type RenderedLine } from '../narration/render';

export type UiLine = RenderedLine | { kind: 'caption'; text: string };

export interface TurnResult {
  state: GameState;
  lines: UiLine[];
  events: EngineEvent[];
  ended: boolean;
}

export interface SessionDeps {
  content?: LoadedContent;
  narrator?: NarratorProvider;
}

/**
 * Adds voice-line captions to a turn. They go right after the turn's sound captions (before the first
 * narration line), and a caption already shown by the engine's own SOUND caption is not repeated.
 */
export function withVoiceCaptions(lines: readonly UiLine[], captions: readonly string[]): UiLine[] {
  const bare = (s: string): string => s.replace(/^\[+|\]+$/g, '').trim().toLowerCase();
  const shown = new Set(lines.map((l) => (l.kind === 'pause' ? '' : bare(l.text))));
  const extra: UiLine[] = captions.filter((c) => !shown.has(bare(c))).map((text) => ({ kind: 'caption', text }));
  if (extra.length === 0) return [...lines];
  const firstCaption = lines.findIndex((l) => l.kind === 'caption');
  const at = firstCaption < 0 ? -1 : lines.findIndex((l, i) => i > firstCaption && l.kind === 'text');
  if (at < 0) return [...lines, ...extra];
  return [...lines.slice(0, at), ...extra, ...lines.slice(at)];
}

/** Wraps a sound caption in exactly one pair of brackets, even if the engine's caption already has them. */
export function bracketCaption(caption: string): string {
  const inner = caption.trim().replace(/^\[/, '').replace(/\]$/, '');
  return `[${inner}]`;
}

export const TITLE = 'OUTDATED: A TEXT ADVENTURE';

async function linesFor(
  events: readonly EngineEvent[],
  state: GameState,
  deps: Required<SessionDeps>,
  canned: CannedNarrator,
): Promise<UiLine[]> {
  const out: UiLine[] = [];
  let warmth: number = state.warmth;
  for (const event of events) {
    if (event.type === 'SOUND') {
      // Every sound is also shown as text (accessibility rule 4).
      out.push({ kind: 'caption', text: bracketCaption(event.caption) });
      continue;
    }
    if (event.type === 'MESSAGE') {
      const text = describeMessage(event.id, deps.content);
      if (text !== undefined) {
        out.push({ kind: 'text', text });
        continue;
      }
    }
    const r = await renderEvents([event], { warmth, variant: state.variantCounter }, deps.narrator, canned);
    warmth = r.warmth;
    out.push(...r.lines);
  }
  return out;
}

function resolveDeps(deps: SessionDeps): { deps: Required<SessionDeps>; canned: CannedNarrator } {
  const content = deps.content ?? defaultContent;
  const canned = new CannedNarrator(content);
  return { deps: { content, narrator: deps.narrator ?? canned }, canned };
}

/** A cartridge sitting in the NES slot is still something the player can name (BLOW ON CARTRIDGE, TAKE CARTRIDGE). */
function inConsole(state: GameState, id: string): boolean {
  return state.itemLocations[id] === 'nes' && isInScope(state, 'nes');
}

export function newGame(): GameState {
  return createInitialState();
}

/** Opening text: title plus the starting room. */
export async function opening(state: GameState, depsIn: SessionDeps = {}): Promise<UiLine[]> {
  const { deps, canned } = resolveDeps(depsIn);
  const room = await linesFor([{ type: 'MESSAGE', id: `room:${state.room}` }], state, deps, canned);
  return [{ kind: 'text', text: TITLE }, ...room];
}

export async function takeTurn(
  state: GameState,
  input: string,
  depsIn: SessionDeps = {},
): Promise<TurnResult> {
  const { deps, canned } = resolveDeps(depsIn);
  const ended = (s: GameState): boolean => s.flags.ended === true;
  try {
    const parsed = interpret(input, deps.content, {
      inScope: (id) => isInScope(state, id) || inConsole(state, id),
      variant: state.variantCounter,
      held: (id) => state.inventory.includes(id),
      roomItems: deps.content.rooms[state.room]?.items,
    });
    if (!parsed.ok) {
      const next = cloneState(state);
      next.variantCounter = state.variantCounter + 1;
      const e = parsed.event;
      const events: EngineEvent[] =
        e.type === 'UNKNOWN_VERB' ? [{ type: 'MESSAGE', id: 'unknown_verb' }] : [];
      // The narrator's warmth-matched bank covers unknown verbs; other parser problems carry their own text.
      const lines: UiLine[] =
        e.type === 'UNKNOWN_VERB'
          ? await linesFor(events, state, deps, canned)
          : [{ kind: 'text', text: e.text }];
      if (lines.length === 0) lines.push({ kind: 'text', text: e.text });
      return { state: next, lines, events, ended: ended(next) };
    }
    const { newState, events } = step(state, parsed.command, deps.content);
    const lines = await linesFor(events, state, deps, canned);
    return { state: newState, lines, events, ended: ended(newState) };
  } catch {
    // Defensive: the UI must never crash the terminal.
    return { state, lines: [{ kind: 'text', text: 'The tape warbles. Try that again.' }], events: [], ended: ended(state) };
  }
}
