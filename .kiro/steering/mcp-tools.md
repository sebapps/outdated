---
inclusion: always
---

# MCP Tools Available in This Project

These tools exist to help BUILD and VERIFY the game. They are never part of the shipped game.

## playtest (tools/playtest-mcp)
Lets you play and stress-test the game engine.
- Use `new_game` and `send_command` to play through a puzzle after implementing it, and report what the narration says, not what you expect it to say.
- Run `run_walkthrough` after every puzzle task (spec tasks 5 to 9) and after any change to content files.
- Run `find_softlocks` before marking task 14 complete. If `truncated` is true, say so; it is not a proof.
- Run `fuzz_commands` after changing the parser or narration banks. Treat `repetitiveResponses` as a bug in the narration banks.
- If a tool reports the engine is not built yet, finish spec task 4 first. Do not edit the adapter to fake results.

## voice-lines (tools/tts-mcp)
Generates spoken lines from content/voice-lines.json with Amazon Polly stock voices.
- The server starts in DRY RUN mode (TTS_DRY_RUN=1). It plans but writes nothing. Only the developer switches this off, in .kiro/settings/mcp.json.
- Always call `list_voices` before assigning a new voice name.
- Never use or request a voice that imitates a real person. Stock voices only.
- Every line must have a caption. Do not edit `video_adult_dad_final`; the developer writes that line.
- Lo-fi effects are applied at runtime by the Web Audio layer, using each line's `effect` field. Do not bake effects into the audio files.
