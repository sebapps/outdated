// Registry of puzzle modules. Tasks 6-9: add the new module to PUZZLE_MODULES.
import type { LoadedContent } from '../content/types';
import type { Command } from '../parser';
import type { EngineEvent, GameState } from '../state';
import { basementPuzzle } from './basement';
import { boyhoodBedroomPuzzle } from './boyhoodBedroom';
import { grandparentsBedroomPuzzle } from './grandparentsBedroom';
import { hallwayPuzzle } from './hallway';
import { studyPuzzle } from './study';
import type { PuzzleModule } from './types';

export type { PuzzleHandler, PuzzleModule } from './types';

export const PUZZLE_MODULES: readonly PuzzleModule[] = [basementPuzzle, hallwayPuzzle, boyhoodBedroomPuzzle, studyPuzzle, grandparentsBedroomPuzzle];

/** Text for every puzzle-owned MESSAGE id. */
export const PUZZLE_MESSAGES: Readonly<Record<string, string>> = Object.assign(
  {},
  ...PUZZLE_MODULES.map((m) => m.messages),
);

/** First module (for the player's current room) that accepts the command wins; undefined = nobody did. */
export function runPuzzleHandlers(state: GameState, command: Command, content: LoadedContent): EngineEvent[] | undefined {
  for (const mod of PUZZLE_MODULES) {
    if (mod.room !== state.room) continue;
    const events = mod.handlers[command.verb]?.(state, command, content);
    if (events !== undefined) return events;
  }
  return undefined;
}

/** Runs every module's afterStep hook and collects the events. */
export function runAfterStepHooks(state: GameState, content: LoadedContent): EngineEvent[] {
  return PUZZLE_MODULES.flatMap((m) => m.afterStep?.(state, content) ?? []);
}
