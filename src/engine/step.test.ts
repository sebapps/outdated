import { describe, expect, it } from 'vitest';
import { content } from './content';
import { createInitialState } from './state';
import { step } from './step';

describe('createInitialState', () => {
  it('starts in the basement with item states from content', () => {
    const s = createInitialState(content);
    expect(s.room).toBe('basement');
    expect(s.inventory).toEqual([]);
    expect(s.warmth).toBe(0);
    for (const item of Object.values(content.items)) {
      if (item.initialState !== undefined) expect(s.itemStates[item.id]).toBe(item.initialState);
    }
  });
});

describe('step', () => {
  it('is deterministic and does not mutate its input', () => {
    const s = createInitialState(content);
    const snapshot = JSON.stringify(s);
    const a = step(s, { verb: 'LOOK' });
    const b = step(s, { verb: 'LOOK' });
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(a).toEqual(b);
    expect(a.newState).not.toBe(s);
    expect(a.newState.inventory).not.toBe(s.inventory);
  });

  it('returns a message event for unhandled verbs', () => {
    const { events } = step(createInitialState(content), { verb: 'XYZZY' });
    expect(events).toEqual([{ type: 'MESSAGE', id: 'cant_do' }]);
  });
});
