// Task 11: the HINT command (three tiers per puzzle) and idle nudges (Requirements 9.1, 9.2).
// Hint text lives in content/hints.json and is rendered from the MESSAGE id `hint:<puzzle>:<tier>`.
// The narrator voices the surrounding `hint_lead` and `nudge` lines at the current warmth.
import type { LoadedContent, PuzzleId, RoomId } from './content/types';
import type { EngineEvent, GameState, HintTier } from './state';
import type { VerbHandler } from './step';

/** Non-progress turns in a row before the narrator offers a gentle nudge. */
export const NUDGE_AFTER_TURNS = 8;

const msg = (id: string): EngineEvent => ({ type: 'MESSAGE', id });

/** Each room hosts one puzzle; the exit (`outside`) falls back to the last puzzle. */
export function puzzleForRoom(room: RoomId): PuzzleId {
  return room === 'outside' ? 'grandparentsBedroom' : room;
}

/** Flag set when each puzzle's key is found (the puzzle counts as solved). */
export const SOLVED_FLAG: Readonly<Record<PuzzleId, string>> = {
  basement: 'atariBoxSearched',
  hallway: 'jacketSearched',
  boyhoodBedroom: 'compartmentSearched',
  study: 'diskBoxOpened',
  grandparentsBedroom: 'clockRadioOpened',
};

/** HINT: advance the current puzzle's tier (1 to 3), repeating the last tier once exhausted. */
export const hint: VerbHandler = (state: GameState, _command, content: LoadedContent) => {
  const puzzle = puzzleForRoom(state.room);
  const tiers: readonly string[] = content.hints[puzzle]?.tiers ?? [];
  if (tiers.length === 0) return [msg('cant_do')];
  if (state.flags[SOLVED_FLAG[puzzle]]) return [msg('hint_lead'), msg(`hint:${puzzle}:solved`)];
  const next = Math.min(tiers.length, state.hintTier[puzzle] + 1) as HintTier;
  // (hintTier is 0..3; content guarantees exactly three tiers.)
  state.hintTier[puzzle] = next;
  return [msg('hint_lead'), msg(`hint:${puzzle}:${next}`)];
};

/** HELP: the command list, voiced by the narrator at the current warmth (key `help`). */
export const help: VerbHandler = () => [msg('help')];

const PROGRESS_EVENTS: ReadonlySet<EngineEvent['type']> = new Set([
  'ITEM_TAKEN',
  'ITEM_SEARCHED',
  'PUZZLE_SOLVED',
  'DOOR_UNLOCKED',
  'ROOM_ENTERED',
  'SOUND',
]);

/** True when the turn did something: picked up, found, solved, unlocked, moved, or made a sound. */
export function madeProgress(events: readonly EngineEvent[]): boolean {
  return events.some((e) => PROGRESS_EVENTS.has(e.type));
}

/**
 * Computes the next idle counter and appends a `nudge` message when the threshold is reached.
 * Progress and HINT reset the counter; everything else (including failed commands) adds one.
 */
export function updateIdle(previousIdle: number, verb: string, events: EngineEvent[]): number {
  if (verb === 'HINT' || madeProgress(events)) return 0;
  const idle = previousIdle + 1;
  if (idle >= NUDGE_AFTER_TURNS) {
    events.push(msg('nudge'));
    return 0;
  }
  return idle;
}
