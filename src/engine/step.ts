// The engine's single entry point. Pure and deterministic: no DOM, network, audio or randomness.
// Verb handlers (movement, inventory, puzzles) plug into `handlers` in later tasks.
import { content as defaultContent } from './content';
import type { LoadedContent } from './content/types';
import type { Command } from './parser';
import { help, hint, updateIdle } from './hints';
import { runAfterStepHooks, runPuzzleHandlers } from './puzzles';
import { worldHandlers } from './world';
import { cloneState, type EngineEvent, type GameState, type StepResult } from './state';

/** A handler mutates the working copy of the state and returns the events it produced. */
export type VerbHandler = (state: GameState, command: Command, content: LoadedContent) => EngineEvent[];

const handlers: Record<string, VerbHandler> = { ...worldHandlers, HINT: hint, HELP: help };

export function step(
  state: GameState,
  command: Command,
  content: LoadedContent = defaultContent,
): StepResult {
  // The ending is terminal (7.6): once it has fired, further commands change nothing and produce nothing.
  if (state.flags.ended === true) return { newState: cloneState(state), events: [] };
  const newState = cloneState(state);
  const handler = handlers[command.verb];
  const events: EngineEvent[] =
    runPuzzleHandlers(newState, command, content) ??
    (handler ? handler(newState, command, content) : [{ type: 'MESSAGE', id: 'cant_do' }]);
  events.push(...runAfterStepHooks(newState, content));

  newState.variantCounter = state.variantCounter + 1;
  newState.idleTurns = updateIdle(state.idleTurns, command.verb, events);
  return { newState, events };
}
