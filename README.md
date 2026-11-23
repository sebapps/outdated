# Outdated: A Text Adventure

An Infocom-style, text-only adventure about a 16-year-old who spent years teasing his late father for loving 1980s technology. Now he wakes up in the basement of his dad's childhood home, preserved in 1980s amber, and the only way out is to use that technology.

Five rooms. Five puzzles. Five keys. Every key is hidden inside something that only existed in the 80s, and every clue is something Dad once told him that he never really listened to.

> The narrator starts out sarcastic. Each solved puzzle lowers its guard a little.

## Play

You type short commands and read what happens. No text adventure experience is needed.

```
> look
> examine pencil
> search the toybox
> use cassette with pencil
```

| Command | What it does |
|---------|--------------|
| `LOOK` (`L`) | Describe the room again |
| `EXAMINE <thing>` (`X`) | Look closely at something |
| `TAKE` / `DROP <thing>` | Pick something up or put it down |
| `SEARCH <thing>` | Look inside and behind |
| `OPEN <thing>` | Open lids, boxes and small doors |
| `INVENTORY` (`I`) | See what you are carrying |
| `GO <direction>` | Move: `NORTH`, `UP`, `DOWN`, or a door's name |
| `USE <a> WITH <b>` | Combine two things |
| `PLAY`, `INSERT`, `PRESS`, `DIAL` ... | Gadgets have their own verbs |
| `HINT` | A nudge, in three escalating tiers per puzzle |
| `HELP` | The command list |

When in doubt: `LOOK`, then `EXAMINE` everything.

### Accessibility

- Every sound also appears as a text caption, so the game is fully playable muted.
- Keyboard only.

| Shortcut | Action |
|----------|--------|
| `Alt+M` | Mute or unmute |
| `Alt+E` | Reduce effects (no flicker, flashing or screen shake) |
| `Alt+Plus` / `Alt+Minus` | Larger or smaller text |

`public/feelie.html` is a one-page printable "feelie" with Dad's handwritten notes. Open it in a browser and print it.

## Run it locally

You need Node.js 20 or later and npm.

```bash
npm install
npm run dev
```

Vite prints a local address, usually `http://localhost:5173`. Open it in a browser.

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check, then build the site into `dist/` |
| `npm run preview` | Serve the built site locally |
| `npm run typecheck` | Run the TypeScript compiler without emitting files |
| `npm test` | Run the whole test suite once |

The full test suite includes an exhaustive soft-lock search that takes a few minutes. To run only part of it, use `npx vitest --run <path>`.

## Deploy

The game is a static site. `npm run build` writes everything to `dist/`, and any static host can serve it: S3 with CloudFront, Cloud Storage, Firebase Hosting, Netlify, Cloudflare Pages or GitHub Pages.

This repository includes a `firebase.json` for Firebase Hosting:

```bash
npm run build
firebase deploy --only hosting
```

`dist/` is generated output. Don't edit it by hand, and answer **No** if `firebase init hosting` offers to overwrite `dist/index.html`. If you host under a subfolder, such as GitHub Pages at `/repo-name/`, set `base` in the Vite config.
## How it is built

- **TypeScript** in strict mode, with no `any`.
- **Vite** for the dev server and the production build.
- **Plain DOM and CSS.** There is no UI framework.
- **Web Audio API** for sound. Effects are synthesized in the browser, and the spoken lines are short MP3 files in `public/audio/voice/`.
- **Ajv** validates the JSON content files when the game loads.
- **Vitest** and **fast-check** for unit, puzzle, parser, walkthrough, soft-lock and property-based tests.

### Architecture

1. **Deterministic engine.** All puzzle logic is a pure state machine, `(state, command) -> (newState, events)`. It never depends on an LLM, the network, audio or the DOM. Wording variants come from a seeded counter, so a playthrough is reproducible.
2. **Content is data.** Rooms, items, verbs, hints and narration banks live in JSON files under `content/`, and the engine reads them.
3. **Separate narration layer.** The engine emits events. A narrator turns them into text, at a tone that matches the current warmth level. The built-in canned narrator always works. An optional LLM narrator may only rephrase flavor text, and any failure falls back to canned text.
4. **Optional audio layer.** It listens to the same events. Muted or missing audio never changes the game.
5. **No soft-locks.** No sequence of valid commands may make the game unwinnable. Tests enforce this.

### Project layout

```
.
|-- content/            JSON content: rooms, items, verbs, hints, narration, walkthrough, voice lines
|-- docs/               puzzle bible, write-up, demo video script
|-- public/             feelie.html and voice audio (public/audio/voice)
|-- src/
|   |-- engine/         state machine, parser, world model, puzzles (pure TypeScript)
|   |-- narration/      canned and optional LLM narrators, warmth logic
|   |-- audio/          Web Audio synthesis, voice playback, captions
|   |-- ui/             terminal UI and CRT styling
|   `-- main.ts         entry point
|-- tests/              walkthrough, soft-lock, property and regression tests
|-- tools/
|   |-- playtest-mcp/   MCP server that lets an agent play and fuzz the real engine
|   `-- tts-mcp/        MCP server that generates voice lines
`-- .kiro/              specs, steering, hooks and agents used to build the game
```

## Testing

```bash
npm test
```

- `tests/walkthrough.test.ts` plays the whole game from start to finish.
- `tests/softlock.test.ts` explores reachable states layer by layer and checks that each can still reach the ending.
- `tests/properties.test.ts` uses fast-check to check determinism, purity, that warmth never decreases, that the pencil is never lost, and that any input gets an in-character response.
- Every puzzle has a test that solves it and tests for its wrong-order variants.

## Content rules

- No song lyrics, not even short ones. Songs are evoked by mood or title only.
- No real people or celebrities. Products are described generically.
- The narrator may mock objects and the protagonist's own cynicism. It never mocks Dad.
- Grief is handled sincerely.
- Nothing follows the ending sequence.

## Built with Kiro

The game was built with [Kiro](https://kiro.dev) using specs (requirements, design and tasks), steering files for the narrator voice and architecture rules, agent hooks, and two project agents: `narrator-writer`, which can only edit content, and `playtester`, which plays the game through an MCP server and reports what it sees. See `docs/writeup.md` for details.

## Voice lines

Voice lines are generated from `content/voice-lines.json` with stock text-to-speech voices. The generator is in `tools/tts-mcp` and starts in dry-run mode. The adult Dad's final line is written by the developer and is not generated. Lo-fi effects are applied at runtime in the browser, not baked into the audio files.
