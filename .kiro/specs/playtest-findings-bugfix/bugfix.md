# Bugfix Requirements Document

## Introduction

A playtester agent and a full test run found a group of defects in "Outdated: A Text Adventure". The project is not under git, so the state before the most recent content change is unknown. Every finding below was reproduced against the current code with the full Vitest suite (314 pass, 2 fail), the playtest MCP tools, and throwaway scripts that have been deleted. No game code has been changed.

Findings, in the order the request listed them:

- **Two failing voice tests.** One test is wrong and one piece of code is wrong. The buffer-contents test fails because its fake audio context hands out a fresh array on every channel read, so reversed samples are never read back. The game code is correct there. The caption test fails because every sound caption is shown inside two pairs of brackets, which hides the voice index caption. The tests do not read the narration bank, so the narrator-writer's content change did not cause either failure.
- **Stale hint.** After a puzzle is solved, HINT still gives that puzzle's tier text. The basement is the reported case. All five rooms behave the same way.
- **Wrong nouns in suggestions.** Noun-failure suggestions list the first three reachable items in global content order. Items carried from earlier rooms (pencil, Walkman) crowd out the current room's own items.
- **Keys found before the clue scene (not a defect).** The basement and hallway keys can be found before the clue scene. This is intended. Requirements 3.4 and 4.5 state the key rewards without a precondition, and `docs/puzzle-bible.md` gates only the optional basement battery. Only the bedroom (5.3), study (6.4) and grandparents' bedroom (7.5) are gated. This behavior is recorded under Unchanged Behavior and is not changed.
- **Separate TAKE for found keys (defect).** Requirement 2.3 says finding a key adds it to the inventory, and 3.4, 4.5 and 5.5 say the system gives the key to the player. The current game leaves the key on the floor and requires a second command.
- **Natural phrasings that fail to parse.** Examples: "pick the pencil up", "put the cassette in the walkman", "turn the NES on", "listen to the record".
- **Repeated text.** "Static clears all at once" appears twice in one turn. The Study forward-play text restates its own caption and runs past the three-sentence limit. The playtester's exact complaint about the Study line was not recorded, so this reading is an assumption.
- **Fuzz repeats (32 and 73 times in 300 commands).** The narration banks have 12 variants each. The fuzz tool reuses the same starting state for every command, so the variant counter never advances and the first variant is always chosen. This reproduces exactly (73 and 32 with seed 1986) and disappears when state is carried forward.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the voice test "reverses the buffer for the forward step only" runs THEN the system fails it with `[0, 0, 0, 0]` instead of the reversed samples, because the test's fake audio context returns a new zero-filled array each time a buffer's samples are read. The game's reversal is correct and the test fixture is wrong.

1.2 WHEN a sound is played THEN the system shows its caption inside two pairs of brackets (for example `[[Dad's voice, over the static]]`), and the matching voice caption `[Dad's voice, over the static]` is dropped as a duplicate, so the voice test "shows the index captions when only the audio files are missing, even muted" fails.

1.3 WHEN the player types HINT in a room whose puzzle is already solved THEN the system gives the first, second or third tier for that puzzle (for example "That tape is not going to fix itself." in the basement after the key is found).

1.4 WHEN the player names something that is not within reach THEN the system suggests the first three reachable items in global content order, which are the carried items from earlier rooms (for example "Try EXAMINE with pencil, walkman, or phone table" in the hallway) instead of items in the current room.

