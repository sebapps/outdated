// Contract every puzzle module implements. Tasks 6-9 add one module each and register it
// in ./index.ts; nothing else in the engine needs to change.
import type { LoadedContent, RoomId } from '../content/types';
import type { Command } from '../parser';
import type { EngineEvent, GameState } from '../state';

/**
 * Mutates the working copy of the state and returns the events it produced, or returns
 * `undefined` to decline the command so the next module (and finally the world handlers)
 * can deal with it.
 */
export type PuzzleHandler = (state: GameState, command: Command, content: LoadedContent) => EngineEvent[] | undefined;

export interface PuzzleModule {
  /** Handlers only run while the player is in this room. */
  room: RoomId;
  /** Verb id -> handler. */
  handlers: Record<string, PuzzleHandler>;
  /**
   * Text for the content-addressed MESSAGE ids this module emits (ids are `<puzzle>:<name>`).
   * Narrator-owned banks (`cant_do`, `already_done`) are not listed here.
   */
  messages: Record<string, string>;
  /**
   * Runs after every command, in any room, on the working copy. Derive progress flags,
   * rewards, PUZZLE_SOLVED and warmth here. Must be idempotent.
   */
  afterStep?: (state: GameState, content: LoadedContent) => EngineEvent[];
}
