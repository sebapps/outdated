# Outdated: A Text Adventure (submission write-up)

An Infocom-style, text-only adventure. A 16-year-old wakes in the basement of his late father's childhood home, frozen in the 1980s, and has to use his dad's old gadgets to get out. Five rooms, five puzzles, five keys. The narrator starts sarcastic and gets sincere as the puzzles are solved.

## How to play

- `npm install`, then `npm run dev`, and open the page. `npm run build` makes a static bundle.
- Keyboard only. Type short commands (LOOK, EXAMINE, TAKE, SEARCH, OPEN, USE x WITH y, GO). HELP lists them. HINT gives three escalating hints per puzzle.
- Accessibility: mute toggle (Alt+M), reduce-effects toggle (Alt+E) for flicker and shake, text size (Alt+Plus, Alt+Minus). Every sound also appears as a caption, so the game is fully playable muted.
- `public/feelie.html` is a one-page printable "feelie": Dad's handwritten notes. Open it in a browser and print.

## How Kiro was used

### Specs (`.kiro/specs/eighties-text-adventure/`)
The project was built from a requirements, design and tasks spec instead of free-form prompting.

- **requirements.md** states testable acceptance criteria per room (for example, "WHEN the player sets the VCR clock THEN the system SHALL respond with the final big joke, and it SHALL NOT be required to progress"). Those "SHALL NOT be required" lines became the soft-lock rules.
- **design.md** fixed the architecture before any code: a pure `(state, command) -> (newState, events)` engine, content as JSON, a narration layer that turns events into text, and audio as an optional layer driven by the same events.
- **tasks.md** ordered the work (engine, parser, one puzzle per task, narration, hints, UI, audio, verification, polish). Each task was run on its own and checked against its acceptance criteria. The walkthrough was re-run after every puzzle task.

### Steering (`.kiro/steering/`)
Four always-on files kept every session consistent:

- `product.md`: premise, structure, emotional arc, and the hard content rules (no lyrics, no real people, never mock Dad, sincere grief, nothing after the ending).
- `tech.md`: TypeScript, Vite, plain DOM, Web Audio, Vitest; the architecture rules (deterministic engine, content is data, separate narration layer, no soft-locks); accessibility requirements.
- `narrator-voice.md`: the voice, the Warmth Ladder (levels 0 to 4), silence beats, failure-bank rules (at least 8 variants per generic failure per warmth level), hint voice, and what an optional LLM narrator may and may not do.
- `mcp-tools.md`: when to run which verification tool.

The practical effect: new narration (including the HELP screen added in the polish task) came out in the right register for each warmth level without being re-explained, and the content rules were applied to everything automatically.

### Hooks (`.kiro/hooks/`)
- **narration-safety-scan** (on save of `content/narration*.json` or `content/voice-lines*.json`): asks the agent to check changed lines against the hard rules (lyrics, real names, mocking Dad, warmth match, early solution reveals, and the protected `video_adult_dad_final` line).
- **verify-on-content-change** (on save of any `content/*.json` or the puzzle bible): runs the walkthrough, soft-lock and property tests. It ships disabled until those tests exist; see "Status" below.

### MCP servers (`.kiro/settings/mcp.json`)
- **playtest** (`tools/playtest-mcp`): lets an agent play the real engine with `new_game` and `send_command`, replay `content/walkthrough.json` (`run_walkthrough`), search for dead ends (`find_softlocks`), and throw junk input at the parser (`fuzz_commands`).
- **voice-lines** (`tools/tts-mcp`): generates short spoken lines from `content/voice-lines.json` with stock text-to-speech voices. It starts in dry-run mode. Every line has a caption. The adult-Dad final line is written by the developer, not generated.

### Agents (`.kiro/agents/`)
- **narrator-writer**: can write only `content/**` and the puzzle bible, never code. It follows the narrator-voice rules and refuses to touch `video_adult_dad_final`.
- **playtester**: read-only, plays through the MCP server, and reports what the narration actually said instead of what was expected.

## Design decisions worth knowing

- **Deterministic engine.** Puzzle logic never touches the DOM, audio, the network or an LLM. Variant choice is seeded, so a transcript is reproducible.
- **Content is data.** Rooms, items, verbs, hints and narration banks are JSON validated at load, with every cross-reference checked.
- **No soft-locks, enforced by tests.** `tests/softlock.test.ts` explores reachable states layer by layer and asserts each can still reach the ending. Keys are never consumed, and the pencil can never be dropped, because it comes back in the last scene.
- **Silence beats.** After the answering machine, the reversed record and the final video, the narrator says nothing sarcastic. The LLM provider is bypassed for these.
- **Canned first.** The game is complete with the canned narrator. An LLM narrator is optional, validated, and falls back immediately.

## Polish pass (task 15): what was found and fixed

No human newcomer was available, so a newcomer was simulated: someone typing plausible natural phrasings through the same path the UI uses (parser with room scope, then engine). Six places where that player got stuck were fixed, and each is pinned by `tests/newcomer.test.ts`:

