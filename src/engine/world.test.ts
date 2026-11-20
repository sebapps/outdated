import { describe, expect, it } from 'vitest';
import { content } from './content';
import { describeMessage } from './messages';
import type { Command } from './parser';
import { createInitialState, type EngineEvent, type GameState } from './state';
import { step } from './step';

function run(state: GameState, ...cmds: Command[]): { state: GameState; events: EngineEvent[] } {
  let s = state;
  let events: EngineEvent[] = [];
  for (const c of cmds) {
    const r = step(s, c);
    s = r.newState;
    events = r.events;
  }
  return { state: s, events };
}

const ids = (events: EngineEvent[]) => events.filter((e) => e.type === 'MESSAGE').map((e) => (e as { id: string }).id);

/** Basement with the hallway key in hand. */
function withHallwayKey(): GameState {
  return run(
    createInitialState(content),
    { verb: 'SEARCH', directObject: 'cartridge box' },
    { verb: 'SEARCH', directObject: 'foam' },
    { verb: 'TAKE', directObject: 'key' },
  ).state;
}

describe('LOOK / EXAMINE', () => {
  it('LOOK describes the current room', () => {
    const { events } = run(createInitialState(content), { verb: 'LOOK' });
    expect(ids(events)).toEqual(['room:basement']);
    expect(describeMessage('room:basement', content)).toContain('workbench');
  });

  it('EXAMINE uses state-specific text', () => {
    const { events } = run(createInitialState(content), { verb: 'EXAMINE', directObject: 'tape' });
    expect(ids(events)).toEqual(['item:cassette:tangled']);
    expect(describeMessage(ids(events)[0]!, content)).toMatch(/tangle/);
  });

  it('does not resolve items from other rooms or hidden items', () => {
    const s = createInitialState(content);
    expect(ids(run(s, { verb: 'EXAMINE', directObject: 'pager' }).events)).toEqual(['not_here']);
    expect(ids(run(s, { verb: 'EXAMINE', directObject: 'key' }).events)).toEqual(['not_here']);
  });

  it('asks for an object when none is given', () => {
    expect(ids(run(createInitialState(content), { verb: 'EXAMINE' }).events)).toEqual(['need_object']);
  });
});

describe('TAKE / DROP / INVENTORY', () => {
  it('takes, lists, and drops an item', () => {
    let r = run(createInitialState(content), { verb: 'TAKE', directObject: 'cassette' });
    expect(r.events[0]).toEqual({ type: 'ITEM_TAKEN', item: 'cassette' });
    expect(r.state.inventory).toEqual(['cassette']);
    r = run(r.state, { verb: 'INVENTORY' });
    expect(ids(r.events)).toEqual(['inventory:cassette']);
    r = run(r.state, { verb: 'DROP', directObject: 'cassette' });
    expect(r.state.inventory).toEqual([]);
    expect(r.state.itemLocations.cassette).toBe('basement');
  });

  it('refuses fixed items, double takes, and dropping the pencil', () => {
    const s = createInitialState(content);
    expect(ids(run(s, { verb: 'TAKE', directObject: 'workbench' }).events)).toEqual(['cant_take:workbench']);
    const held = run(s, { verb: 'TAKE', directObject: 'pencil' });
    expect(ids(run(held.state, { verb: 'TAKE', directObject: 'pencil' }).events)).toEqual(['already_held']);
    const dropped = run(held.state, { verb: 'DROP', directObject: 'pencil' });
    expect(ids(dropped.events)).toEqual(['cant_drop:pencil']);
    expect(dropped.state.inventory).toContain('pencil');
    expect(ids(run(s, { verb: 'DROP', directObject: 'cassette' }).events)).toEqual(['not_carrying']);
  });

  it('reports an empty inventory', () => {
    expect(ids(run(createInitialState(content), { verb: 'INVENTORY' }).events)).toEqual(['inventory_empty']);
  });
});

