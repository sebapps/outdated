// Task 10.1: narration provider interface and the always-available CannedNarrator.
// Lines come from content/narration.json; selection is deterministic (no Math.random).
import type { EngineEvent } from '../engine/state';
import type { LoadedContent, NarrationLineDef } from '../engine/content/types';
import { pickVariant } from '../engine/variant';

export interface NarrationContext {
  warmth: number;
  /** Seeded GameState.variantCounter. */
  variant: number;
}

export interface NarratorProvider {
  narrate(event: EngineEvent, ctx: NarrationContext): Promise<string>;
}

/** Candidate narration keys for an event, most specific first. */
export function narrationKeys(event: EngineEvent): string[] {
  switch (event.type) {
    case 'MESSAGE':
      return [event.id];
    case 'ROOM_ENTERED':
      return [`ROOM_ENTERED:${event.room}`, 'ROOM_ENTERED'];
    default:
      return [event.type];
  }
}

function clampWarmth(w: number): number {
  if (!Number.isFinite(w)) return 0;
  return Math.min(4, Math.max(0, Math.trunc(w)));
}

export class CannedNarrator implements NarratorProvider {
  private readonly lines: NarrationLineDef[];

  constructor(content: Pick<LoadedContent, 'narration'>) {
    this.lines = content.narration;
  }

  /** Returns the chosen line, or undefined when the bank has nothing for this event. */
  lookup(event: EngineEvent, ctx: NarrationContext): string | undefined {
    const warmth = clampWarmth(ctx.warmth);
    for (const key of narrationKeys(event)) {
      const exact = this.lines.find((l) => l.key === key && l.warmth === warmth);
      if (exact && exact.variants.length > 0) return pickVariant(exact.variants, ctx.variant, `${key}@${warmth}`);
    }
    // Fall back to the nearest warmth level that has lines for the key.
    for (const key of narrationKeys(event)) {
      const near = this.lines
        .filter((l) => l.key === key && l.variants.length > 0)
        .sort((a, b) => Math.abs(a.warmth - warmth) - Math.abs(b.warmth - warmth) || a.warmth - b.warmth)[0];
      if (near) return pickVariant(near.variants, ctx.variant, `${key}@${near.warmth}`);
    }
    return undefined;
  }

  async narrate(event: EngineEvent, ctx: NarrationContext): Promise<string> {
    return this.lookup(event, ctx) ?? '';
  }
}
