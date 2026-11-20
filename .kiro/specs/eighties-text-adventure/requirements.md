# Requirements Document

## Introduction

A browser-based, text-only adventure game in the style of Infocom. A 16-year-old protagonist wakes in a dream version of his late father's 1980s childhood home and must solve five puzzles, each using an 80s gadget to deliver a clue and ending with a key hidden in an 80s toy or object. A sarcastic narrator softens over the course of the game. The game ends with the protagonist waking up and finding a pencil from the first puzzle in his pocket.

Full content for all rooms, items, clues, decoys, and hints is in the puzzle bible:

#[[file:docs/puzzle-bible.md]]

## Requirements

### Requirement 1: Command parser

**User Story:** As a player, I want to type natural commands, so that I can interact with the world without learning a strict syntax.

#### Acceptance Criteria

1. WHEN the player enters a command THEN the system SHALL parse it into a verb, an optional direct object, and an optional indirect object (for example, "rewind tape with pencil").
2. WHEN the player uses a listed synonym for a verb or noun THEN the system SHALL treat it as the canonical verb or noun.
3. WHEN the player enters an unknown verb or noun THEN the system SHALL respond with an in-character message that suggests what could be tried, never a generic error.
4. WHEN the player enters ambiguous input THEN the system SHALL ask one short clarifying question.
5. WHEN the player enters LOOK, EXAMINE, TAKE, DROP, INVENTORY, OPEN, SEARCH, USE, GO, HELP, or HINT THEN the system SHALL support them in every room.

### Requirement 2: World model and progression

**User Story:** As a player, I want to move through connected rooms as I earn keys, so that progress feels earned.

#### Acceptance Criteria

1. WHEN the game starts THEN the system SHALL place the player in the Basement.
2. WHEN the player tries to leave a room through a locked door without the matching key THEN the system SHALL refuse in character and hint that a key is needed.
3. WHEN the player finds a key THEN the system SHALL add it to the inventory with a distinct name and description.
4. WHEN the player uses the correct key on the correct door THEN the system SHALL unlock it, consume no other items, and allow travel.
5. WHEN the player returns to a previous room THEN the system SHALL keep that room's state unchanged.
6. The system SHALL contain exactly five rooms plus the front door exit, in this order: Basement, Hallway, Dad's Boyhood Bedroom, Study, Grandparents' Bedroom.

### Requirement 3: Basement puzzle (tape, pencil, Atari box)

**User Story:** As a player, I want the opening puzzle to teach me how the game works, so that I am ready for harder puzzles.

#### Acceptance Criteria

1. WHEN the player examines the cassette THEN the system SHALL show that the tape is pulled out and tangled.
2. WHEN the player uses the pencil on the cassette THEN the system SHALL rewind the tape and remember that it is rewound.
3. WHEN the player loads the rewound cassette into the Walkman and plays it THEN the system SHALL deliver Dad's recorded clue about checking under things.
4. WHEN the player searches under the foam insert in the Atari cartridge box THEN the system SHALL give the player the hallway key.
5. The pencil SHALL NOT be consumed by any action.
6. IF the player tries to play an unrewound tape THEN the system SHALL respond in character and point toward the pencil.

### Requirement 4: Hallway puzzle (pager, rotary phone, answering machine, jacket)

**User Story:** As a player, I want to deduce a location from a message, so that I feel clever.

#### Acceptance Criteria

1. WHEN the player examines the pager THEN the system SHALL display a seven-digit number.
2. WHEN the player dials that number on the rotary phone THEN the system SHALL play the answering machine message from young Dad.
3. WHEN the player dials any other number THEN the system SHALL respond with a distinct in-character result (busy signal, wrong number, or old greeting).
4. WHEN the message finishes THEN the system SHALL apply a narrator silence beat before any sarcasm resumes.
5. WHEN the player searches the closet jacket's inside zip pocket THEN the system SHALL give the player the bedroom key.
6. IF the player searches the jacket's outer pocket THEN the system SHALL give them an emergency quarter (decoy) and not the key.

