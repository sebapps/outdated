import type { ItemId, LoadedContent } from '../content/types';
import { normalizeText, resolveNoun } from '../parser';
import type { EngineEvent, GameState } from '../state';

export const msg = (id: string): EngineEvent => ({ type: 'MESSAGE', id });

/** True when the noun phrase names the item (by name or alias), regardless of where the item is. */
export function refers(content: LoadedContent, phrase: string | undefined, id: ItemId): boolean {
  if (phrase === undefined || normalizeText(phrase) === '') return false;
  return resolveNoun(content, phrase).includes(id);
}

/**
 * Move a just-revealed key into the inventory and report it (ITEM_TAKEN, then the `taken:<key>` line).
 * Does nothing when the key is already carried. Mutates the working copy handed to `afterStep`.
 */
export function collectKey(state: GameState, key: ItemId): EngineEvent[] {
  if (state.inventory.includes(key)) return [];
  state.inventory.push(key);
  state.itemLocations[key] = 'inventory';
  return [{ type: 'ITEM_TAKEN', item: key }, msg(`taken:${key}`)];
}
