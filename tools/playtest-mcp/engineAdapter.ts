/**
 * engineAdapter.ts
 *
 * The ONLY file in the playtest server that knows about the game engine.
 * Everything else talks to the engine through the EngineModule interface below.
 *
 * Contract: create `src/engine/index.ts` (spec task 4) exporting these functions.
 * Until it exists, every tool returns a clear "engine not built yet" error.
 *
 * Requirements the engine must meet for these tools to work:
 *  - runInput() must be PURE: it must not mutate the state it receives.
 *  - stateKey() must ignore cosmetic fields (variantCounter, idleTurns, hintTier)
 *    so the state space stays small enough to explore.
 */

/** The engine's GameState, treated as opaque here. */
export type OpaqueState = Readonly<Record<string, unknown>>;

export interface RunResult {
  state: OpaqueState;
  /** Narration text shown to the player (canned narrator, no LLM). */
  text: string;
  /** Event type names emitted, for example ["ITEM_SEARCHED", "PUZZLE_SOLVED"]. */
  eventTypes: string[];
  /** False when the parser fell through to the unknown-input path. */
  recognized: boolean;
}

export interface StateSummary {
  room: string;
  inventory: string[];
  warmth: number;
  flags: string[]; // names of flags that are true
  ended: boolean;
}

export interface EngineModule {
  createInitialState(): OpaqueState;
  runInput(state: OpaqueState, input: string): RunResult;
  /** A finite set of commands worth trying from this state (used by find_softlocks). */
  candidateCommands(state: OpaqueState): string[];
  stateKey(state: OpaqueState): string;
  isEnded(state: OpaqueState): boolean;
  summarize(state: OpaqueState): StateSummary;
  vocabulary(): { verbs: string[]; nouns: string[] };
}

let cached: EngineModule | null = null;

export async function getEngine(): Promise<EngineModule> {
  if (cached) return cached;
  try {
    const mod = (await import('../../src/engine/index.js')) as unknown as EngineModule;
    cached = mod;
    return mod;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      'Engine not built yet. Create src/engine/index.ts exporting the EngineModule ' +
        'functions described in tools/playtest-mcp/engineAdapter.ts (spec task 4). ' +
        `Underlying error: ${reason}`,
    );
  }
}