### Requirement 5: Bedroom puzzle (NES, cartridge blowing, toybox, Optimus trailer)

**User Story:** As a player, I want to use a well-known 80s habit as a puzzle verb, so that the solution feels authentically period.

#### Acceptance Criteria

1. WHEN the player inserts the cartridge and powers on the NES the first time THEN the system SHALL show a flickering, failed boot.
2. WHEN the player blows on the cartridge and reinserts it THEN the system SHALL boot to a title card with an ASCII art homage and the words "THE TOUCH", without reproducing any song lyrics.
3. WHEN the title card has been seen THEN the system SHALL allow the player to open the toybox and search its contents.
4. WHEN the player searches each decoy toy THEN the system SHALL give a unique in-character response and no key.
5. WHEN the player unfolds the Optimus-style trailer and searches its compartment THEN the system SHALL give the player the study key.

### Requirement 6: Study puzzle (record backmasking, disk box)

**User Story:** As a player, I want to try something deliberately "wrong" to progress, so that the game rewards curiosity.

#### Acceptance Criteria

1. IF the turntable is unplugged THEN the system SHALL require the player to find and plug in the cord before the record can play.
2. WHEN the player plays the record forward THEN the system SHALL present unintelligible audio and a narrator quip.
3. WHEN the player turns the record counterclockwise, spins it backward, or reverses it THEN the system SHALL play a reversed message from young Dad and apply a silence beat.
4. WHEN the reversed message has played THEN the system SHALL allow the player to open the floppy disk box and take the key from the lid.
5. The system SHALL NOT permit the turntable to become permanently unusable.

### Requirement 7: Grandparents' bedroom puzzle and ending

**User Story:** As a player, I want the final room to deliver the emotional payoff and a clean ending.

#### Acceptance Criteria

1. WHEN the player opens the aerobics tape case THEN the system SHALL reveal a handwritten-label tape.
2. WHEN the player inserts the tape and adjusts tracking THEN the system SHALL play the home video with static that clears as tracking improves.
3. WHEN the player sets the VCR clock THEN the system SHALL respond with the final big joke, and it SHALL NOT be required to progress.
4. WHEN the video ends THEN the system SHALL apply the final silence beat and mark warmth level 4.
5. WHEN the player removes the clock radio's battery cover after seeing the video THEN the system SHALL give the front door key.
6. WHEN the player unlocks the front door THEN the system SHALL trigger the ending: alarm sound, black screen, a wake-up scene, and the pencil in the pocket as the final image, with nothing after it.

### Requirement 8: Narrator and warmth ladder

**User Story:** As a player, I want the narrator's attitude to change as I progress, so that the story has an emotional arc.

#### Acceptance Criteria

1. The system SHALL track a warmth value from 0 to 4 and raise it as defined in narrator-voice.md.
2. WHEN generating any narration THEN the system SHALL respect the current warmth level.
3. WHERE an LLM narrator is enabled THEN the system SHALL restrict it to rephrasing and flavor text and SHALL NOT let it affect game state.
4. IF the LLM is unavailable, slow, or returns invalid output THEN the system SHALL fall back to canned text without visible delay or error.
5. The system SHALL NOT reproduce song lyrics or name real people in any narration or content.

### Requirement 9: Hints and no soft-locks

**User Story:** As a player, I want help when I'm stuck, so that the game never feels unfair.

#### Acceptance Criteria

1. WHEN the player types HINT THEN the system SHALL give the next tier of hint (1 to 3) for the current puzzle, in the narrator's current voice.
2. WHEN the player is idle or repeating failed commands for a defined number of turns THEN the system SHALL offer a gentle nudge.
3. The system SHALL guarantee that no sequence of valid commands makes the game unwinnable.
4. WHEN a puzzle object has been used in the wrong order THEN the system SHALL either recover gracefully or reset the object's state, and SHALL say so in character.

### Requirement 10: Presentation and audio

**User Story:** As a player, I want the game to feel like it belongs in the 80s, so that the world is immersive.

#### Acceptance Criteria

