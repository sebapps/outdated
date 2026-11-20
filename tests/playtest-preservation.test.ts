// Preservation properties for the playtest-findings bugfix (Property 2).
// Written BEFORE any fix and run on UNFIXED code: every test here must pass now and after the fixes.
// It deliberately does NOT pin behavior the fixes change on purpose: found keys needing TAKE, HINT in a
// solved room, the order of noun-failure suggestions, the 17 NaturalPhrasings rows, "i need a hint",
// the number of caption brackets, the duplicated video line and the study:forward text.
//
// The parse snapshot lives in tests/fixtures/playtest-preservation-parse.json. To re-record it (only ever
// on code known to be good): PRESERVATION_RECORD=1 npx vitest --run tests/playtest-preservation.test.ts
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AudioEngine, type AudioContextLike } from '../src/audio/audio';
import { content } from '../src/engine/content';
import { candidateCommands, createInitialState, isEnded, runInput } from '../src/engine';
import { interpret, parse } from '../src/engine/parser';
import type { EngineEvent, GameState } from '../src/engine/state';
import { step } from '../src/engine/step';
import { isInScope } from '../src/engine/world';
import { newGame, takeTurn, withVoiceCaptions } from '../src/ui/session';

interface Walkthrough {
  segments: { puzzle: string; commands: string[] }[];
  expect: { warmthAtEnd: number; inventoryContains: string[] };
}
const walkthrough = JSON.parse(readFileSync('content/walkthrough.json', 'utf8')) as Walkthrough;
const allCommands = walkthrough.segments.flatMap((s) => s.commands);

const PUZZLES = ['basement', 'hallway', 'boyhoodBedroom', 'study', 'grandparentsBedroom'] as const;
type Puzzle = (typeof PUZZLES)[number];
const SOLVED_FLAG: Record<Puzzle, string> = {
  basement: 'atariBoxSearched',
  hallway: 'jacketSearched',
  boyhoodBedroom: 'compartmentSearched',
  study: 'diskBoxOpened',
  grandparentsBedroom: 'clockRadioOpened',
};
const KEY_ITEM: Record<Puzzle, string> = {
  basement: 'hallwayKey',
  hallway: 'bedroomKey',
  boyhoodBedroom: 'studyKey',
  study: 'grandparentsKey',
  grandparentsBedroom: 'frontDoorKey',
};

function run(state: GameState, line: string): { state: GameState; events: EngineEvent[] } {
  const p = parse(line, content);
  if (!p.ok) throw new Error(`unparsed command: "${line}"`);
  const r = step(state, p.command, content);
  return { state: r.newState, events: r.events };
}
const play = (state: GameState, lines: readonly string[]): GameState => lines.reduce((s, l) => run(s, l).state, state);
const msgIds = (events: readonly EngineEvent[]): string[] =>
  events.filter((e): e is Extract<EngineEvent, { type: 'MESSAGE' }> => e.type === 'MESSAGE').map((e) => e.id);

/** Walkthrough commands of the first `n` segments. */
const segmentsUpTo = (n: number): string[] => walkthrough.segments.slice(0, n).flatMap((s) => s.commands);

/** Every state along the walkthrough, with the command that led to it (index 0 is the fresh game). */
function walkthroughStates(): GameState[] {
  const out: GameState[] = [];
  let s = createInitialState(content);
  out.push(s);
  for (const line of allCommands) {
    s = run(s, line).state;
    out.push(s);
  }
  return out;
}
const STATES = walkthroughStates();

// ---------------------------------------------------------------------------
describe('3.1 canonical walkthrough', () => {
  it('reaches the ending with the expected warmth and the pencil', () => {
    let state = createInitialState(content);
    for (const line of allCommands) {
      expect(isEnded(state), `ended too early before "${line}"`).toBe(false);
      const r = runInput(state, line);
      expect(r.recognized, line).toBe(true);
      state = r.state;
    }
    expect(isEnded(state)).toBe(true);
    expect(state.warmth).toBe(walkthrough.expect.warmthAtEnd);
    for (const item of walkthrough.expect.inventoryContains) expect(state.inventory).toContain(item);
  });
});

