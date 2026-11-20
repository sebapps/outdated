import { describe, expect, it } from 'vitest';
import { CannedNarrator } from '../narration/canned';
import { content } from './content';
import { NUDGE_AFTER_TURNS, puzzleForRoom } from './hints';
import { describeMessage } from './messages';
import { createInitialState, type GameState } from './state';
import { step } from './step';
import { PUZZLE_IDS } from './content/types';

const ids = (events: { type: string; id?: string }[]) => events.filter((e) => e.type === 'MESSAGE').map((e) => e.id);

describe('HELP', () => {
  it('lists the commands at every warmth level without changing state or giving solutions', () => {
    const canned = new CannedNarrator(content);
    for (const w of [0, 1, 2, 3, 4]) {
      const s = { ...createInitialState(content), warmth: w as 0 | 1 | 2 | 3 | 4 };
      const r = step(s, { verb: 'HELP' });
      expect(ids(r.events as never)).toEqual(['help']);
      expect(r.newState.room).toBe(s.room);
      expect(r.newState.inventory).toEqual(s.inventory);
      const text = canned.lookup(r.events[0]!, { warmth: w, variant: 0 })!;
      for (const word of ['LOOK', 'EXAMINE', 'TAKE', 'SEARCH', 'USE', 'GO', 'HINT', 'INVENTORY']) expect(text).toContain(word);
    }
  });
});

describe('HINT', () => {
  it('advances through tiers 1 to 3 and then repeats tier 3', () => {
    let s = createInitialState(content);
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = step(s, { verb: 'HINT' });
      s = r.newState;
      seen.push(ids(r.events as never)[1]);
    }
    expect(seen).toEqual(['hint:basement:1', 'hint:basement:2', 'hint:basement:3', 'hint:basement:3']);
    expect(s.hintTier.basement).toBe(3);
  });

  it('gives hints for the current room only and tracks tiers per puzzle', () => {
    const s: GameState = { ...createInitialState(content), room: 'study' };
    const r = step(s, { verb: 'HINT' });
    expect(ids(r.events as never)).toContain('hint:study:1');
    expect(r.newState.hintTier.study).toBe(1);
    expect(r.newState.hintTier.basement).toBe(0);
  });

  it('renders the authored text for every puzzle tier', () => {
    for (const p of PUZZLE_IDS) {
      for (let t = 1; t <= 3; t++) {
        expect(describeMessage(`hint:${p}:${t}`, content)).toBe(content.hints[p].tiers[t - 1]);
      }
    }
    expect(puzzleForRoom('outside')).toBe('grandparentsBedroom');
  });

  it('has narrator lead-in and nudge lines at every warmth level', async () => {
    const narrator = new CannedNarrator(content);
    for (const key of ['hint_lead', 'nudge']) {
      for (let w = 0; w <= 4; w++) {
        expect(await narrator.narrate({ type: 'MESSAGE', id: key }, { warmth: w, variant: 0 })).not.toBe('');
      }
    }
  });
});

describe('idle nudges', () => {
  it('nudges after the threshold of non-progress turns, then resets', () => {
    let s = createInitialState(content);
    for (let i = 1; i < NUDGE_AFTER_TURNS; i++) {
      const r = step(s, { verb: 'LOOK' });
      expect(ids(r.events as never)).not.toContain('nudge');
      s = r.newState;
    }
    const r = step(s, { verb: 'LOOK' });
    expect(ids(r.events as never)).toContain('nudge');
    expect(r.newState.idleTurns).toBe(0);
  });

  it('does not nudge while the player makes progress', () => {
    let s = createInitialState(content);
    s = step(s, { verb: 'LOOK' }).newState;
    expect(s.idleTurns).toBe(1);
    const r = step(s, { verb: 'TAKE', directObject: 'pencil' });
    expect(r.events.some((e) => e.type === 'ITEM_TAKEN')).toBe(true);
    expect(r.newState.idleTurns).toBe(0);
  });

  it('asking for a hint resets the idle counter', () => {
    let s = createInitialState(content);
    for (let i = 0; i < 3; i++) s = step(s, { verb: 'LOOK' }).newState;
    expect(step(s, { verb: 'HINT' }).newState.idleTurns).toBe(0);
  });
});
