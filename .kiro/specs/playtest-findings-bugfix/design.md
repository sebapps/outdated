# Playtest Findings Bugfix Design

## Overview

Nine defects came out of the playtester run and the full test run. They are independent, so the fix is a set of small, separate changes. Each change has its own failing test written first.

| # | Defect | Where it lives | Kind of fix |
|---|--------|----------------|-------------|
| 1.1 | Buffer-contents voice test fails | `src/audio/voice.test.ts` (fake audio context) | Fix the test. Audio code is correct. |
| 1.2 | Caption shown in double brackets, voice caption dropped | `src/ui/session.ts` | Fix the code. The test is correct. |
| 1.3 | Stale hint after a puzzle is solved | `src/engine/hints.ts`, `content/hints.json`, `src/engine/messages.ts` | New solved-state hint. |
| 1.4 | Noun-failure suggestions crowded out by carried items | `src/engine/parser/interpret.ts` and its two callers | Room items first. |
| 1.5 | Found keys need a separate TAKE | the five puzzle `afterStep` hooks, `world.ts`, `interpret.ts` | Key goes to the inventory when found. |
| 1.6 | Natural phrasings fail | `src/engine/parser/parser.ts`, `content/verbs.json` | Parser normalization and synonyms. |
| 1.7 | "Static clears all at once" printed twice | `src/engine/puzzles/grandparentsBedroom.ts` | Trim the adjustment line. |
| 1.8 | Study forward-play text restates its caption | `src/engine/puzzles/study.ts` | Rewrite one line. |
| 1.9 | Fuzz run shows 32 and 73 repeats | `tools/playtest-mcp/server.ts` | Carry state between fuzz commands. |

Two requested checks have a definite answer:

- **Keys found before the clue scene is intended.** Requirements 3.4 and 4.5 give the key with no precondition. The puzzle bible lists the clue first in its flow, but the only gate it names in the basement is the optional battery. The code gates the toybox (5.3), the disk box (6.4) and the clock radio cover (7.5), exactly where the requirements ask for it. Nothing changes. A test pins the behavior so a later change cannot gate these two keys by accident. If the owner wants those two keys gated, that is a product change to requirements 3.4 and 4.5, and it adds a soft-lock risk the project rules forbid.
- **A separate TAKE for found keys is not intended.** Requirement 2.3 says the system adds a found key to the inventory. The walkthrough contains `take key` lines only because it was written to fit the code.

## Glossary

