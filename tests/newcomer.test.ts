// Task 15: stand-in newcomer playthrough through the real UI path (interpret with room scope, then step).
// These are the places a first-time player got stuck; each one is pinned here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newGame, takeTurn } from '../src/ui/session';
import type { GameState } from '../src/engine/state';

const walkthrough = JSON.parse(readFileSync('content/walkthrough.json', 'utf8')) as {
  segments: { puzzle: string; commands: string[] }[];
};

async function play(start: GameState, commands: string[]): Promise<{ state: GameState; text: string[]; ended: boolean }> {
  let state = start;
  let ended = false;
  const text: string[] = [];
  for (const c of commands) {
    const r = await takeTurn(state, c);
    state = r.state;
    ended = r.ended;
    text.push(r.lines.map((l) => ('text' in l ? l.text : '')).join('\n'));
  }
  return { state, text, ended };
}

const upTo = async (puzzle: string): Promise<GameState> => {
  let s = newGame();
  for (const seg of walkthrough.segments) {
    if (seg.puzzle === puzzle) return s;
    s = (await play(s, seg.commands)).state;
  }
  return s;
};

describe('newcomer: the canonical solution works through the UI path', () => {
  it('reaches the ending when typed the way a player would', async () => {
    const all = walkthrough.segments.flatMap((s) => s.commands);
    const r = await play(newGame(), all);
    expect(r.ended).toBe(true);
    expect(r.state.inventory).toContain('pencil');
  });
});

describe('newcomer: spots where they used to get stuck', () => {
  it('HELP lists the commands', async () => {
    const r = await play(newGame(), ['help']);
    expect(r.text[0]).toContain('EXAMINE');
    expect(r.text[0]).toContain('HINT');
  });

  it('"search box" after "open box" points at the foam insert', async () => {
    const r = await play(newGame(), ['open cartridge box', 'search cartridge box']);
    expect(r.text[1]).toMatch(/foam insert/i);
  });

  it('the new key is already carried after the search, so TAKE KEY says so', async () => {
    const s = await upTo('hallway');
    const r = await play(s, ['examine pager', 'dial 5550142', 'open closet', 'search jacket', 'search inside pocket']);
    expect(r.state.inventory).toContain('bedroomKey');
    const t = await play(r.state, ['take key']);
    expect(t.text.at(-1)).toMatch(/already carrying/i);
  });

  it('BLOW ON CARTRIDGE works while it is still in the NES', async () => {
    const s = await upTo('boyhoodBedroom');
    const r = await play(s, ['take cartridge', 'insert cartridge', 'press power', 'blow on cartridge']);
    expect(r.text.at(-1)).toMatch(/blow/i);
    expect(r.state.flags.cartridgeBlown).toBe(true);
  });

  it('ADJUST TRACKING is understood', async () => {
    const s = await upTo('grandparentsBedroom');
    const r = await play(s, ['open tape case', 'insert tape', 'press play', 'adjust tracking']);
    expect(r.text.at(-1)).toMatch(/nudge the tracking/i);
  });

  it('OPEN DOOR and UNLOCK DOOR reach the engine instead of "no such thing"', async () => {
    const s = await upTo('basement');
    const locked = await play(s, ['open door', 'unlock door']);
    for (const t of locked.text) expect(t).not.toMatch(/in reach|come up empty|Not that you can see|No "door"/);
    const keyed = await play(s, [
      'take pencil', 'take cassette', 'rewind cassette with pencil', 'take walkman', 'insert cassette into walkman',
      'play walkman', 'search cartridge box', 'search under foam', 'take key', 'open door',
    ]);
    expect(keyed.state.unlockedDoors).toContain('hallway');
  });
});
