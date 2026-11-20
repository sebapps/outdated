# Demo video script and checklist

Target length: 2 to 3 minutes. Goal: show the CRT look, the audio with captions, the narrator warming up, and the spec/steering/MCP workflow. Do not show or play the ending sequence in full. Cut away just before the last scene so the first-time experience is kept for the viewer.

## Before recording

- [ ] `npm run build && npm run preview` (or `npm run dev`). Browser at 100% zoom, window about 1280x720, dark room.
- [ ] Sound on, system volume about 50%. Record system audio and mic separately if possible.
- [ ] Reduce-effects OFF so flicker and scanlines are visible. Have Alt+E ready to demonstrate the toggle.
- [ ] Text size bumped one step (Alt+Plus) so it reads at video resolution.
- [ ] Fresh game (reload the page).
- [ ] Print `public/feelie.html` or have it open in a second tab for the intro shot.
- [ ] Have the playtest MCP working (see "Status" in `docs/writeup.md`) if you plan to show it; otherwise skip that shot.

## Shot list

| # | Time | Screen | Say / show |
|---|------|--------|------------|
| 1 | 0:00 | Title screen, then the feelie on paper or in the tab | "A text adventure about a kid who mocked his dad's old gadgets, and has to use them to get out." |
| 2 | 0:15 | Basement. Type `help` | Show the HELP screen. Point out that every sound is also captioned. |
| 3 | 0:30 | `take pencil`, `take cassette`, `rewind cassette with pencil` | Narrator at full snark. Let the caption `[a pencil cranks the tape back onto the spool]` show. |
| 4 | 0:50 | `play walkman`, then `search cartridge box`, `search under foam`, `take key`, `go up` | Dad's voice on the tape (audio on). Point out the lo-fi effect. |
| 5 | 1:15 | Hallway: `dial 5550142` | Rotary clicks, ring, beep, the young-Dad message, then the silence beat. Hold the pause. |
| 6 | 1:35 | Toggle mute (Alt+M), run one command, unmute | Show that the captions carry the game when muted. |
| 7 | 1:45 | Toggle reduce effects (Alt+E) and text size (Alt+Plus/Minus) | Show the CRT look on and off. |
| 8 | 1:55 | Study: `reverse record` | The reversed-record moment and the second silence beat. |
| 9 | 2:10 | Type `hint` twice | Show three-tier hints and the narrator's tone. |
| 10 | 2:20 | Cut to the Kiro IDE: `.kiro/specs`, `.kiro/steering`, `.kiro/hooks`, `.kiro/agents` | One sentence each. See `docs/writeup.md`. |
| 11 | 2:40 | Terminal: `npx vitest run tests/walkthrough.test.ts tests/newcomer.test.ts` | "The whole game is solved by a test on every change." (The soft-lock suite takes about 3.5 minutes. Show it passing from a pre-recorded run, or skip.) |
| 12 | 2:55 | Title card / URL | End. Do not show the final scene. |

## Shortcuts for a clean take

Commands for the first minute (copy and paste):

```
help
take pencil
take cassette
rewind cassette with pencil
take walkman
insert cassette into walkman
play walkman
search cartridge box
search under foam
take key
go up
examine pager
dial 5550142
```

## After recording

- [ ] Captions or burned-in subtitles for the narrator lines and the Dad voice lines.
- [ ] No lyrics and no copyrighted music in the video. Use only the game's own audio.
- [ ] Check that the audio levels are even, and that the silence beats are not trimmed out.
- [ ] Export 1080p, MP4, under the upload limit.
- [ ] Add the video link to the submission.