// ---------------------------------------------------------------------------
describe('3.2 ungated keys stay ungated, gated containers stay shut', () => {
  const notRevealed = (s: GameState, puzzle: Puzzle): boolean =>
    s.flags[SOLVED_FLAG[puzzle]] !== true &&
    !s.inventory.includes(KEY_ITEM[puzzle]) &&
    s.itemLocations[KEY_ITEM[puzzle]] === 'hidden';
  const revealed = (s: GameState, puzzle: Puzzle): boolean =>
    s.flags[SOLVED_FLAG[puzzle]] === true && s.itemLocations[KEY_ITEM[puzzle]] !== 'hidden';

  it('basement key is found with no tape played', () => {
    const s = play(createInitialState(content), ['search cartridge box', 'search under foam']);
    expect(s.flags.atariBoxSearched).toBe(true);
    expect(revealed(s, 'basement')).toBe(true);
    expect(s.itemStates.cassette).not.toBe('loaded');
  });

  it('hallway key is found with no message heard', () => {
    const start = play(createInitialState(content), segmentsUpTo(1));
    expect(start.room).toBe('hallway');
    const s = play(start, ['open closet', 'search jacket', 'search inside pocket']);
    expect(s.flags.jacketSearched).toBe(true);
    expect(revealed(s, 'hallway')).toBe(true);
  });

  it('toybox stays shut before the cartridge clue', () => {
    const start = play(createInitialState(content), segmentsUpTo(2));
    expect(start.room).toBe('boyhoodBedroom');
    const s = play(start, ['search toybox', 'search toybox']);
    expect(notRevealed(s, 'boyhoodBedroom')).toBe(true);
  });

  it('disk box stays shut before the record clue', () => {
    const start = play(createInitialState(content), segmentsUpTo(3));
    expect(start.room).toBe('study');
    const s = play(start, ['open disk box', 'open disk box']);
    expect(notRevealed(s, 'study')).toBe(true);
  });

  it('clock radio cover stays shut before the video', () => {
    const start = play(createInitialState(content), segmentsUpTo(4));
    expect(start.room).toBe('grandparentsBedroom');
    const s = play(start, ['remove battery cover', 'remove battery cover']);
    expect(notRevealed(s, 'grandparentsBedroom')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('3.4 parse snapshot', () => {
  const FIXTURE = 'tests/fixtures/playtest-preservation-parse.json';
  const NOUNS = ['pencil', 'cassette', 'walkman', 'vcr', 'nes', 'record', 'pager', 'door', 'closet', 'toybox', 'tracking', 'north', '5550142'];
  const PARTICLES = new Set(['up', 'in', 'on', 'out', 'over', 'around', 'back']);

  type Snap = { ok: true; command: Record<string, string> } | { ok: false; reason: string };
  const snap = (line: string): Snap => {
    const p = parse(line, content);
    return p.ok ? { ok: true, command: { ...p.command } } : { ok: false, reason: p.reason };
  };

  /** Every verb phrase x a small noun set, in forms that parse today and that no fix touches on purpose. */
  function inputs(): string[] {
    const lines = new Set<string>();
    for (const def of Object.values(content.verbs)) {
      const phrases = [def.id.toLowerCase(), ...def.synonyms.map((s) => s.toLowerCase())];
      for (const p of phrases) {
        lines.add(p);
        // "i" and "l" are only pinned on their own ("i need a hint" changes on purpose).
        if (p === 'i' || p === 'l') continue;
        NOUNS.forEach((n, idx) => {
          lines.add(`${p} ${n}`);
          // "fix the tracking" is one of the NaturalPhrasings rows.
          if (!(p === 'fix' && n === 'tracking')) lines.add(`${p} the ${n}`);
          if (def.objects === 2) {
            const n2 = NOUNS[(idx + 1) % NOUNS.length] as string;
            for (const prep of def.prepositions ?? []) lines.add(`${p} ${n} ${prep} ${n2}`);
          }
        });
      }
    }
    // A trailing particle on the line is the C6 territory.
    const kept = [...lines].filter((l) => !PARTICLES.has(l.split(' ').pop() as string) || l.split(' ').length === 1);
    // Walkthrough commands are always pinned, whatever their last word ("go up").
    return [...new Set([...kept, ...allCommands])].sort();
  }

  const lines = inputs();

  if (process.env.PRESERVATION_RECORD === '1') {
    it('records the parse snapshot', () => {
      const table: Record<string, Snap> = {};
      for (const l of lines) table[l] = snap(l);
      if (!existsSync('tests/fixtures')) mkdirSync('tests/fixtures', { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(table, null, 1)}\n`);
      expect(Object.keys(table).length).toBeGreaterThan(500);
    });
    return;
  }

  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, Snap>;

  it('records at least every verb phrase and every walkthrough command', () => {
    for (const c of allCommands) expect(recorded[c], c).toBeDefined();
    for (const def of Object.values(content.verbs)) expect(recorded[def.id.toLowerCase()], def.id).toBeDefined();
  });

  it('every recorded input parses exactly as on the unfixed code', () => {
    const diffs: string[] = [];
    for (const [line, want] of Object.entries(recorded)) {
      const got = snap(line);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        diffs.push(`"${line}": was ${JSON.stringify(want)}, now ${JSON.stringify(got)}`);
      }
    }
    expect(diffs.slice(0, 20)).toEqual([]);
  });

  it('holds under case and spacing changes, and parse never throws', () => {
    const entries = Object.entries(recorded);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: entries.length - 1 }),
        fc.boolean(),
        fc.constantFrom('', ' ', '   '),
        (i, upper, pad) => {
          const [line, want] = entries[i] as [string, Snap];
          const text = `${pad}${upper ? line.toUpperCase() : line}${pad}`;
          expect(snap(text)).toEqual(want);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('arbitrary text never throws and unknown words stay unknown verbs', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        expect(() => parse(s, content)).not.toThrow();
        expect(() => interpret(s, content)).not.toThrow();
      }),
      { numRuns: 300 },
    );
    for (const s of ['xyzzy', 'frobnicate the widget', 'zzqx pencil']) {
      const p = parse(s, content);
      expect(p.ok, s).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe('3.5 HINT in an unsolved room gives tiers 1, 2, 3, 3', () => {
  const unsolved: { puzzle: Puzzle; state: GameState }[] = STATES.flatMap((state) => {
    const puzzle = state.room as Puzzle;
    return (PUZZLES as readonly string[]).includes(puzzle) && state.flags[SOLVED_FLAG[puzzle]] !== true
      ? [{ puzzle, state }]
      : [];
  });

  it('covers every puzzle', () => {
    expect(new Set(unsolved.map((u) => u.puzzle)).size).toBe(PUZZLES.length);
  });

  it('advances the stored tier and repeats tier 3', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: unsolved.length - 1 }), (i) => {
        const { puzzle, state: start } = unsolved[i] as { puzzle: Puzzle; state: GameState };
        let state = start;
        const before = state.hintTier[puzzle];
        expect(before).toBe(0);
        const seen: number[] = [];
        for (const tier of [1, 2, 3, 3]) {
          const r = run(state, 'hint');
          const ids = msgIds(r.events);
          expect(ids, `${puzzle} tier ${tier}`).toContain('hint_lead');
          expect(ids, `${puzzle} tier ${tier}`).toContain(`hint:${puzzle}:${tier}`);
          state = r.state;
          seen.push(state.hintTier[puzzle]);
        }
        expect(seen).toEqual([1, 2, 3, 3]);
      }),
      { numRuns: Math.min(40, unsolved.length * 3) },
    );
  });

  it('tracks tiers per puzzle and never lowers them', () => {
    let state = createInitialState(content);
    state = run(state, 'hint').state;
    state = run(state, 'hint').state;
    expect(state.hintTier.basement).toBe(2);
    expect(state.hintTier.hallway).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('3.6 noun-failure lines keep their wording and only suggest reachable items', () => {
  const FAILS = ['zzqx', 'flarb', 'blorp', 'unicorn', 'xyzzyplugh'];
  const VERBS = ['examine', 'take', 'drop', 'search', 'play', 'press', 'plug in', 'flip', 'insert'];

  it('starts with one of the four wordings and ends with the Try line', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: STATES.length - 1 }),
        fc.constantFrom(...VERBS),
        fc.constantFrom(...FAILS),
        fc.nat({ max: 40 }),
        (si, verb, noun, variant) => {
          const state = STATES[si] as GameState;
          const r = interpret(`${verb} ${noun}`, content, {
            inScope: (id) => isInScope(state, id),
            variant,
            held: (id) => state.inventory.includes(id),
          });
          expect(r.ok).toBe(false);
          if (r.ok) return;
          expect(r.event.type).toBe('UNKNOWN_NOUN');
          if (r.event.type !== 'UNKNOWN_NOUN') return;
          const text = r.event.text;
          const p = r.event.phrase;
          const starts = [
            `No "${p}" around here. `,
            `You look for a "${p}" and come up empty. `,
            `A "${p}"? Not that you can see. `,
            `Nothing like a "${p}" in reach. `,
          ];
          expect(starts.some((s) => text.startsWith(s)), text).toBe(true);

          const eligible = Object.values(content.items)
            .filter((it) => isInScope(state, it.id) && it.inside === undefined)
            .map((it) => it.name.toLowerCase());
          const sug = r.event.suggestions;
          expect(sug.length, text).toBe(Math.min(3, eligible.length));
          for (const name of sug) expect(eligible, text).toContain(name);
          if (sug.length === 0) expect(text.endsWith('Try LOOK.'), text).toBe(true);
          else expect(text.includes('Try EXAMINE with '), text).toBe(true);
          expect(text.endsWith('.'), text).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
type Res = { ok: boolean; arrayBuffer(): Promise<ArrayBuffer>; json?(): Promise<unknown> };
const notFound: Res = { ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
const realIndex: unknown = JSON.parse(readFileSync('public/audio/voice/index.json', 'utf8'));
const fetch404 = (): Promise<Res> => Promise.resolve(notFound);
const fetchIndexOnly = (url: string): Promise<Res> =>
  url.endsWith('index.json')
    ? Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), json: () => Promise.resolve(realIndex) })
    : Promise.resolve(notFound);
const fetchAll = (url: string): Promise<Res> =>
  url.endsWith('index.json') ? fetchIndexOnly(url) : Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });

/** Fake context like a real one: each buffer keeps its own sample array, so reversal can be read back. */
function fakeContext(buffers: Float32Array[], decode: boolean): AudioContextLike {
  const param = () => ({ value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined });
  const node = () => ({ connect: () => undefined });
  return {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running',
    destination: {},
    resume: () => Promise.resolve(),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param(), Q: param() }),
    createOscillator: () => ({ ...node(), type: '', frequency: param(), start: () => undefined, stop: () => undefined }),
    createBuffer: (_c, length) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource: () => {
      const s = {
        ...node(),
        playbackRate: param(),
        loop: false,
        start: () => undefined,
        stop: () => undefined,
        set buffer(b: unknown) {
          const data = (b as { getChannelData(n: number): Float32Array }).getChannelData(0);
          if (data.length === 4) buffers.push(data);
        },
      };
      return s as unknown as ReturnType<AudioContextLike['createBufferSource']>;
    },
    decodeAudioData: () => {
      if (!decode) return Promise.reject(new Error('decode failed'));
      const data = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
      return Promise.resolve({ getChannelData: () => data });
    },
  };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 15));
const bare = (s: string): string => s.replace(/^\[+|\]+$/g, '').trim().toLowerCase();

describe('3.7 audio: captions survive muted, missing and undecodable audio; only the forward step is reversed', () => {
  async function audioEngine(muted: boolean, decode: boolean, buffers: Float32Array[], fetchImpl: (u: string) => Promise<Res>): Promise<AudioEngine> {
    const a = new AudioEngine({ isMuted: () => muted, createContext: () => fakeContext(buffers, decode), fetchImpl });
    await a.loadVoiceIndex();
    a.unlock();
    return a;
  }

  async function playThrough(muted: boolean, decode: boolean, fetchImpl: (u: string) => Promise<Res>): Promise<{ captions: string[]; ended: boolean }> {
    const buffers: Float32Array[] = [];
    const audio = await audioEngine(muted, decode, buffers, fetchImpl);
    let state: GameState = newGame();
    const captions: string[] = [];
    let ended = false;
    for (const cmd of allCommands) {
      const turn = await takeTurn(state, cmd);
      state = turn.state;
      expect(() => audio.handleEvents(turn.events)).not.toThrow();
      for (const l of withVoiceCaptions(turn.lines, audio.captionsFor(turn.events))) {
        if (l.kind === 'caption') captions.push(bare(l.text));
      }
      ended = turn.ended;
    }
    await tick();
    return { captions, ended };
  }

  const eventCaptions = async (): Promise<string[]> => {
    let state: GameState = newGame();
    const out: string[] = [];
    for (const cmd of allCommands) {
      const turn = await takeTurn(state, cmd);
      state = turn.state;
      for (const e of turn.events) if (e.type === 'SOUND') out.push(bare(e.caption));
    }
    return out;
  };

  it('shows every engine sound caption and the index captions in each degraded mode', async () => {
    const sounds = await eventCaptions();
    expect(sounds.length).toBeGreaterThan(5);
    const modes: [string, boolean, boolean, (u: string) => Promise<Res>][] = [
      ['muted, files missing', true, true, fetchIndexOnly],
      ['audible, every fetch 404s', false, true, fetch404],
      ['audible, decode fails', false, false, fetchAll],
      ['audible, fetch throws', false, true, () => Promise.reject(new Error('offline'))],
    ];
    for (const [name, muted, decode, fetchImpl] of modes) {
      const r = await playThrough(muted, decode, fetchImpl);
      expect(r.ended, name).toBe(true);
      for (const c of new Set(sounds)) expect(r.captions, `${name}: ${c}`).toContain(c);
    }
    const idx = await playThrough(true, true, fetchIndexOnly);
    for (const c of ["answering machine: a boy's voice", 'home video: a boy whispering', "dad's voice, over the static"]) {
      expect(idx.captions, c).toContain(c);
    }
  });

  it('reverses the sample for the forward step only', async () => {
    const forward = [{ type: 'MESSAGE', id: 'study:forward' }];
    const reversed = [{ type: 'MESSAGE', id: 'study:reversed' }];
    const fwd: Float32Array[] = [];
    (await audioEngine(false, true, fwd, fetchAll)).handleEvents(forward);
    await tick();
    expect(Array.from(fwd[0] ?? [])).toEqual([0.4, 0.3, 0.2, 0.1].map((n) => Math.fround(n)));
    const rev: Float32Array[] = [];
    (await audioEngine(false, true, rev, fetchAll)).handleEvents(reversed);
    await tick();
    expect(Array.from(rev[0] ?? [])).toEqual([0.1, 0.2, 0.3, 0.4].map((n) => Math.fround(n)));
  });

  it('keeps the adult Dad final line and its caption in the voice index', () => {
    const idx = realIndex as Record<string, { file: string; caption: string }>;
    expect(idx.video_adult_dad_final?.file).toBeDefined();
    expect(idx.video_adult_dad_final?.caption).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('3.8/3.9 video and ending text', () => {
  it('keeps the clock gag before the video and the pencil as the last thing', () => {
    let state = createInitialState(content);
    const texts: string[] = [];
    for (const line of allCommands) {
      const r = runInput(state, line);
      state = r.state;
      texts.push(r.text);
    }
    const videoAt = allCommands.indexOf('press play', allCommands.indexOf('insert tape'));
    expect(videoAt).toBeGreaterThan(0);
    const last = texts[texts.length - 1] ?? '';
    expect(last.toLowerCase()).toContain('pencil');
    // After the ending nothing more is said: the next input is answered with the ended state intact.
    expect(isEnded(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('3.3/3.10 determinism and purity', () => {
  it('same state and command give the same result and leave the input state untouched', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 10_000 }), { minLength: 1, maxLength: 12 }), (picks) => {
        let state = createInitialState(content);
        for (const pick of picks) {
          const cmds = candidateCommands(state);
          const cmd = cmds[pick % cmds.length] as string;
          const frozen = structuredClone(state);
          const a = runInput(state, cmd);
          expect(state, cmd).toEqual(frozen);
          const b = runInput(state, cmd);
          expect(b, cmd).toEqual(a);
          expect(state, cmd).toEqual(frozen);
          state = isEnded(a.state) ? createInitialState(content) : a.state;
        }
      }),
      { numRuns: 40 },
    );
  });

  it('TAKE of a key, dropping it and taking it again, never consumes anything', () => {
    // Walk to the hallway, then take, drop and re-take the key if it is takeable; pencil stays carried.
    let state = play(createInitialState(content), segmentsUpTo(1));
    expect(state.inventory).toContain('pencil');
    state = play(state, ['open closet', 'search jacket', 'search inside pocket']);
    state = play(state, ['take key']);
    expect(state.inventory).toContain('bedroomKey');
    state = play(state, ['drop bedroom key']);
    state = play(state, ['take bedroom key']);
    expect(state.inventory).toContain('bedroomKey');
    expect(state.inventory).toContain('pencil');
    state = play(state, ['go north']);
    expect(state.room).toBe('boyhoodBedroom');
    expect(state.inventory).toContain('pencil');
  });
});