1. **HELP did nothing.** The verb existed but had no handler. It now prints a warmth-matched command list (five versions, `content/narration.json`, key `help`). No puzzle solutions in it.
2. **`TAKE KEY` was ambiguous** once the first key was in the player's pocket ("Which do you mean, the hallway key or the bedroom key?"). TAKE first preferred the key you were not carrying. Since the playtest fix, a found key goes straight into the pocket, so `TAKE KEY` answers "already carrying" and the ambiguity cannot arise.
3. **`BLOW ON CARTRIDGE` failed after the first failed boot**, because the cartridge was sitting in the console and the parser could not see it. The player is the one who has to figure out the odd verb, so the odd verb must at least be accepted. It now works while the cartridge is in the slot.
4. **`ADJUST TRACKING` was rejected** because "tracking" was not a noun. It is now an alias of the VCR.
5. **`OPEN DOOR`, `UNLOCK DOOR` and `USE KEY ON DOOR` were rejected** ("Nothing like a door in reach"). Doors are exits, not items. They now reach the engine; `OPEN DOOR` with the key in the pocket unlocks it.
6. **`OPEN BOX` then `SEARCH BOX` said "Done. Already. Moving on."** and went nowhere. It now points at the foam insert that still hides something.

## Status and what was verified

- The unit, puzzle, parser, narration, UI, audio, walkthrough and soft-lock suites pass. The canonical walkthrough also reaches the ending through the UI path (`tests/newcomer.test.ts`).
- `tests/properties.test.ts` and the playtest MCP adapter now work (the adapter exports from spec task 16.1 exist). See the playtest checkpoint results below.
- Voice generation (spec task 17) and the final adult-Dad line are the developer's to do.

## Not done by Kiro (needs a human)

- A playtest with a real person who has never seen the game. The simulated pass above is a stand-in, not a replacement.
- Recording the demo video. `docs/demo-video-script.md` has the shot list and checklist.
- Printing and checking the feelie on paper.
- Writing or recording the final adult-Dad line.

## Agents in practice (task 18.4)

**playtester** (read-only, via the playtest MCP). It ran the walkthrough (passes, ending reached), a 300-command fuzz run, and a soft-lock search. It reported:
- The soft-lock search was truncated at 20,000 states, found no soft-locks, and said `endingReachableFromStart: false`. The agent flagged this as a search artifact, not a proof.
- Two fallback lines dominated the fuzz run (32 and 73 repeats).
- Basement and Hallway keys can be found without the clue scene first, and found keys must be picked up with a separate `TAKE`.
- A stale hint after the basement is solved, noun-failure suggestions that list the wrong room's nouns, a few verb phrasings that fail, and a duplicated "static clears all at once" line in the video text.

**narrator-writer** (content only). It added 4 variants to each of the 10 `unknown_verb` and `cant_do` banks in `content/narration.json` (12 each, existing lines untouched). It declined to edit the duplicated video line and the Study `play record` line because both live in `src/engine/puzzles/*.ts`, not in `content/`. That is the agent's write restriction working as intended.

**Playtest findings: fixed and verified** (spec `playtest-findings-bugfix`). The playtester's nine code-side findings were fixed. Results at the checkpoint:
- `npx vitest --run`: 27 files, 347 tests, all passing, including the two `src/audio/voice.test.ts` tests that failed before (buffer contents, and the "[Dad's voice, over the static]" caption). The soft-lock suite is exhaustive within its candidate set (layer 5: 117,936 states, `truncated=false`, goal found).
- `run_walkthrough`: all five segments pass, the ending is reached, warmth 4, pencil kept.
- `find_softlocks` (MCP, default 20,000 states): `truncated: true`, 0 soft-locks found, `endingReachableFromStart: false`. The truncation makes this a non-proof, and the `false` is a search artifact of the cap, as before. The in-repo soft-lock suite above is the stronger evidence.
- `fuzz_commands` (MCP, default seed 1986, 300 commands): 0 issues, but `repetitiveResponses` still lists "Words, you have them. Just not the ones I know. Try EXAMINE something." 77 times and "Sure, and I'll grow a mullet. Try again." 32 times. These numbers match the old, unfixed harness, so the running MCP server is still holding the old code. It needs another restart to pick up the fuzz change in `tools/playtest-mcp/server.ts`. I did not edit the adapter. The in-process seeds 1986, 7 and 42 checks in `tests/playtest-findings.test.ts` pass.

**Side effects to know about.**
- Fix 3.6 changed one parse: "press the play" now parses as PLAY with object "play" instead of PRESS. "press play" is unchanged.
- Fix 3.5 means a found key is already in the inventory, so `TAKE KEY` after `SEARCH INSIDE POCKET` answers that you are already carrying it. `tests/newcomer.test.ts` now pins that.
- The fuzz harness change contradicts the `mcp-tools` steering line that treats `repetitiveResponses` as a narration-bank bug. Repeats came largely from reusing one base state for every command, so a fixed single-line response repeated. Carrying state between commands fixes that, and the steering text should be amended.

## Content rules, as shipped

No song lyrics (titles and moods only, the title card is an ASCII homage plus "THE TOUCH"), no real people, products described generically, the narrator never mocks Dad, and nothing follows the ending sequence.
