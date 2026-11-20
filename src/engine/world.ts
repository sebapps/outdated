// World verbs: LOOK, EXAMINE, TAKE, DROP, INVENTORY, SEARCH, OPEN, GO, UNLOCK, USE (key on door).
// Pure handlers: they mutate only the working copy of the state handed in by `step`.
//
// MESSAGE ids are content-addressed so the narrator/UI can render them (see messages.ts):
//   room:<room>                 item:<item>[:<state>]        decoy:<item> / decoy_late:<item>
//   exit:<room>:<direction>     exit_locked:<room>:<direction>   unlocked:<room>:<direction>
//   taken:<item> dropped:<item> inventory:<a,b>              found:<container>:<a,b> opened:<container>:<a,b>
//   plus fixed ids: not_here, need_object, ambiguous:<a,b>, already_held, not_carrying, cant_take:<item>,
//   cant_drop:<item>, inventory_empty, search_nothing:<item>, no_exit, ambiguous_exit, wrong_key.
// Generic ids `cant_do` and `already_done` are narration banks.
import type { ExitDef, ItemId, LoadedContent, RoomDef } from './content/types';
import { normalizeText, resolveNoun, type Command } from './parser';
import type { EngineEvent, GameState } from './state';
import type { VerbHandler } from './step';

/** Items the player may never lose (the pencil returns in the ending). */
export const PERMANENT_ITEMS: readonly ItemId[] = ['pencil'];

const msg = (id: string): EngineEvent => ({ type: 'MESSAGE', id });

/** An item is in reach when it is carried or lying in the current room (not hidden). */
export function isInScope(state: GameState, id: ItemId): boolean {
  return state.inventory.includes(id) || state.itemLocations[id] === state.room;
}

type Resolved = { id: ItemId } | { events: EngineEvent[] };

/** Resolve a noun phrase against the current room and inventory. */
function resolveTarget(
  state: GameState,
  content: LoadedContent,
  phrase: string | undefined,
  prefer?: (id: ItemId) => boolean,
): Resolved {
  if (phrase === undefined) return { events: [msg('need_object')] };
  let found = resolveNoun(content, phrase).filter((id) => isInScope(state, id));
  if (found.length === 0) return { events: [msg('not_here')] };
  if (found.length > 1) {
    const norm = normalizeText(phrase);
    const exact = found.filter((id) => normalizeText(content.items[id]?.name ?? '') === norm);
    if (exact.length >= 1) found = exact;
  }
  if (found.length > 1 && prefer !== undefined) {
    const preferred = found.filter(prefer);
    if (preferred.length >= 1) found = preferred;
  }
  if (found.length > 1) return { events: [msg(`ambiguous:${found.join(',')}`)] };
  return { id: found[0] as ItemId };
}

function hiddenContents(state: GameState, content: LoadedContent, container: ItemId): ItemId[] {
  return Object.values(content.items)
    .filter((i) => i.inside === container && state.itemLocations[i.id] === 'hidden')
    .map((i) => i.id);
}

function hasContents(content: LoadedContent, container: ItemId): boolean {
  return Object.values(content.items).some((i) => i.inside === container);
}

/** An already-revealed child of `container` that is itself still hiding something (a nudge for repeat searches). */
function deeperContainer(state: GameState, content: LoadedContent, container: ItemId): ItemId | undefined {
  return Object.values(content.items).find(
    (i) =>
      i.inside === container &&
      state.itemLocations[i.id] === state.room &&
      hiddenContents(state, content, i.id).length > 0,
  )?.id;
}

/** Move hidden contents into the current room and report them. */
function reveal(
  state: GameState,
  content: LoadedContent,
  container: ItemId,
  kind: 'found' | 'opened',
): EngineEvent[] {
  const revealed = hiddenContents(state, content, container);
  const events: EngineEvent[] = [];
  for (const id of revealed) {
    state.itemLocations[id] = state.room;
    events.push({ type: 'ITEM_SEARCHED', item: container, found: id });
  }
  state.flags[`searched:${container}`] = true;
  events.push(msg(`${kind}:${container}:${revealed.join(',')}`));
  return events;
}