describe('SEARCH / OPEN and hidden items', () => {
  it('keeps hidden items out of reach until the container is searched', () => {
    const s = createInitialState(content);
    expect(s.itemLocations.hallwayKey).toBe('hidden');
    const box = run(s, { verb: 'SEARCH', directObject: 'atari box' });
    expect(box.events).toContainEqual({ type: 'ITEM_SEARCHED', item: 'atariBox', found: 'foam' });
    expect(box.state.itemLocations.hallwayKey).toBe('hidden');
    const r = run(box.state, { verb: 'SEARCH', directObject: 'foam' });
    expect(r.events).toContainEqual({ type: 'ITEM_SEARCHED', item: 'foam', found: 'hallwayKey' });
    expect(r.state.itemLocations.hallwayKey).toBe('inventory');
    expect(run(r.state, { verb: 'TAKE', directObject: 'key' }).state.inventory).toEqual(['hallwayKey']);
  });

  it('OPEN reveals nested containers one level at a time', () => {
    const s = createInitialState(content);
    // Move the player to the hallway for this check without playing the whole game.
    const hall: GameState = { ...s, room: 'hallway' };
    const opened = run(hall, { verb: 'OPEN', directObject: 'closet' });
    expect(opened.state.itemLocations.jacket).toBe('hallway');
    expect(opened.state.itemLocations.emergencyQuarter).toBe('hidden');
    const searched = run(opened.state, { verb: 'SEARCH', directObject: 'jacket' });
    expect(searched.state.itemLocations.emergencyQuarter).toBe('hallway');
    expect(ids(run(searched.state, { verb: 'OPEN', directObject: 'closet' }).events)).toEqual(['already_done']);
  });

  it('gives decoys their unique line and non-containers nothing', () => {
    const s = createInitialState(content);
    const r = run(s, { verb: 'SEARCH', directObject: 'magic 8-ball' });
    expect(describeMessage(ids(r.events)[0]!, content)).toBe('Ask again later. Thrilling.');
    expect(ids(run(s, { verb: 'SEARCH', directObject: 'pencil' }).events)).toEqual(['search_nothing:pencil']);
    expect(ids(run(s, { verb: 'OPEN', directObject: 'pencil' }).events)).toEqual(['cant_do']);
  });

  it('searching an emptied container again points at a still-hiding child, if any', () => {
    const r = run(createInitialState(content), { verb: 'SEARCH', directObject: 'atari box' });
    expect(ids(run(r.state, { verb: 'SEARCH', directObject: 'atari box' }).events)).toEqual(['search_deeper:foam']);
  });
});

describe('GO and locked doors', () => {
  it('refuses a locked door without the key', () => {
    const r = run(createInitialState(content), { verb: 'GO', directObject: 'up' });
    expect(ids(r.events)).toEqual(['exit_locked:basement:up']);
    expect(r.state.room).toBe('basement');
    expect(describeMessage('exit_locked:basement:up', content)).toMatch(/key/);
  });

  it('refuses with the wrong key', () => {
    const s = createInitialState(content);
    const sneaky: GameState = { ...s, inventory: ['bedroomKey'] };
    expect(ids(run(sneaky, { verb: 'GO', directObject: 'up' }).events)[0]).toBe('exit_locked:basement:up');
  });

  it('unlocks with the matching key, consumes nothing, and allows travel', () => {
    const s = withHallwayKey();
    const before = [...s.inventory];
    const r = run(s, { verb: 'GO', directObject: 'door' });
    expect(r.state.room).toBe('hallway');
    expect(r.state.unlockedDoors).toContain('hallway');
    expect(r.state.inventory).toEqual(before);
    expect(r.events.map((e) => e.type)).toContain('DOOR_UNLOCKED');
    expect(r.events).toContainEqual({ type: 'ROOM_ENTERED', room: 'hallway' });
  });

  it('UNLOCK and USE KEY ON DOOR unlock in place', () => {
    const s = withHallwayKey();
    const a = run(s, { verb: 'UNLOCK', directObject: 'door' });
    expect(a.state.room).toBe('basement');
    expect(a.state.unlockedDoors).toEqual(['hallway']);
    const b = run(s, { verb: 'USE', directObject: 'key', indirectObject: 'door' });
    expect(b.state.unlockedDoors).toEqual(['hallway']);
    expect(ids(run(a.state, { verb: 'UNLOCK', directObject: 'door' }).events)).toEqual(['already_done']);
  });

  it('stays unlocked and keeps room state when returning', () => {
    let r = run(withHallwayKey(), { verb: 'GO', directObject: 'up' }, { verb: 'DROP', directObject: 'key' });
    r = run(r.state, { verb: 'GO', directObject: 'down' });
    expect(r.state.room).toBe('basement');
    // The box stays searched and the key is still where we left it (the hallway).
    expect(r.state.itemLocations.hallwayKey).toBe('hallway');
    r = run(r.state, { verb: 'GO', directObject: 'up' });
    expect(r.state.room).toBe('hallway');
    expect(r.state.unlockedDoors).toEqual(['hallway']);
  });

  it('rejects unknown directions and takes back-exits by name', () => {
    const s = createInitialState(content);
    expect(ids(run(s, { verb: 'GO', directObject: 'sideways' }).events)).toEqual(['no_exit']);
    const hall = run(withHallwayKey(), { verb: 'GO', directObject: 'up' }).state;
    expect(run(hall, { verb: 'GO', directObject: 'basement' }).state.room).toBe('basement');
    expect(run(hall, { verb: 'GO', directObject: 'back' }).state.room).toBe('basement');
  });
});

describe('purity', () => {
  it('never mutates the input state', () => {
    const s = createInitialState(content);
    const snap = JSON.stringify(s);
    step(s, { verb: 'SEARCH', directObject: 'atari box' });
    step(s, { verb: 'TAKE', directObject: 'pencil' });
    expect(JSON.stringify(s)).toBe(snap);
  });
});
