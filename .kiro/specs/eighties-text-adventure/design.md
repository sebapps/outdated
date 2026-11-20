# Design Document

## Overview

The game is a pure TypeScript state machine wrapped by a thin terminal UI. All puzzle logic is deterministic and data-driven. An optional narration layer (canned or LLM) turns engine events into text, and an optional audio layer plays sounds for the same events.

Content source of truth: #[[file:docs/puzzle-bible.md]]

## Architecture

```
Player input
   |
   v
 Parser  --->  Command { verb, directObject?, indirectObject? }
   |
   v
 Engine.step(state, command)  --->  { newState, events[] }
   |                                   |
   |                    +--------------+---------------+
   v                    v                              v
 UI renders      Narration layer                 Audio layer
 state/text      (Canned or LLM,                 (Web Audio,
                  uses warmth)                    captions always)
```

Rules:
- `Engine.step` is pure. No DOM, no network, no audio, no randomness (variant selection uses a seeded counter stored in state).
- The narrator never feeds back into the engine.

## Data model

```ts
type RoomId = 'basement' | 'hallway' | 'boyhoodBedroom' | 'study' | 'grandparentsBedroom' | 'outside';

interface GameState {
  room: RoomId;
  inventory: ItemId[];
  flags: Record<string, boolean>;      // puzzle progress, see below
  itemStates: Record<ItemId, string>;  // e.g. cassette: 'tangled' | 'rewound' | 'loaded'
  unlockedDoors: RoomId[];
  warmth: 0 | 1 | 2 | 3 | 4;
  hintTier: Record<PuzzleId, 0 | 1 | 2 | 3>;
  idleTurns: number;
  variantCounter: number;              // seeded counter for canned line selection
}

interface Command {
  verb: Verb;
  directObject?: string;
  indirectObject?: string;
}

type EngineEvent =
  | { type: 'ROOM_ENTERED'; room: RoomId }
  | { type: 'ITEM_TAKEN'; item: ItemId }
  | { type: 'ITEM_SEARCHED'; item: ItemId; found?: ItemId }
  | { type: 'PUZZLE_SOLVED'; puzzle: PuzzleId }
  | { type: 'DOOR_UNLOCKED'; room: RoomId }
  | { type: 'SOUND'; cue: SoundCue; caption: string }
  | { type: 'MESSAGE'; id: string }            // a content-defined passage to show
  | { type: 'SILENCE_BEAT' }
  | { type: 'WARMTH_CHANGED'; level: number }
  | { type: 'ENDING' };
```

## Puzzle progress flags

| Puzzle | Flags (in order) | Reward | Warmth after |
|--------|-------------------|--------|--------------|
| basement | `hasPencil`, `tapeRewound`, `tapeLoaded`, `tapePlayed`, `atariBoxSearched` | hallwayKey | 1 |
| hallway | `pagerRead`, `numberDialed`, `messageHeard`, `jacketSearched` | bedroomKey | 2 |
| boyhoodBedroom | `cartridgeInserted`, `cartridgeBlown`, `titleSeen`, `toyboxOpened`, `trailerUnfolded`, `compartmentSearched` | studyKey | 2 |
| study | `turntablePlugged`, `recordPlayedForward` (optional), `recordReversed`, `diskBoxOpened` | grandparentsKey | 3 |
| grandparentsBedroom | `tapeFound`, `tapeInserted`, `trackingAdjusted`, `videoWatched`, `clockRadioOpened` | frontDoorKey | 4 |

Notes:
- Flags are only set by the engine in response to valid commands.
- Optional beats (battery gate in basement, wrong-number gags, `SET CLOCK`) must never block progress.
- Warmth also rises by one at the silence beat moments listed in narrator-voice.md. The table shows warmth at puzzle completion.

## Parser

- Normalize input: lowercase, strip punctuation, drop filler words (the, a, an, to).
- Verb table with synonyms, for example `TURN COUNTERCLOCKWISE` / `SPIN BACKWARDS` / `REVERSE` / `ROTATE BACKWARD` all map to `REVERSE`.
- Noun table with aliases per item (for example "walkman", "cassette player", "player").
- Two-object commands use prepositions: `with`, `on`, `in`, `into`, `to`.
- Unknown input falls through to an in-character response selected by warmth and a rotating variant index.

Key verbs for puzzles: `REWIND` (with pencil), `PLAY`, `STOP`, `DIAL`, `SEARCH`, `OPEN`, `BLOW` (on), `INSERT`, `UNFOLD`, `REVERSE`, `PLUG`, `ADJUST`, `SET`, `REMOVE`, `UNLOCK`.

## Narration layer

```ts
interface NarratorProvider {
  narrate(event: EngineEvent, ctx: { warmth: number; variant: number }): Promise<string>;
}
```

- `CannedNarrator`: looks up lines in `content/narration.json` by event and warmth level. Always available.
- `LlmNarrator` (optional): receives only the event, warmth, and a short style brief taken from narrator-voice.md. Returns 1 to 3 sentences. Wrapped by a 1.5 second timeout and a validator that rejects outputs that are too long, mention lyrics, or reveal puzzle solutions. On any failure, return the `CannedNarrator` result.
- `SILENCE_BEAT` events bypass the narrator and render a short pause plus an optional single sincere line from content.

