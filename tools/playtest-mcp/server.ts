/**
 * Playtest MCP server.
 *
 * Lets Kiro PLAY the game as a player would, and stress-test it:
 *   new_game, send_command, get_state, list_vocabulary   -> manual play
 *   run_walkthrough                                       -> canonical solve, per puzzle
 *   find_softlocks                                        -> explores states, finds dead ends
 *   fuzz_commands                                         -> odd/typo'd input, finds crashes and thin responses
 *
 * IMPORTANT: this is a stdio MCP server. Never write to stdout (console.log).
 * Use console.error for logging.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getEngine, type OpaqueState } from './engineAdapter.js';

const server = new McpServer({ name: 'playtest', version: '0.1.0' });
const sessions = new Map<string, OpaqueState>();

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (err: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
});

function getSession(id: string): OpaqueState {
  const s = sessions.get(id);
  if (!s) throw new Error(`Unknown session_id "${id}". Call new_game first.`);
  return s;
}

/** Small seeded PRNG so fuzz runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- manual play

server.tool('new_game', 'Start a new game session. Returns a session_id and the opening state.', {}, async () => {
  try {
    const eng = await getEngine();
    const id = randomUUID();
    const state = eng.createInitialState();
    sessions.set(id, state);
    return ok(JSON.stringify({ session_id: id, state: eng.summarize(state) }, null, 2));
  } catch (e) {
    return fail(e);
  }
});

server.tool(
  'send_command',
  'Send one player command (for example "rewind cassette with pencil"). Returns narration, events, and state changes.',
  { session_id: z.string(), command: z.string().min(1).max(200) },
  async ({ session_id, command }) => {
    try {
      const eng = await getEngine();
      const before = eng.summarize(getSession(session_id));
      const r = eng.runInput(getSession(session_id), command);
      sessions.set(session_id, r.state);
      const after = eng.summarize(r.state);
      return ok(
        JSON.stringify(
          {
            narration: r.text,
            recognized: r.recognized,
            events: r.eventTypes,
            changed: {
              room: before.room !== after.room ? `${before.room} -> ${after.room}` : undefined,
              warmth: before.warmth !== after.warmth ? `${before.warmth} -> ${after.warmth}` : undefined,
              newItems: after.inventory.filter((i) => !before.inventory.includes(i)),
              lostItems: before.inventory.filter((i) => !after.inventory.includes(i)),
              newFlags: after.flags.filter((f) => !before.flags.includes(f)),
            },
            ended: after.ended,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool('get_state', 'Return a summary of the current game state.', { session_id: z.string() }, async ({ session_id }) => {
  try {
    const eng = await getEngine();
    return ok(JSON.stringify(eng.summarize(getSession(session_id)), null, 2));
  } catch (e) {
    return fail(e);
  }
});

server.tool('list_vocabulary', 'List every verb and noun the engine knows. Use it to design test commands.', {}, async () => {
  try {
    const eng = await getEngine();
    return ok(JSON.stringify(eng.vocabulary(), null, 2));
  } catch (e) {
    return fail(e);
  }
});

// ------------------------------------------------------------- run_walkthrough

const Walkthrough = z.object({
  segments: z.array(z.object({ puzzle: z.string(), commands: z.array(z.string()) })),
  expect: z.object({ warmthAtEnd: z.number(), inventoryContains: z.array(z.string()) }),
});

server.tool(
  'run_walkthrough',
  'Play the canonical solution from content/walkthrough.json and report pass/fail per puzzle.',
  { path: z.string().default('content/walkthrough.json') },
  async ({ path }) => {
    try {
      const eng = await getEngine();
      const wt = Walkthrough.parse(JSON.parse(await readFile(path, 'utf8')));
      let state = eng.createInitialState();
      const report: Array<Record<string, unknown>> = [];
      let allPassed = true;

      for (const seg of wt.segments) {
        const problems: string[] = [];
        for (const cmd of seg.commands) {
          const r = eng.runInput(state, cmd);
          state = r.state;
          if (!r.recognized) problems.push(`Not recognized: "${cmd}"`);
          if (!r.text.trim()) problems.push(`Empty response: "${cmd}"`);
        }
        const s = eng.summarize(state);
        if (problems.length) allPassed = false;
        report.push({ puzzle: seg.puzzle, passed: problems.length === 0, problems, room: s.room, warmth: s.warmth });
      }

      const final = eng.summarize(state);
      const endChecks = {
        ended: final.ended,
        warmthIsExpected: final.warmth === wt.expect.warmthAtEnd,
        hasRequiredItems: wt.expect.inventoryContains.every((i) => final.inventory.includes(i)),
      };
      if (!Object.values(endChecks).every(Boolean)) allPassed = false;

      return ok(JSON.stringify({ allPassed, segments: report, endChecks, final }, null, 2));
    } catch (e) {
      return fail(e);
    }
  },
);

// --------------------------------------------------------------- find_softlocks

interface Node {
  key: string;
  state: OpaqueState;
  edges: Set<string>;
  expanded: boolean;
  ending: boolean;
  via?: { from: string; cmd: string };
}

server.tool(
  'find_softlocks',
  'Explore reachable game states breadth-first and report any state from which the ending can no longer be reached.',
  { max_states: z.number().int().min(100).max(200000).default(20000) },
  async ({ max_states }) => {
    try {
      const eng = await getEngine();
      const start = eng.createInitialState();
      const startKey = eng.stateKey(start);
      const nodes = new Map<string, Node>();
      nodes.set(startKey, { key: startKey, state: start, edges: new Set(), expanded: false, ending: eng.isEnded(start) });
      const queue: string[] = [startKey];

      while (queue.length > 0 && nodes.size < max_states) {
        const k = queue.shift() as string;
        const n = nodes.get(k) as Node;
        n.expanded = true;
        if (n.ending) continue; // the ending is terminal
        for (const cmd of eng.candidateCommands(n.state)) {
          const r = eng.runInput(n.state, cmd);
          const nk = eng.stateKey(r.state);
          n.edges.add(nk);
          if (!nodes.has(nk)) {
            nodes.set(nk, {
              key: nk,
              state: r.state,
              edges: new Set(),
              expanded: false,
              ending: eng.isEnded(r.state),
              via: { from: k, cmd },
            });
            queue.push(nk);
          }
        }
      }

      const truncated = queue.length > 0;

      // Reverse reachability: which nodes can reach an ending (or an unexpanded node, treated optimistically)?
      const reverse = new Map<string, string[]>();
      for (const n of nodes.values()) {
        for (const e of n.edges) {
          if (!reverse.has(e)) reverse.set(e, []);
          (reverse.get(e) as string[]).push(n.key);
        }
      }
      const good = new Set<string>();
      const work: string[] = [];
      for (const n of nodes.values()) {
        if (n.ending || !n.expanded) {
          good.add(n.key);
          work.push(n.key);
        }
      }
      while (work.length > 0) {
        const k = work.pop() as string;
        for (const p of reverse.get(k) ?? []) {
          if (!good.has(p)) {
            good.add(p);
            work.push(p);
          }
        }
      }

      const stuck = [...nodes.values()].filter((n) => !good.has(n.key));
      const pathTo = (key: string): string[] => {
        const path: string[] = [];
        let cur = nodes.get(key);
        while (cur?.via) {
          path.unshift(cur.via.cmd);
          cur = nodes.get(cur.via.from);
        }
        return path;
      };
      const examples = stuck.slice(0, 5).map((n) => ({ summary: eng.summarize(n.state), commandsToReachIt: pathTo(n.key) }));
      const endingsFound = [...nodes.values()].filter((n) => n.ending).length;

      return ok(
        JSON.stringify(
          {
            statesExplored: nodes.size,
            truncated,
            note: truncated
              ? 'Exploration hit max_states; unexplored states are assumed fine, so this result is NOT a proof. Raise max_states or shrink candidateCommands().'
              : 'Full state space explored.',
            endingReachableFromStart: endingsFound > 0,
            softlockCount: stuck.length,
            examples,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

// ---------------------------------------------------------------- fuzz_commands

const BAD_PATTERNS = /undefined|\[object|NaN|I don't understand|unknown command|error/i;

server.tool(
  'fuzz_commands',
  'Throw random, typo-ridden, and junk commands at the game. Reports crashes, empty replies, leaked internals, and generic error text.',
  {
    count: z.number().int().min(10).max(2000).default(300),
    seed: z.number().int().default(1986),
    session_id: z.string().optional().describe('Fuzz from this session state. Omit to start from a fresh game.'),
  },
  async ({ count, seed, session_id }) => {
    try {
      const eng = await getEngine();
      const rand = mulberry32(seed);
      const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
      const vocab = eng.vocabulary();
      const junk = ['', '   ', '???', 'xyzzy', 'asdf qwer', 'a'.repeat(150), 'look at the the the', 'USE', 'with with with'];
      const typo = (s: string): string => (s.length > 3 ? s.slice(0, 2) + s.slice(3) : s);

      // Thread state through the run so the variant counter advances. Restart after the ending.
      // The session's stored state is not modified.
      let state = session_id ? getSession(session_id) : eng.createInitialState();
      const issues: Array<{ command: string; problem: string }> = [];
      const seen = new Map<string, number>();

      for (let i = 0; i < count; i++) {
        const roll = rand();
        let cmd: string;
        if (roll < 0.15) cmd = pick(junk);
        else if (roll < 0.35) cmd = typo(`${pick(vocab.verbs)} ${pick(vocab.nouns)}`);
        else if (roll < 0.55) cmd = `${pick(vocab.verbs)} ${pick(vocab.nouns)} with ${pick(vocab.nouns)}`;
        else cmd = `${pick(vocab.verbs)} ${pick(vocab.nouns)}`;

        try {
          const r = eng.runInput(state, cmd);
          state = eng.isEnded(r.state) ? eng.createInitialState() : r.state;
          if (!r.text.trim()) issues.push({ command: cmd, problem: 'Empty response' });
          else if (BAD_PATTERNS.test(r.text)) issues.push({ command: cmd, problem: `Generic or leaked text: "${r.text.slice(0, 80)}"` });
          seen.set(r.text, (seen.get(r.text) ?? 0) + 1);
        } catch (err) {
          issues.push({ command: cmd, problem: `Threw: ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      const repetitive = [...seen.entries()]
        .filter(([, n]) => n >= Math.max(15, count / 10))
        .map(([line, n]) => ({ line: line.slice(0, 80), times: n }));

      return ok(
        JSON.stringify(
          {
            commandsTried: count,
            issueCount: issues.length,
            issues: issues.slice(0, 15),
            repetitiveResponses: repetitive,
            hint: 'repetitiveResponses means a fallback bank is too small (spec requires 8 variants per warmth level).',
          },
          null,
          2,
        ),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('playtest MCP server running on stdio');
