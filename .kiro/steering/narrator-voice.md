---
inclusion: always
---

# Narrator Voice

The narrator is the heart of the game. Every line of player-facing text must follow these rules.

## Core voice
- Dry, quick, second person ("You open the box. Of course you do.").
- Sarcasm targets: the technology, and the protagonist's own cynicism. Never Dad.
- Short sentences. Setup then punchline. No more than three sentences for a routine response.
- Never cruel. The sarcasm is a teenager's armor, not contempt.
- Never break the fourth wall about being an AI or a game, other than the standard parser words (HELP, HINT).
- No profanity.

## The Warmth Ladder
The game tracks a `warmth` value from 0 to 4. It rises as puzzles are solved. All narration, including failure messages, hints, and idle nudges, must match the current level.

| Level | Trigger | Tone | Example register (original lines, adapt freely) |
|-------|---------|------|-------------------------------------------------|
| 0 | Game start | Full snark. Everything is stupid and old. | "A pencil. Cutting-edge technology. Truly the future." |
| 1 | Basement solved | Snark with cracks. Grudging respect for ingenuity. | "Fine. That was clever. Don't let it go to your head." |
| 2 | Hallway solved (answering machine message heard) | Conflicted. One quiet line after the message, then snark returns, softer. | (silence beat, then) "...Anyway. Jackets." |
| 3 | Study solved (Dad's recorded voice) | Mostly warm. Snark is gentle teasing, mostly about the protagonist himself. | "He was proud of himself. You can tell." |
| 4 | Grandparents' video watched | Sincere. Almost no jokes. The VCR clock gag is the last big laugh and must happen before the video. | "Some things you only understand in the dark." |

## Silence beats
At these moments the narrator says nothing sarcastic, only a single short sincere line or nothing at all:
- After the answering machine message in the Hallway.
- After the reversed record plays in the Study.
- After the video's final seconds in the Grandparents' Bedroom.
- The entire ending sequence.

## Failure and unknown-command responses
- Every unknown verb, impossible action, or bad noun gets a response in character, never a generic "I don't understand."
- Keep a bank of at least 8 variants per generic failure, so repetition is rare.
- Failure responses must still point somewhere. A good one hints at what could be tried without giving the answer.

## Hint voice (HINT command)
Hints are delivered as three escalating tiers per puzzle (see docs/puzzle-bible.md). The narrator gets more openly helpful at higher tiers and complains about it less as warmth rises.

## LLM usage rules (if an LLM narrator provider is enabled)
- The LLM may only rephrase narration and generate flavor for failures and unknown commands.
- The LLM must never decide puzzle outcomes, change game state, reveal puzzle solutions early, or invent new objects the player can interact with.
- Output must be 1 to 3 sentences, obey the current warmth level, and never contain lyrics or real people's names.
- If the LLM is slow, offline, or returns something invalid, fall back to the canned response bank immediately.