1.5 WHEN the player finds a key (hallway key, bedroom key, study key, grandparents' key, front door key) THEN the system leaves it on the floor, the exit stays locked, and the player must type a second TAKE command before the door will open.

1.6 WHEN the player uses a natural phrasing, such as a particle after the object ("pick the pencil up", "turn the NES on", "switch the NES on", "plug the turntable in", "take the tape out", "flip the record over", "open up the toybox"), a "put" or "slide" phrasing ("put the cassette in the walkman", "slide the tape into the VCR"), "listen to the record", "fix the tracking", "look in the closet", "look for the cord", "take a look at the pager", "unlock the door with the key", or "i need a hint" THEN the system rejects the verb as unknown, leaves a particle stuck to the noun so the noun is not found, or runs a different command (INVENTORY, LOOK, REWIND or TAKE).

1.7 WHEN the player makes the third tracking adjustment on the VCR THEN the system prints "static clears all at once" twice in the same turn, once in the adjustment line and again as the first line of the video.

1.8 WHEN the player plays the record forward in the Study THEN the system shows a sound caption and then narration that describes the same garbled, warbling sound, and the narration is four sentences long against a three-sentence limit for routine responses.

1.9 WHEN the fuzz tool runs 300 commands from a fresh game THEN the system reuses the starting state for every command, never advances the variant counter, and reports two single lines repeated 73 and 32 times as if the narration banks were too small.

### Expected Behavior (Correct)

2.1 WHEN the voice test "reverses the buffer for the forward step only" runs THEN the system SHALL pass it, using a fake audio context that returns the same sample array for the same buffer each time, as a real audio buffer does. The game's audio code SHALL stay unchanged.

2.2 WHEN a sound is played THEN the system SHALL show its caption inside exactly one pair of brackets, and the voice caption `[Dad's voice, over the static]` SHALL appear once in the turn output, in both the muted and the missing-audio-files cases.

2.3 WHEN the player types HINT in a room whose puzzle is solved THEN the system SHALL give a solved-state hint that says the room is done and points to the way on (for example the exit direction), without showing tier text for the solved puzzle and without changing the stored hint tier.

2.4 WHEN the player names something that is not within reach THEN the system SHALL suggest up to three items that are in the current room and in reach first, and SHALL list carried items only to fill any remaining places.

2.5 WHEN the player finds a key THEN the system SHALL put the key in the inventory in the same turn, say so in character, and let the player pass the matching exit without any further TAKE.

2.6 WHEN the player uses one of the natural phrasings in 1.6 THEN the system SHALL parse it to the same command as the equivalent canonical phrasing ("pick up the pencil", "insert the cassette into the walkman", "turn on the NES", "play the record", "adjust tracking", "search the closet", "find the cord", "examine the pager", "unlock the door"), and SHALL answer "i need a hint" and anything else it still cannot parse with an in-character unknown-verb line instead of running a different command.

2.7 WHEN the player makes the third tracking adjustment on the VCR THEN the system SHALL show "static clears all at once" once in the turn, and no sentence of four or more words SHALL appear twice in any single turn of the walkthrough.

2.8 WHEN the player plays the record forward in the Study THEN the system SHALL show narration of at most three sentences that does not restate its caption, and the "cat on a keyboard" joke SHALL stay in the first-play line.

2.9 WHEN the fuzz tool runs 300 commands THEN the system SHALL carry the game state forward between commands (starting again from a fresh game if the ending is reached), so the variant counter advances, and no single response SHALL repeat at or above the tool's reporting threshold for seeds 1986, 7 and 42.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the canonical walkthrough in `content/walkthrough.json` is played from the start THEN the system SHALL CONTINUE TO reach the ending with warmth 4 and the pencil in the inventory, and the soft-lock search and property tests SHALL CONTINUE TO pass without a soft-lock.

3.2 WHEN the player searches the cartridge box and the foam, or opens the closet and searches the inside pocket, before hearing the clue scene THEN the system SHALL CONTINUE TO give the basement key and the hallway key, and the bedroom toybox, the study disk box and the clock radio cover SHALL CONTINUE TO stay shut until their clue scenes have happened.

3.3 WHEN the player types TAKE for a key they already hold, drops a key and takes it again, or uses a key on a door THEN the system SHALL CONTINUE TO answer in character, consume no item, and keep the pencil permanent; the existing canonical `take key` lines SHALL answer "already carrying that" instead of asking which key is meant.

3.4 WHEN the player uses any phrasing that parses today (every synonym in `content/verbs.json`, every walkthrough command, every command the soft-lock search uses) THEN the system SHALL CONTINUE TO parse it to the same command, and an unknown verb SHALL CONTINUE TO get an in-character, warmth-matched line from a bank of at least 8 variants.

3.5 WHEN the player types HINT in a room whose puzzle is not yet solved THEN the system SHALL CONTINUE TO advance through three tiers and then repeat tier 3, tracked per puzzle, with the narrator's lead-in line matching the current warmth.

3.6 WHEN a noun is not within reach THEN the system SHALL CONTINUE TO answer with an in-character line that starts one of the existing four wordings and ends with a "Try EXAMINE with ..." suggestion built only from items the player can reach, or "Try LOOK." when nothing is reachable.

3.7 WHEN a voice line is muted, fails to load, or fails to decode THEN the system SHALL CONTINUE TO show its caption and keep playing, only the forward step of the record SHALL CONTINUE TO be reversed, and `video_adult_dad_final`, the adult Dad's final line and its text SHALL CONTINUE TO be untouched.

3.8 WHEN the player reaches the silence beats, the VCR clock gag, the video, the warmth steps and the ending THEN the system SHALL CONTINUE TO follow the narrator rules: the clock gag comes before the video, the narrator never mocks Dad, no lyrics or real names appear, and nothing follows the pencil.

3.9 WHEN the player watches the video THEN the system SHALL CONTINUE TO show every paragraph of the video text in the same order, ending with adult Dad's line and the silence beat, and the replay text SHALL CONTINUE TO be unchanged.

3.10 WHEN the engine runs the same state and command twice THEN the system SHALL CONTINUE TO give the same result without changing its input state.
