// Task 10.2: warmth transitions and silence-beat handling.
// SILENCE_BEAT events bypass the narrator provider (so an LLM can never joke over one) and render
// a short pause plus an optional single sincere line from content. Warmth never decreases.
import type { EngineEvent } from '../engine/state';
import { CannedNarrator, type NarrationContext, type NarratorProvider } from './canned';

export type RenderedLine =
  | { kind: 'text'; text: string }
  | { kind: 'pause'; ms: number };

export const SILENCE_PAUSE_MS = 1500;

function clamp(w: number): number {
  return Number.isFinite(w) ? Math.min(4, Math.max(0, Math.trunc(w))) : 0;
}

/** Next warmth after an event: only WARMTH_CHANGED can move it, and only upward. */
export function nextWarmth(current: number, event: EngineEvent): number {
  const cur = clamp(current);
  return event.type === 'WARMTH_CHANGED' ? Math.max(cur, clamp(event.level)) : cur;
}

/** A pause followed by at most one sincere line, never a joke. Canned content only. */
export function renderSilenceBeat(canned: CannedNarrator, ctx: NarrationContext): RenderedLine[] {
  const out: RenderedLine[] = [{ kind: 'pause', ms: SILENCE_PAUSE_MS }];
  const line = canned.lookup({ type: 'SILENCE_BEAT' }, ctx);
  if (line !== undefined && line !== '') out.push({ kind: 'text', text: line });
  return out;
}

/**
 * Renders a turn's events in order, tracking warmth as WARMTH_CHANGED events arrive.
 * Returns the lines to show and the resulting warmth (never lower than ctx.warmth).
 */
export async function renderEvents(
  events: readonly EngineEvent[],
  ctx: NarrationContext,
  narrator: NarratorProvider,
  canned: CannedNarrator,
): Promise<{ lines: RenderedLine[]; warmth: number }> {
  const lines: RenderedLine[] = [];
  let warmth = clamp(ctx.warmth);
  for (const event of events) {
    warmth = nextWarmth(warmth, event);
    const here = { ...ctx, warmth };
    if (event.type === 'SILENCE_BEAT') {
      lines.push(...renderSilenceBeat(canned, here));
    } else if (event.type !== 'WARMTH_CHANGED') {
      const text = await narrator.narrate(event, here);
      if (text !== '') lines.push({ kind: 'text', text });
    }
  }
  return { lines, warmth };
}
