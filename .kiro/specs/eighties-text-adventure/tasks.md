# Implementation Plan

- [x] 1. Project setup
  - Scaffold a Vite + TypeScript project with Vitest.
  - Create the folder layout described in tech.md (`src/engine`, `src/narration`, `src/audio`, `src/ui`, `content`, `tests`).
  - _Requirements: 10, 11_

- [x] 2. Content schema and loader
  - Define TypeScript types and JSON schemas for rooms, items, verbs, hints, and narration lines.
  - Write a loader that validates every content file at startup and fails loudly on missing references.
  - _Requirements: 2, 8_

- [x] 3. Parser
  - [x] 3.1 Implement input normalization, verb and noun synonym tables, and two-object command parsing.
    - _Requirements: 1.1, 1.2_
  - [x] 3.2 Implement unknown-input and ambiguity handling that returns an event, never throws.
    - _Requirements: 1.3, 1.4_
  - [x] 3.3 Unit tests covering every verb synonym listed in the puzzle bible.
    - _Requirements: 1.2, 1.5_

- [x] 4. Engine core
  - [x] 4.1 Implement `GameState`, `Command`, `EngineEvent`, and the pure `step` function.
    - _Requirements: 2_
  - [x] 4.2 Implement rooms, movement, locked doors, inventory, LOOK, EXAMINE, TAKE, DROP, SEARCH, OPEN.
    - _Requirements: 1.5, 2.1-2.6_
  - [x] 4.3 Add seeded variant selection (no `Math.random` inside the engine).
    - _Requirements: 8_

- [x] 5. Puzzle 1: Basement
  - Implement pencil, cassette, Walkman, Atari box, optional battery gate, and the hallway key.
  - Ensure the pencil is never consumed.
  - Write solve and wrong-order tests.
  - _Requirements: 3.1-3.6_

- [x] 6. Puzzle 2: Hallway
  - Implement pager, rotary phone `DIAL`, wrong-number results, answering machine message, closet and jacket (outer pocket decoy, inner pocket key).
  - Add the first silence beat.
  - _Requirements: 4.1-4.6_

- [x] 7. Puzzle 3: Dad's boyhood bedroom
  - Implement NES, cartridge, `BLOW` verb, failed first boot, title card, toybox, decoy toys, and the trailer with `UNFOLD` and `SEARCH`.
  - Keep the title card free of song lyrics; use the approved ASCII homage and "THE TOUCH" only.
  - _Requirements: 5.1-5.5_

- [x] 8. Puzzle 4: Study
  - Implement unplugged turntable, forward playback gibberish, reversal verbs, recovery path, newspaper clipping, sticky note, and the disk box with the key.
  - Add the second silence beat.
  - _Requirements: 6.1-6.5_

- [x] 9. Puzzle 5 and ending: Grandparents' bedroom
  - Implement aerobics tape case, VCR, tracking adjustment, optional clock gag, home video, clock radio, and the front door.
  - Implement the ending: alarm, black screen, wake-up scene, pencil in pocket, and no content after it.
  - Add the third silence beat.
  - _Requirements: 7.1-7.6_

- [x] 10. Narration and warmth
  - [x] 10.1 Implement `CannedNarrator` with at least 8 variants per generic failure per warmth level.
    - _Requirements: 8.1, 8.2, 1.3_
  - [x] 10.2 Implement warmth transitions and silence-beat handling.
    - _Requirements: 8.1, 4.4, 6.3, 7.4_
  - [x] 10.3 (Optional) Implement `LlmNarrator` with timeout, validator, and canned fallback.
    - _Requirements: 8.3, 8.4, 8.5_

- [x] 11. Hints and nudges
  - Implement the HINT command with three tiers per puzzle and idle nudges.
  - _Requirements: 9.1, 9.2_

- [x] 12. UI and presentation
  - Build the CRT terminal UI, typewriter reveal, input handling, and keyboard-only operation.
  - Add mute and reduce-effects toggles and adjustable text size.
  - _Requirements: 10.1, 10.4, 10.5_

- [x] 13. Audio
  - Implement synthesized cues, the reversed-buffer record playback, and captions for every sound.
  - _Requirements: 10.2, 10.3, 6.3_

- [x] 14. Verification
  - [x] 14.1 Write `walkthrough.test.ts` that plays the whole game and asserts the ending.
    - _Requirements: 11.1_
  - [x] 14.2 Write `softlock.test.ts` that explores reachable states and asserts every one can still reach the ending.
    - _Requirements: 11.2, 9.3_
  - [x] 14.3 Write narration validator tests (no lyrics, no real names, no early solution reveals).
    - _Requirements: 8.5_

- [x] 15. Polish and submission
  - Playtest with someone who has never seen the game; fix the places they get stuck.
  - Add a one-page printable "feelie" (Dad's handwritten notes) and a HELP screen.
  - Record a demo video that shows audio and the CRT presentation.
  - Prepare the write-up covering how specs, steering, hooks, and MCP were used.

- [x] 16. Playtest MCP server
  - Do this right after task 4, so Kiro can playtest each puzzle as it is built.
  - [x] 16.1 Implement `src/engine/index.ts` exports required by `tools/playtest-mcp/engineAdapter.ts` (`runInput`, `candidateCommands`, `stateKey`, `isEnded`, `summarize`, `vocabulary`).
    - _Requirements: 12.1, 12.7_
  - [x] 16.2 Run `npm install` in `tools/playtest-mcp`, enable the server in Kiro, and confirm `new_game` and `send_command` work.
    - _Requirements: 12.1, 12.2_
  - [x] 16.3 Reconcile `content/walkthrough.json` with the real parser, then confirm `run_walkthrough` passes for each completed puzzle.
    - _Requirements: 12.3_
  - [x] 16.4 Run `find_softlocks` and `fuzz_commands`; fix every reported dead end, crash, and repetitive fallback.
    - _Requirements: 12.4, 12.5, 12.6_

- [ ] 17. Voice generation MCP server
  - [x] 17.1 Run `npm install` in `tools/tts-mcp`, configure AWS credentials, and use `list_voices` to confirm the voice names in `content/voice-lines.json`.
    - _Requirements: 13.1_
  - [x] 17.2 Run `synthesize_manifest` in dry run mode, then set `TTS_DRY_RUN` to 0 and generate the audio.
    - _Requirements: 13.2, 13.5_
  - [x] 17.3 Write or record the final adult-Dad line yourself and replace the placeholder in the manifest.
    - _Requirements: 13.3_
  - [x] 17.4 Load `public/audio/voice/index.json` in the audio layer, show captions, apply per-line effects, and verify the game works with no audio files present.
    - _Requirements: 13.4, 13.6, 13.7_

- [x] 18. Property-based tests, agents, and hooks
  - [x] 18.1 Install `vitest` and `fast-check`; make `tests/properties.test.ts` pass against the real engine (adjust the `PENCIL` item id if needed).
    - _Requirements: 14.1, 14.2_
  - [x] 18.2 Implement property P7 (the ending is terminal) by reusing the walkthrough command list.
    - _Requirements: 14.2_
  - [x] 18.3 Enable `.kiro/hooks/verify-on-content-change.json` once the walkthrough, soft-lock, and property tests exist.
    - _Requirements: 11.3, 14.4_
  - [x] 18.4 Try the `playtester` and `narrator-writer` agents in the IDE agent picker; note in the write-up what each caught or prevented.
    - _Requirements: 12.1_