const look: VerbHandler = (state) => [msg(`room:${state.room}`)];

const examine: VerbHandler = (state, command, content) => {
  const r = resolveTarget(state, content, command.directObject);
  if ('events' in r) return r.events;
  const item = content.items[r.id];
  const itemState = state.itemStates[r.id];
  const hasStateText = itemState !== undefined && item?.states?.[itemState] !== undefined;
  return [msg(hasStateText ? `item:${r.id}:${itemState}` : `item:${r.id}`)];
};

const take: VerbHandler = (state, command, content) => {
  // Every candidate already carried (for example two keys): answer, don't ask which one.
  if (command.directObject !== undefined) {
    const reach = resolveNoun(content, command.directObject).filter((id) => isInScope(state, id));
    if (reach.length > 1 && reach.every((id) => state.inventory.includes(id))) return [msg('already_held')];
  }
  const r = resolveTarget(state, content, command.directObject, (id) => !state.inventory.includes(id));
  if ('events' in r) return r.events;
  if (state.inventory.includes(r.id)) return [msg('already_held')];
  if (!content.items[r.id]?.takeable) return [msg(`cant_take:${r.id}`)];
  state.inventory.push(r.id);
  state.itemLocations[r.id] = 'inventory';
  return [{ type: 'ITEM_TAKEN', item: r.id }, msg(`taken:${r.id}`)];
};

const drop: VerbHandler = (state, command, content) => {
  const r = resolveTarget(state, content, command.directObject);
  if ('events' in r) return r.events;
  if (!state.inventory.includes(r.id)) return [msg('not_carrying')];
  if (PERMANENT_ITEMS.includes(r.id)) return [msg(`cant_drop:${r.id}`)];
  state.inventory = state.inventory.filter((i) => i !== r.id);
  state.itemLocations[r.id] = state.room;
  return [msg(`dropped:${r.id}`)];
};

const inventory: VerbHandler = (state) =>
  state.inventory.length === 0 ? [msg('inventory_empty')] : [msg(`inventory:${state.inventory.join(',')}`)];

const search: VerbHandler = (state, command, content) => {
  const r = resolveTarget(state, content, command.directObject);
  if ('events' in r) return r.events;
  if (hiddenContents(state, content, r.id).length > 0) return reveal(state, content, r.id, 'found');
  const item = content.items[r.id];
  if (item?.decoyLine !== undefined) {
    const late = state.warmth >= 3 && item.decoyLineLate !== undefined;
    return [msg(late ? `decoy_late:${r.id}` : `decoy:${r.id}`)];
  }
  const deeper = deeperContainer(state, content, r.id);
  if (deeper !== undefined) return [msg(`search_deeper:${deeper}`)];
  if (hasContents(content, r.id)) return [msg('already_done')];
  return [msg(`search_nothing:${r.id}`)];
};

const open: VerbHandler = (state, command, content) => {
  const r = resolveTarget(state, content, command.directObject);
  if ('events' in r) {
    // OPEN DOOR: a door is an exit, so treat it like UNLOCK DOOR.
    const room = content.rooms[state.room];
    const m = room !== undefined && command.directObject !== undefined ? matchExit(room, content, command.directObject) : undefined;
    if (m !== undefined && 'exit' in m && m.exit.requiresKey !== undefined) return unlockVerb(state, command, content);
    return r.events;
  }
  if (hiddenContents(state, content, r.id).length > 0) return reveal(state, content, r.id, 'opened');
  const deeper = deeperContainer(state, content, r.id);
  if (deeper !== undefined) return [msg(`search_deeper:${deeper}`)];
  if (hasContents(content, r.id)) return [msg('already_done')];
  return [msg('cant_do')];
};

// ---------- movement ----------

const DIRECTION_ABBREVIATIONS: Record<string, string> = {
  n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down',
  upstairs: 'up', stairs: 'up', downstairs: 'down',
};

type ExitMatch = { exit: ExitDef } | { events: EngineEvent[] };

