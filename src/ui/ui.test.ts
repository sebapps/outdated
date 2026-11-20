import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  PreferencesStore,
  STORAGE_KEY,
  parsePreferences,
  type PrefsStorage,
} from './prefs';
import { newGame, opening, takeTurn } from './session';

function memory(): PrefsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('preferences', () => {
  it('defaults reduce-effects to the system setting', () => {
    expect(parsePreferences(null, true).reduceEffects).toBe(true);
    expect(parsePreferences(null, false).reduceEffects).toBe(false);
  });

  it('survives corrupt storage and clamps text size', () => {
    expect(parsePreferences('{nope', false).muted).toBe(false);
    expect(parsePreferences(JSON.stringify({ textSize: 999 }), false).textSize).toBe(MAX_TEXT_SIZE);
    expect(parsePreferences(JSON.stringify({ textSize: 1 }), false).textSize).toBe(MIN_TEXT_SIZE);
  });

  it('persists updates and notifies subscribers', () => {
    const storage = memory();
    const store = new PreferencesStore(storage, false);
    let seen = false;
    store.subscribe((p) => { seen = p.muted; });
    store.update({ muted: true });
    expect(seen).toBe(true);
    expect(new PreferencesStore(storage, false).get().muted).toBe(true);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
  });
});

describe('session', () => {
  it('opens with the title and the basement', async () => {
    const lines = await opening(newGame());
    expect(lines.length).toBeGreaterThan(1);
  });

  it('answers unknown words in character without changing the room', async () => {
    const s = newGame();
    const r = await takeTurn(s, 'xyzzy', {});
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.state.room).toBe(s.room);
    expect(r.ended).toBe(false);
  });

  it('answers empty input and does not mutate the previous state', async () => {
    const s = newGame();
    const before = JSON.stringify(s);
    const r = await takeTurn(s, '   ', {});
    expect(r.lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('runs a real command through the engine', async () => {
    const r = await takeTurn(newGame(), 'look', {});
    expect(r.lines.some((l) => l.kind === 'text')).toBe(true);
  });
});