1. The system SHALL present a CRT-style green or amber terminal with scanlines and a blinking cursor.
2. WHERE audio is enabled THEN the system SHALL play synthesized rotary clicks, ring, answering-machine beep, tape hiss, VCR whirr, static, and an alarm tied to the matching events.
3. The system SHALL show a text caption for every sound.
4. The system SHALL provide a mute toggle and a reduce-effects toggle that disables flicker, flashing, and shake.
5. The system SHALL be fully playable with the keyboard alone.

### Requirement 11: Automated verification

**User Story:** As the developer, I want automated proof that the game is finishable, so that I can change content safely.

#### Acceptance Criteria

1. The system SHALL include a walkthrough test that plays the full game from start to ending using only canonical commands.
2. The system SHALL include a soft-lock test that explores reachable states and fails if any state cannot reach the ending.
3. WHEN content files in `content/` or `docs/puzzle-bible.md` change THEN the walkthrough and soft-lock tests SHALL be run before the change is considered done.

### Requirement 12: Playtest tooling (MCP)

**User Story:** As the developer, I want Kiro to play and stress-test the game directly, so that dead ends and weak responses are found before players find them.

#### Acceptance Criteria

1. The project SHALL include an MCP server at `tools/playtest-mcp` exposing `new_game`, `send_command`, `get_state`, `list_vocabulary`, `run_walkthrough`, `find_softlocks`, and `fuzz_commands`.
2. WHEN `send_command` is called THEN the server SHALL return the narration, the events emitted, whether the input was recognized, and which room, items, flags, and warmth changed.
3. WHEN `run_walkthrough` is called THEN the server SHALL play `content/walkthrough.json` and report pass or fail per puzzle plus the final-state checks (ended, warmth 4, pencil in inventory).
4. WHEN `find_softlocks` is called THEN the server SHALL explore reachable states and report any state from which the ending is unreachable, with the commands that reach it.
5. IF exploration is truncated by the state limit THEN the server SHALL state that the result is not a proof.
6. WHEN `fuzz_commands` is called THEN the server SHALL report crashes, empty responses, leaked internals, and overused fallback responses, and SHALL be reproducible from a seed.
7. The server SHALL access the game only through the adapter in `tools/playtest-mcp/engineAdapter.ts`, and SHALL NOT write to standard output other than MCP protocol messages.

### Requirement 13: Voice asset generation (MCP)

**User Story:** As the developer, I want spoken lines generated from a single manifest, so that audio stays in sync with the script and is easy to revise.

#### Acceptance Criteria

1. The project SHALL include an MCP server at `tools/tts-mcp` exposing `list_voices`, `synthesize_line`, and `synthesize_manifest`.
2. WHEN `synthesize_manifest` is called THEN the server SHALL generate audio for each line in `content/voice-lines.json`, skip lines whose text and voice are unchanged, and write `public/audio/voice/index.json`.
3. The server SHALL use only stock synthetic voices and SHALL NOT clone or imitate any real person's voice.
4. Every manifest line SHALL have a caption, and the game SHALL show that caption whenever the line plays.
5. WHERE `TTS_DRY_RUN` is set to 1 THEN the server SHALL plan without calling the speech service or writing files.
6. The game SHALL remain fully playable if no voice audio files exist, falling back to captions alone.
7. The game SHALL apply each line's `effect` (answering machine, tape, camcorder, reversible record) at runtime and SHALL NOT require effects to be baked into the audio files.

### Requirement 14: Property-based testing

**User Story:** As the developer, I want invariants checked against many random play sessions, so that bugs hidden between hand-written test cases are found.

#### Acceptance Criteria

1. The project SHALL include `tests/properties.test.ts` using fast-check and Vitest.
2. The tests SHALL generate random sequences of valid-ish commands and assert determinism, purity (no mutation of input state), that the pencil is never removed once taken, that warmth never decreases, that no reachable state provably cannot reach the ending, and that any input yields a non-empty response without throwing or leaking internals.
3. WHEN a property fails THEN the test output SHALL include the fast-check seed and a minimal failing command list so the failure can be replayed.
4. The property tests SHALL run as part of the verification hook and before task 14 is marked complete.