function matchExit(room: RoomDef, content: LoadedContent, phrase: string | undefined): ExitMatch {
  if (phrase === undefined) return { events: [msg('need_object')] };
  const p = normalizeText(phrase);
  const asDirection = DIRECTION_ABBREVIATIONS[p] ?? p;
  const exits = room.exits;

  let hits = exits.filter((e) => normalizeText(e.direction) === asDirection);
  if (hits.length === 0 && p === 'door') hits = exits.filter((e) => e.requiresKey !== undefined);
  if (hits.length === 0 && p === 'back') hits = exits.filter((e) => e.requiresKey === undefined);
  if (hits.length === 0) {
    hits = exits.filter((e) => {
      const target = content.rooms[e.to];
      const names = [e.to.toLowerCase(), normalizeText(target?.name ?? '')];
      return names.some((n) => n === p || ` ${n} `.includes(` ${p} `));
    });
  }
  if (hits.length === 0) return { events: [msg('no_exit')] };
  if (hits.length > 1) return { events: [msg('ambiguous_exit')] };
  return { exit: hits[0] as ExitDef };
}

function isUnlocked(state: GameState, exit: ExitDef): boolean {
  return exit.requiresKey === undefined || state.unlockedDoors.includes(exit.to);
}

/** Unlock without consuming anything. The key stays in the inventory. */
function unlock(state: GameState, exit: ExitDef): EngineEvent[] {
  state.unlockedDoors.push(exit.to);
  return [{ type: 'DOOR_UNLOCKED', room: exit.to }, msg(`unlocked:${state.room}:${exit.direction}`)];
}

const go: VerbHandler = (state, command, content) => {
  const room = content.rooms[state.room];
  if (!room) return [msg('no_exit')];
  const m = matchExit(room, content, command.directObject);
  if ('events' in m) return m.events;
  const { exit } = m;
  const events: EngineEvent[] = [];
  if (!isUnlocked(state, exit)) {
    if (exit.requiresKey === undefined || !state.inventory.includes(exit.requiresKey)) {
      return [msg(`exit_locked:${state.room}:${exit.direction}`)];
    }
    events.push(...unlock(state, exit));
  }
  events.push(msg(`exit:${state.room}:${exit.direction}`));
  state.room = exit.to;
  events.push({ type: 'ROOM_ENTERED', room: exit.to }, msg(`room:${exit.to}`));
  return events;
};

/** UNLOCK <door>: unlock in place if the matching key is carried. */
const unlockVerb: VerbHandler = (state, command, content) => {
  const room = content.rooms[state.room];
  if (!room) return [msg('cant_do')];
  const m = matchExit(room, content, command.directObject);
  if ('events' in m) return m.events;
  const { exit } = m;
  if (exit.requiresKey === undefined) return [msg('cant_do')];
  if (isUnlocked(state, exit)) return [msg('already_done')];
  if (!state.inventory.includes(exit.requiresKey)) return [msg(`exit_locked:${state.room}:${exit.direction}`)];
  return unlock(state, exit);
};

/** USE <key> ON <door>. Other USE combinations belong to puzzle tasks. */
const use: VerbHandler = (state, command: Command, content) => {
  const r = resolveTarget(state, content, command.directObject);
  if ('events' in r) return r.events;
  const item = content.items[r.id];
  if (item?.opens === undefined || command.indirectObject === undefined) return [msg('cant_do')];
  const room = content.rooms[state.room];
  if (!room) return [msg('cant_do')];
  const m = matchExit(room, content, command.indirectObject);
  if ('events' in m) return [msg('cant_do')];
  const { exit } = m;
  if (exit.requiresKey === undefined) return [msg('cant_do')];
  if (!state.inventory.includes(r.id)) return [msg('not_carrying')];
  if (exit.requiresKey !== r.id) return [msg('wrong_key')];
  if (isUnlocked(state, exit)) return [msg('already_done')];
  return unlock(state, exit);
};

export const worldHandlers: Record<string, VerbHandler> = {
  LOOK: look,
  EXAMINE: examine,
  TAKE: take,
  DROP: drop,
  INVENTORY: inventory,
  SEARCH: search,
  OPEN: open,
  GO: go,
  UNLOCK: unlockVerb,
  USE: use,
};