## Audio layer

- `AudioEngine` subscribes to `SOUND` events.
- Synthesized cues: rotary dial click train, phone ring, answering machine beep, tape hiss, tape clunk, VCR whirr, static burst, alarm buzz.
- Sample-based cues: the reversed record message and Dad's recorded lines (see puzzle bible). Reversal is done by reversing the decoded `AudioBuffer`.
- Every cue emits a caption string that the UI prints in brackets (for example `[rotary dial clicks]`).
- Respect the mute and reduce-effects toggles.

## UI

- Single page, monospaced font, CRT styling (scanlines, slight glow, vignette) via CSS.
- Output pane scrolls. Input line at the bottom with a blinking cursor.
- Typewriter text reveal, skippable with any key.
- Reduce-effects mode disables flicker, flashing, glow pulses, and shake.

## Error handling and recovery

- Wrong-order actions never leave an object in an unusable state. For example, spinning the record too much "scratches" it but a `FLIP RECORD`/`RESET` path always restores it, narrated in character.
- Ejecting the VCR tape at the wrong time resets tracking but keeps the tape in the player's inventory.

## Testing strategy

- **Walkthrough test:** executes the canonical command list for all five puzzles and asserts the `ENDING` event fires, the pencil is in inventory, and warmth is 4.
- **Per-puzzle tests:** each puzzle has a solve test and tests for wrong-order and decoy actions.
- **Soft-lock test:** breadth-first explores reachable states from the start using a limited set of valid commands and asserts that every reachable state can still reach `ENDING`.
- **Narration validator tests:** the LLM output validator rejects lyrics, overlong output, and early solution reveals.

## Correctness properties

1. The engine is deterministic: the same state and command always produce the same output.
2. Every state reachable from the start can reach the ending.
3. The pencil is never removed from the inventory.
4. The warmth level never decreases.
5. No narration output contains song lyrics or real people's names.

## Developer tooling (MCP)

Two MCP servers support development. Neither ships with the game. They are registered in `.kiro/settings/mcp.json` and described to Kiro in `.kiro/steering/mcp-tools.md`.

### Playtest server (`tools/playtest-mcp`)

```
Kiro  <--MCP/stdio-->  server.ts  --->  engineAdapter.ts  --->  src/engine (pure, deterministic)
```

- `engineAdapter.ts` is the single coupling point. It dynamically imports `src/engine/index.ts` and fails with a clear message until that module exists.
- Engine module contract: `createInitialState`, `runInput` (pure; returns state, narration text, event type names, and `recognized`), `candidateCommands`, `stateKey`, `isEnded`, `summarize`, `vocabulary`.
- `stateKey` must exclude cosmetic fields (variantCounter, idleTurns, hintTier) so state exploration stays tractable.
- `find_softlocks` builds the reachable state graph breadth-first, then does reverse reachability from ending states. Any explored state that cannot reach an ending is reported with the shortest command path to it. Unexpanded states are treated optimistically, and truncation is reported.
- `fuzz_commands` uses a seeded PRNG so runs are reproducible.
- The Vitest `walkthrough` and `softlock` tests remain the CI source of truth. The MCP tools let Kiro run the same checks interactively while building.

### Voice server (`tools/tts-mcp`)

```
content/voice-lines.json --> synthesize_manifest --> public/audio/voice/*.mp3 + index.json
                                                              |
                                                     AudioEngine (runtime)
                                                     applies "effect" via Web Audio
```

- Voices are Amazon Polly stock neural voices. Audio files are clean; effects are applied at runtime.
- `index.json` stores a hash of each line's text, voice, and engine, so regeneration only touches changed lines.
- The record message is stored clear. For the `record_reversible` effect, the audio layer plays the reversed buffer for the forward-play step and the normal buffer once the player reverses the record.
- The game loads `index.json` at startup. A missing file or line means caption-only playback.

## Property-based testing

`tests/properties.test.ts` (fast-check + Vitest) turns the correctness properties above into executable checks. A generator produces random lists of indices; each index picks one command from `candidateCommands(state)` at that step, so sessions are valid-ish rather than pure noise. Invariants checked on every step: determinism, purity, pencil retention, monotonic warmth, no provable soft-lock (bounded search; only a definite "no" fails, "unknown" is reported as inconclusive), and no throw, empty reply, or leaked internals for arbitrary input strings. fast-check shrinks failures to a minimal command sequence and prints a replay seed.

## Custom agents and hooks

- `.kiro/agents/playtester.md`: read-only agent limited to `read` and the `playtest` MCP server. It cannot edit files, so it cannot "fix" a failing check by changing it.
- `.kiro/agents/narrator-writer.md`: can only write `content/**` and `docs/puzzle-bible.md`, and is bound to the narrator voice rules.
- `.kiro/hooks/verify-on-content-change.json`: runs walkthrough, soft-lock, and property tests when content changes (shipped disabled until the tests exist).
- `.kiro/hooks/narration-safety-scan.json`: agent hook that checks saved narration against the lyrics, real-names, tone, and spoiler rules.