- **Bug_Condition (C)**: The set of inputs that trigger any of the nine defects. It is the union of C1 to C9 below.
- **Property (P)**: The behavior required for inputs in C, defined by `expectedBehavior`.
- **Preservation**: Behavior for inputs outside C. It must stay identical before and after the fix.
- **F / F'**: The unfixed code and the fixed code.
- **Turn**: One player command and the lines the UI prints for it (`takeTurn` in `src/ui/session.ts`).
- **Caption**: A text line for a sound. Engine sound events carry captions that already include their brackets (for example `[tape hiss]`).
- **Voice caption**: The caption stored for a spoken line in `public/audio/voice/index.json`.
- **Solved puzzle**: A puzzle whose key has been found. Its flag is `atariBoxSearched` (basement), `jacketSearched` (hallway), `compartmentSearched` (boyhood bedroom), `diskBoxOpened` (study) or `clockRadioOpened` (grandparents' bedroom).
- **Particle**: A short word that completes a verb phrase, such as up, on, in, out, over, around.
- **Variant counter**: `GameState.variantCounter`, which picks the wording from a narration bank. It advances by one per command.
- **Threaded run**: A fuzz run that passes each command's resulting state into the next command.

## Bug Details

### Bug Condition

Each defect has its own trigger. The unfixed code shows the defective result for each of them.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X of type TestOrPlayerInput
  OUTPUT: boolean

  RETURN C1(X) OR C2(X) OR C3(X) OR C4(X) OR C5(X) OR C6(X) OR C7(X) OR C8(X) OR C9(X)
END FUNCTION

FUNCTION C1(X)   // fake audio context
  RETURN X is the test "reverses the buffer for the forward step only"
         AND fake.createBuffer(n).getChannelData(0) returns a new array on each call
END FUNCTION

FUNCTION C2(X)   // double brackets
  RETURN X is a turn whose events include a SOUND event
         AND X.event.caption starts with "[" and ends with "]"
END FUNCTION

FUNCTION C3(X)   // stale hint
  RETURN X.command = HINT
         AND solved(X.state, puzzleForRoom(X.state.room))
END FUNCTION

FUNCTION C4(X)   // wrong nouns in suggestions
  RETURN X is a command whose noun is not in reach
         AND count of carried items that come before the current room's items
             in global content order >= 1
END FUNCTION

FUNCTION C5(X)   // key needs TAKE
  RETURN X is a command that reveals a key (any of the five key items)
         AND the key is not in X.state.inventory after the turn
END FUNCTION

FUNCTION C6(X)   // natural phrasing
  RETURN X.text IN NaturalPhrasings
         AND parse(X.text) <> parse(canonical(X.text))
END FUNCTION

FUNCTION C7(X)   // duplicate video line
  RETURN X is the third ADJUST tracking turn with the tape playing
END FUNCTION

FUNCTION C8(X)   // Study forward play
  RETURN X is PLAY RECORD with the turntable plugged in and the record not scratched
END FUNCTION

FUNCTION C9(X)   // fuzz harness
  RETURN X is a fuzz_commands run with count > 1
         AND the run passes the same input state to every command
END FUNCTION
```

NaturalPhrasings, with the canonical command each should reach:

| Phrase | Canonical command |
|--------|-------------------|
| pick the pencil up | TAKE pencil |
| turn the NES on / switch the NES on | PRESS nes |
| put the cassette in the walkman / put cassette into walkman | INSERT cassette, walkman |
| slide the tape into the VCR | INSERT tape, vcr |
| plug the turntable in | PLUG turntable |
| take the tape out | REMOVE tape |
| flip the record over | FLIP record |
| open up the toybox | OPEN toybox |
| listen to the record / listen to the answering machine | PLAY record / PLAY answering machine |
| fix the tracking | ADJUST tracking |
| look in the closet | SEARCH closet |
| look for the cord | FIND cord |
| take a look at the pager | EXAMINE pager |
| unlock the door with the key | UNLOCK door |
| i need a hint | unknown verb, not INVENTORY |

### Examples

- **C1.** Fake context for the forward step: the engine writes `[0.4, 0.3, 0.2, 0.1]` into the reversed buffer, but the fake gives the test a fresh array, so the test sees `[0, 0, 0, 0]`. Expected: `[0.4, 0.3, 0.2, 0.1]`.
- **C2.** Playing the video shows `[[Dad's voice, over the static]]`. Expected: `[Dad's voice, over the static]` once. The unfixed code also drops the index caption because it compares the two with brackets removed and sees a duplicate.
- **C3.** Basement after the key is found, HINT prints "That tape is not going to fix itself. What would a kid in the 80s use?". Expected: a line saying the basement is done and the way on is up the stairs.
- **C4.** Hallway with the pencil and Walkman carried, `examine unicorn` prints "A "unicorn"? Not that you can see. Try EXAMINE with pencil, walkman, or phone table." Expected: "Try EXAMINE with phone table, rotary phone, or answering machine." With nothing in the room to fill, carried items fill the rest.
- **C5.** `search foam` prints "You search the foam insert and find: hallway key.", then `go up` is refused until `take key`. Expected: the key is carried after `search foam`, and `go up` works.
- **C6.** `pick the pencil up` prints an unknown-verb line. `plug the turntable in` looks for a noun called "turntable in". `i need a hint` shows the inventory.
- **C7.** Third `adjust tracking` prints "One last nudge, and the static clears all at once." and then "The static clears all at once." as the first line of the video.
- **C8.** `play record` prints the caption `[a garbled, warbling voice from the speakers]` and then "A garbled, warbling noise comes out of the speakers ..." in a four-sentence paragraph.
- **C9.** `fuzz_commands` with seed 1986 and 300 commands reports a line repeated 73 times and another 32 times. The same commands run with state carried forward give a most-repeated line of 15 ("You can't go that way.") and no unknown-verb or can't-do line above 10, across seeds 1986, 7 and 42.
- **Edge cases (not bugs).** `search cartridge box` then `search foam` before the tape is played still gives the key (3.2). `take key` with all keys already carried must not ask "Which do you mean?" (3.3).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The canonical walkthrough reaches the ending with warmth 4 and the pencil. The soft-lock search and property tests pass.
- The basement and hallway keys can be found before their clue scenes. The toybox, disk box and clock radio cover stay gated.
- Every parse that works today gives the same command. Unknown verbs still get in-character lines from banks of at least 8 variants.
- HINT in an unsolved puzzle gives tiers 1 to 3 and then repeats tier 3.
- Noun-failure lines keep their four wordings and the "Try EXAMINE with ..." ending.
- Muted or failed audio still shows captions. Only the forward record step is reversed. `video_adult_dad_final` and its text are not touched.
- Narrator rules hold: silence beats, clock gag before the video, no mocking of Dad, no lyrics, nothing after the pencil.
- The engine is deterministic and does not mutate its input.

**Scope:**
All inputs outside C should be unaffected. That includes:
- Commands that already parse and run correctly.
- Every puzzle solved by its canonical commands.
- Sound events whose captions are shown today (only the bracket count changes).
- HINT in rooms whose puzzle is not solved.
- Narration banks and unknown-verb text.

## Hypothesized Root Cause

1. **C1, fake without state.** `fakeContext().createBuffer` returns `{ getChannelData: () => new Float32Array(length) }`. The audio engine's `reverseBuffer` writes into one call's array and the buffer source later reads another call's array. A real `AudioBuffer` returns the same array every time. Confirmed by reading the test and engine, and consistent with the failure output `[0, 0, 0, 0]` for the forward case only. The reversed-not case passes because the fake decoder returns a fresh ramp that is never written to.
2. **C2, wrap of an already-wrapped string.** `linesFor` in `src/ui/session.ts` builds `[${event.caption}]`, and every engine caption already starts and ends with a bracket (about 30 captions). The `src/engine/index.ts` adapter strips the brackets before wrapping, which is why the MCP output looks right. `withVoiceCaptions` strips all outer brackets before comparing, so the single-bracket voice caption is treated as already shown. The first caption test passes only because it uses `includes`.
3. **C3, hint ignores progress.** `hint` in `src/engine/hints.ts` only reads `hintTier[puzzle]`. Nothing checks whether the puzzle is solved. It affects all five rooms, not only the basement.
4. **C4, scope list in global order.** `scopedNames` in `interpret.ts` walks `content.items` in file order and keeps the first three that pass `inScope`. `inScope` is true for carried items, and the pencil and Walkman are the first items in the file. The room's own item list (`rooms.json`) is never used.
5. **C5, keys are revealed in the room.** `reveal` in `world.ts`, `openInnerPocket` in the hallway module and the clock radio reveal all set the key's location to the room. Nothing moves it to the inventory. The five `afterStep` hooks already detect the first discovery with a one-time flag, which is the right place to collect it.
6. **C6, parser matches verbs only at the start of the line.** `parse` matches the longest verb phrase from the first tokens, so a particle after the object, an article inside a verb phrase ("fix the tracking" matches `fix` = REWIND) and verbs missing from `verbs.json` ("put", "listen to", "look in", "look for") all fall through. Trailing particles are not removed from noun phrases, `UNLOCK` and `OPEN` take one object only, and `i` is accepted as INVENTORY with any words after it.
7. **C7, two authors, one sentence.** `adjust_clear_prefix` and the opening line of `grandparentsBedroom:video` were written separately and both say the static clears all at once. The video is reachable first only through the third adjustment, so the prefix is the redundant one.
8. **C8, caption and narration written together.** The caption `[a garbled, warbling voice from the speakers]` and the `study:forward` text describe the same sound. The narration is also over the three-sentence limit. This reading comes from the code. The playtester's exact complaint is not recorded, so the first task confirms it with a test and the project owner can correct the target.
9. **C9, fuzz harness reuses its starting state.** `fuzz_commands` calls `eng.runInput(base, cmd)` on every iteration and never replaces `base` with `r.state`. The variant counter therefore stays at 0 and every bank returns its first variant. A threaded simulation with the same seed removes the repeats, so the narration banks (12 variants at every warmth) are not the cause.

## Correctness Properties

Property 1: Bug Condition - Playtest findings are fixed

_For any_ input where the bug condition holds (isBugCondition returns true), the fixed code SHALL: (a) pass the buffer-reversal test with a fake context that keeps its sample arrays; (b) show every sound caption in exactly one pair of brackets and show the voice caption `[Dad's voice, over the static]` once; (c) answer HINT in a solved room with the solved-state hint and leave the stored tier unchanged; (d) list in-reach items of the current room before carried items in noun-failure suggestions; (e) put a found key in the inventory in the same turn so the matching exit opens without TAKE; (f) parse each phrase in NaturalPhrasings to its canonical command or, for "i need a hint", to an unknown-verb line; (g) print "static clears all at once" once in the third-adjustment turn; (h) show a Study forward-play narration of at most three sentences that does not restate its caption; (i) carry state between fuzz commands so no single response reaches the reporting threshold.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9**

Property 2: Preservation - Behavior outside the defects is unchanged

_For any_ input where the bug condition does NOT hold (isBugCondition returns false), the fixed code SHALL produce the same result as the original code, preserving the walkthrough, the ungated basement and hallway keys, every existing parse, tiered hints in unsolved rooms, the noun-failure wording, caption display when audio is off, the narrator rules and engine determinism.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Assuming the root causes above are correct. Game code stays untouched until the exploration tests exist and fail (task 1).

**File**: `src/audio/voice.test.ts` (C1, test change only)

**Function**: `fakeContext`

**Specific Changes**:
1. Allocate each buffer's `Float32Array` once inside `createBuffer` and return it from every `getChannelData` call.
2. Do the same for `decodeAudioData` so one decoded buffer returns one array.
3. Leave `src/audio/audio.ts` unchanged. Re-run the test to confirm the engine writes `[0.4, 0.3, 0.2, 0.1]`.

**File**: `src/ui/session.ts` (C2)

**Function**: `linesFor`

**Specific Changes**:
1. Add a small pure helper that removes one leading `[` and one trailing `]` from a caption and wraps it once. Use it for SOUND lines.
2. Leave the engine's caption strings alone (about 30 strings, all already bracketed). `src/engine/index.ts` already strips before wrapping, so the two paths agree.
3. `withVoiceCaptions` keeps its tolerant comparison, so its existing test stays valid.

**Files**: `src/engine/hints.ts`, `src/engine/messages.ts`, `src/engine/content/schema.ts`, `src/engine/content/types.ts`, `content/hints.json` (C3)

**Specific Changes**:
1. Add a required `solved` string to each puzzle's hint entry in the schema, the `HintDef` type and `content/hints.json`. The loader test that checks hint shape is updated to match.
2. Add a map from puzzle id to its solved flag (the five flags in the Glossary) in one place the engine owns.
3. In `hint`, when the current puzzle's flag is set, emit `hint_lead` and `hint:<puzzle>:solved`, and do not change `hintTier`. The `outside` room keeps falling back to the grandparents' puzzle, as today.
4. In `describeMessage`, resolve `hint:<puzzle>:solved` to the new text.
5. Hint wording (for the narrator-writer to polish, no puzzle solution revealed, no mention of where the key is because the player may have dropped it): basement "This room has given you what it had. The way on is up the stairs."; hallway "The jacket gave up its secret. The way on is north."; boyhood bedroom "The trailer is empty now. The way on is east."; study "The disk box is done. The way on is north."; grandparents' bedroom "The clock radio has done its job. There is a front door past the foot of the bed."
6. Hint text for later rooms follows the warmth ladder through `hint_lead`. The hint lines themselves stay plain and sincere.

**File**: `src/engine/parser/interpret.ts`, callers in `src/ui/session.ts` and `src/engine/index.ts` (C4)

**Specific Changes**:
1. Add an optional `roomItems` option (the current room's item list from `content.rooms`). `scopedNames` takes items from `roomItems` first (in reach, not hidden inside a container), then fills up to three from the remaining reachable items.
2. Both callers pass `content.rooms[state.room].items`. If the option is missing the old order is used, so existing parser tests stay valid.
3. Keep the four noun-failure wordings and the "Try EXAMINE with ..." ending (3.6).

**Files**: `src/engine/puzzles/util.ts` and the five puzzle modules' `afterStep`, `src/engine/world.ts`, `src/engine/parser/interpret.ts` (C5)

**Specific Changes**:
1. Add a shared helper that moves a revealed key from the room to the inventory and returns `ITEM_TAKEN` and the existing `taken:<key>` message.
2. Call it in each `afterStep` at the one-time `keyFound` branch (the flags `atariBoxSearched`, `jacketSearched`, `compartmentSearched`, `diskBoxOpened`, `clockRadioOpened`). Order of events: the existing found text, then the taken line, then `PUZZLE_SOLVED`.
3. Keep the per-room `take` handlers so a dropped key can still be picked up.
4. In `world.ts` `take` and in `interpret.ts` `resolveSlot` for TAKE, when every candidate item is already carried, answer `already_held` instead of the which-do-you-mean question. The canonical `take key` lines in the walkthrough then answer harmlessly.
5. Do not edit `content/walkthrough.json`. It must pass unchanged. A new test covers the no-TAKE path.

**Files**: `src/engine/parser/parser.ts`, `content/verbs.json` (C6)

**Specific Changes**:
1. Particle after the object: if the last token is a particle and `<first token> <particle>` is a known verb phrase, move the particle next to the verb. This reuses the existing "trailing manner word" idea and covers "turn X on", "switch X on", "pick X up", "plug X in", "put X down", "take X out" (add the verb phrase `take out` to REMOVE).
2. Trailing particle on a noun phrase: otherwise drop a trailing particle (up, in, on, out, over, around, back) from the noun phrase, only when something else remains. Covers "flip the record over". The leading particle in "open up the toybox" is handled by a synonym instead (next item), so "go up" is not affected.
3. Articles inside verb phrases: match verb phrases while skipping "the", "a", "an", so "fix the tracking" reaches ADJUST (synonym "fix tracking") and "take a look at" reaches EXAMINE. Noun phrases keep their articles, so "etch a sketch" still resolves.
4. New synonyms in `verbs.json`, each unique across verbs: INSERT gets "put", "place", "slide" and the preposition "inside". PLAY gets "listen to". SEARCH gets "look in". FIND gets "look for". EXAMINE gets "take a look at". REMOVE gets "take out". OPEN gets "open up". UNLOCK and OPEN take a second object with the prepositions "with" and "using" (the key is accepted and ignored by the door logic).
5. Single-letter abbreviations "i" and "l" are accepted only on their own, so "i need a hint" becomes an unknown verb. The unknown-verb bank answers it.
6. Out of scope: pronouns ("plug it in"), "take X out of Y", "put the key in the door" (it parses to INSERT and gets the in-character can't-do line), "leave" and "exit", "wait", "where am i", "talk to dad", "ask for a hint". They keep their in-character unknown-verb response.

**File**: `src/engine/puzzles/grandparentsBedroom.ts` (C7)

**Specific Changes**:
1. Change `adjust_clear_prefix` to "One last nudge." and leave the video text, `VIDEO_FINAL_LINE`, the silence beat and the clock gag order untouched. The video opens "The static clears all at once." once.
2. Add a turn-level check (in tests) that no sentence of four or more words appears twice in a turn, run over the walkthrough and the wrong-order variants.

**File**: `src/engine/puzzles/study.ts` (C8)

**Specific Changes**:
1. Rewrite `study:forward` to three sentences or fewer that do not restate the caption, and keep the word "cat" (the existing test checks it). Proposed text: "You lower the needle, and the speakers answer with warped nonsense, like a cat walking across a keyboard. It is not English. Not yet."
2. Rewrite `study:forward_again` the same way, for example "The needle drops again. Same nonsense. The cat found the keyboard again."
3. Leave the caption string, the sound cue, the `voice.ts` mapping and every reversed-record line unchanged.

**File**: `tools/playtest-mcp/server.ts` (C9)

**Function**: the `fuzz_commands` loop

**Specific Changes**:
1. Replace the reused `base` with a `state` variable that takes `r.state` after each command. When `eng.isEnded(state)`, restart from `eng.createInitialState()` so the ending does not produce empty replies.
2. Do not edit `engineAdapter.ts`, and do not change what `runInput` returns, so results are not faked.
3. This is a change to the test tool, not game code. The long-running MCP server must be restarted from the Kiro MCP panel to load it.
4. Because the MCP rule says to treat `repetitiveResponses` as a bug in the narration banks, record in the task notes that the evidence points to the harness: the banks have 12 variants at every warmth and the threaded rerun drops the maximum to 15.

**Other notes**
- Do not edit `video_adult_dad_final`, `content/voice-lines.json` or `public/audio/voice/index.json`.
- Observation, not in scope: some fixed single-line responses (`no_exit`, `not_here`, `need_object`, the two empty-input lines) have fewer than the 8 variants the narrator rules ask for. They were the top repeats once state was threaded (15 and 13 of 300), below the tool's threshold of 30. Raise them separately if wanted.
- `docs/writeup.md` says none of the code-side findings are fixed. Update that paragraph when the tasks are done.

## Testing Strategy

### Validation Approach

First write tests that fail on the unfixed code and show each defect. Then apply the fixes one at a time and re-run the same tests. Preservation tests are written and run on the unfixed code before any change, so they record real behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples for C1 to C9 before changing any game code, and confirm or correct the root causes above.

**Test Plan**: Add `tests/playtest-findings.test.ts` (Vitest and fast-check) with one block per defect. Run it on the unfixed code and record the counterexamples. The two voice tests already fail and serve as the C1 and C2 exploration tests.

**Test Cases**:
1. **Fake buffer (C1)**: the existing voice test (fails now with `[0, 0, 0, 0]`).
2. **Caption brackets (C2)**: the existing voice test, plus a new check that no UI line starts with `[[` (will fail on unfixed code).
3. **Solved hint (C3)**: for each of the five puzzles, play to the solved flag, send HINT, expect a solved-state message and no tier message (will fail).
4. **Suggestions (C4)**: carry the pencil and Walkman into the hallway, send an unknown noun, expect only hallway items in the suggestion (will fail).
5. **Key to inventory (C5)**: after each key-reveal command, expect the key in the inventory and the matching exit to open without TAKE (will fail).
6. **Phrasings (C6)**: parse every phrase in the NaturalPhrasings table and compare it with its canonical command (will fail for most rows).
7. **Duplicates (C7, C8)**: play the walkthrough and assert that no sentence of four or more words repeats within a turn, and that the Study forward text is at most three sentences with no word shared with its caption beyond common words (C7 will fail; C8 may fail, and a pass means the assumed complaint was wrong).
8. **Fuzz variety (C9)**: run the same 300-command fuzz loop in-process with seeds 1986, 7 and 42, once from a fixed state and once threaded, and assert no response reaches 30 repeats. The fixed-state run fails (73, 78, 80), the threaded run passes.

**Expected Counterexamples**:
- `[0, 0, 0, 0]` instead of the reversed ramp.
- `[[Dad's voice, over the static]]` and a missing single-bracket caption.
- Tier 1 text in a solved room.
- "pencil, walkman, or phone table" in the hallway.
- The hallway key on the floor after `search foam`.
- `unknown_verb` for "pick the pencil up" and a noun lookup of "turntable in".
- "static clears all at once" twice in one turn.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code gives the expected behavior.

**Pseudocode:**
```
FUNCTION expectedBehavior(result, X)
  RETURN (C1(X)  IMPLIES result.reversedBuffer = [0.4, 0.3, 0.2, 0.1])
     AND (C2(X)  IMPLIES result.captionLines contain no "[[" AND contain "[Dad's voice, over the static]" once)
     AND (C3(X)  IMPLIES result.messages contain "hint:<puzzle>:solved" AND NOT any "hint:<puzzle>:<1..3>"
                         AND result.state.hintTier = X.state.hintTier)
     AND (C4(X)  IMPLIES result.suggestions begin with in-reach items of the current room)
     AND (C5(X)  IMPLIES result.state.inventory contains the key AND exit opens without TAKE)
     AND (C6(X)  IMPLIES parse(X.text) = parse(canonical(X.text)) OR (X.text = "i need a hint" AND result is unknown_verb))
     AND (C7(X)  IMPLIES count("static clears all at once" in result.text) = 1)
     AND (C8(X)  IMPLIES sentences(result.narration) <= 3 AND NOT restates(result.narration, result.caption))
     AND (C9(X)  IMPLIES max response count < 30 for seeds 1986, 7, 42)
END FUNCTION

FOR ALL X WHERE isBugCondition(X) DO
  result := fixedCode(X)
  ASSERT expectedBehavior(result, X)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code gives the same result as the original code.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT originalCode(X) = fixedCode(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because it generates many command sequences, catches edge cases that hand-written examples miss, and gives strong evidence that nothing else moved.

**Test Plan**: On the unfixed code, record the observed result of each non-bug input, write the tests, and confirm they pass. Re-run them after the fix.

**Test Cases**:
1. **Walkthrough and soft-locks**: `tests/walkthrough.test.ts`, `tests/softlock.test.ts` and `tests/properties.test.ts` pass unchanged, and `run_walkthrough` passes.
2. **Ungated keys pinned**: `search cartridge box`, `search foam` finds the key with no tape played, and the same for the hallway closet and inside pocket. Toybox, disk box and cover stay shut before their clues.
3. **Parse snapshot**: for every verb synonym in `verbs.json` with every noun alias in a small set, and for every walkthrough command, the parsed command is identical before and after.
4. **Tiered hints**: in each unsolved room, HINT gives tiers 1, 2, 3, 3 and updates `hintTier` as before.
5. **Noun-failure wording**: the line still begins with one of four wordings and ends with "Try EXAMINE with ..." or "Try LOOK.".
6. **Audio**: muted, missing-file and decode-failure cases still show captions and never throw. Only the forward step is reversed.
7. **Determinism and purity**: the same state and command give the same result, and the input state is not mutated.

### Unit Tests

- `session.ts` caption helper: bracketed, unbracketed and empty captions.
- `hint` with each solved flag and with none, and `describeMessage` for `hint:<puzzle>:solved`.
- Loader: a hint entry missing `solved` fails validation.
- `scopedNames` ordering with and without `roomItems`.
- Key collection helper: moves the key once, does nothing when already carried.
- Parser: each row of NaturalPhrasings, the particle move, the trailing particle drop, the article skip, and "i" alone versus "i need a hint".
- Study forward text: sentence count, contains "cat", does not repeat caption words.

### Property-Based Tests

- Random command sequences from the soft-lock candidate set: a reveal of any key leaves the key in the inventory, and no sequence leaves the game unwinnable.
- Random verb, noun and particle combinations: parsing never throws, and a command that parsed before still parses the same.
- Random sequences followed by HINT: solved rooms never show tier text, unsolved rooms always do, and `hintTier` never decreases.
- Threaded fuzz with seeds drawn at random: no response reaches 30 repeats in 300 commands.

### Integration Tests

- Play the canonical walkthrough through `takeTurn` with the voice index loaded and the audio muted. Check one pair of brackets on every caption, the single voice caption for adult Dad, and the single "static clears all at once".
- Play the walkthrough with the `take key` lines removed and confirm it still reaches the ending.
- Re-run `run_walkthrough` and `find_softlocks` after the changes. If `find_softlocks` reports `truncated: true`, say so in the result, because that is not a proof.
- After restarting the MCP server, re-run `fuzz_commands` with the default seed and 300 commands and record the new `repetitiveResponses`.
