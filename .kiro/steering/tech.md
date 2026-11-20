---
inclusion: always
---

# Tech Stack and Structure

## Stack (change if you prefer something else, but tell Kiro)
- Language: TypeScript
- Build tool: Vite
- UI: plain DOM and CSS, no framework. One page, a scrolling text terminal with a command input.
- Audio: Web Audio API, synthesized where possible (rotary clicks, ring, beep, tape hiss, static, alarm) and short sample files where needed (reversed record message).
- Tests: Vitest
- Hosting: any static host.

## Architecture rules
1. **Deterministic game engine.** All puzzle logic lives in a pure state machine: `(state, command) -> (newState, events)`. It must never depend on an LLM, the network, audio, or the DOM.
2. **Content is data.** Rooms, items, clues, hints, decoys, and canned narration live in JSON files under `content/`, not in code. The engine reads them.
3. **Narration layer is separate.** The engine emits events (for example `ITEM_SEARCHED`, `PUZZLE_SOLVED`). A narration layer turns events into text. This layer has two providers: `CannedNarrator` (always available) and `LlmNarrator` (optional, falls back to canned).
4. **Audio is an optional layer** driven by the same events. The game must be fully playable muted, with every sound also shown as a text caption.
5. **No soft-locks.** No sequence of valid commands may make the game unwinnable. This is enforced by tests (see spec).

## Folder layout
```
eighties-game/
  .kiro/
    steering/        # these files
    specs/           # requirements, design, tasks
  docs/
    puzzle-bible.md  # full room and puzzle content (source of truth for content)
  content/           # JSON built from the puzzle bible
  src/
    engine/          # state machine, parser, world model (pure TS)
    narration/       # canned + LLM providers, warmth logic
    audio/           # Web Audio synth and playback
    ui/              # terminal UI, CRT styling
  tests/
    walkthrough.test.ts   # plays the whole game start to finish
    softlock.test.ts      # explores command sequences for dead ends
```

## Style conventions
- Strict TypeScript. No `any`.
- Small pure functions. Engine files have no side effects.
- Every puzzle has a test that solves it and a test that checks its wrong-order variants.

## Accessibility
- Text captions for all audio. Mute toggle. A "reduce effects" toggle that disables flicker, flashing, and screen shake.
- Keyboard-only play. Adjustable text size.
