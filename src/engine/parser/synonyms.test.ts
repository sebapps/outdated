// Task 3.3: every verb phrase listed in docs/puzzle-bible.md parses to its canonical verb.
// Validates: Requirements 1.2, 1.5
import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { parse } from './parser';

/** [player input, canonical verb, expected direct object, expected indirect object]. */
type Case = [string, string, string?, string?];

const BIBLE_CASES: Case[] = [
  // Room 1: Basement
  ['REWIND TAPE WITH PENCIL', 'REWIND', 'tape', 'pencil'],
  ['FIX TAPE', 'REWIND', 'tape'],
  ['WIND TAPE', 'REWIND', 'tape'],
  ['INSERT TAPE', 'INSERT', 'tape'],
  ['LOAD WALKMAN', 'INSERT', 'walkman'],
  ['PLAY WALKMAN', 'PLAY', 'walkman'],
  ['SEARCH CARTRIDGE BOX', 'SEARCH', 'cartridge box'],
  ['LIFT FOAM', 'SEARCH', 'foam'],
  ['SEARCH UNDER FOAM', 'SEARCH', 'foam'],
  // Room 2: Hallway
  ['EXAMINE PAGER', 'EXAMINE', 'pager'],
  ['DIAL 5550142', 'DIAL', '5550142'],
  ['DIAL 555-0142', 'DIAL', '5550142'],
  ['DIAL NUMBER', 'DIAL', 'number'],
  ['OPEN CLOSET', 'OPEN', 'closet'],
  ['SEARCH JACKET', 'SEARCH', 'jacket'],
  ['SEARCH INSIDE POCKET', 'SEARCH', 'pocket'],
  ['UNZIP POCKET', 'OPEN', 'pocket'],
  // Room 3: Boyhood bedroom
  ['INSERT CARTRIDGE', 'INSERT', 'cartridge'],
  ['PRESS POWER', 'PRESS', 'power'],
  ['TURN ON NES', 'PRESS', 'nes'],
  ['BLOW ON CARTRIDGE', 'BLOW', 'cartridge'],
  ['BLOW INTO CARTRIDGE', 'BLOW', 'cartridge'],
  ['OPEN TOYBOX', 'OPEN', 'toybox'],
  ['SEARCH TOYBOX', 'SEARCH', 'toybox'],
  ['TAKE TOY', 'TAKE', 'toy'],
  ['UNFOLD TRAILER', 'UNFOLD', 'trailer'],
  ['SEARCH COMPARTMENT', 'SEARCH', 'compartment'],
  // Room 4: Study
  ['FIND CORD', 'FIND', 'cord'],
  ['LOOK BEHIND BOOKSHELF', 'SEARCH', 'bookshelf'],
  ['PLUG IN TURNTABLE', 'PLUG', 'turntable'],
  ['PLAY RECORD', 'PLAY', 'record'],
  ['STOP RECORD', 'STOP', 'record'],
  ['TURN RECORD COUNTERCLOCKWISE', 'REVERSE', 'record'],
  ['SPIN BACKWARDS RECORD', 'REVERSE', 'record'],
  ['SPIN RECORD BACKWARDS', 'REVERSE', 'record'],
  ['REVERSE RECORD', 'REVERSE', 'record'],
  ['ROTATE RECORD BACKWARD', 'REVERSE', 'record'],
  ['OPEN DISK BOX', 'OPEN', 'disk box'],
  ['FLIP RECORD', 'FLIP', 'record'],
  // Room 5: Grandparents' bedroom
  ['OPEN TAPE CASE', 'OPEN', 'tape case'],
  ['PRESS PLAY', 'PLAY'],
  ['ADJUST TRACKING', 'ADJUST', 'tracking'],
  ['FIX TRACKING', 'ADJUST'],
  ['TRACKING', 'ADJUST'],
  ['SET CLOCK', 'SET', 'clock'],
  ['OPEN BATTERY COVER', 'OPEN', 'battery cover'],
  ['REMOVE BATTERY COVER', 'REMOVE', 'battery cover'],
  ['SEARCH CLOCK RADIO', 'SEARCH', 'clock radio'],
  ['UNLOCK DOOR', 'UNLOCK', 'door'],
  ['OPEN FRONT DOOR', 'OPEN', 'front door'],
];

describe('puzzle bible verb phrases', () => {
  it.each(BIBLE_CASES)('%s -> %s', (input, verb, direct, indirect) => {
    const r = parse(input, content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.command.verb).toBe(verb);
    if (direct !== undefined) expect(r.command.directObject).toBe(direct);
    if (indirect !== undefined) expect(r.command.indirectObject).toBe(indirect);
  });
});

describe('content/verbs.json coverage', () => {
  it('maps every listed synonym to its canonical verb', () => {
    for (const [id, def] of Object.entries(content.verbs)) {
      for (const syn of def.synonyms ?? []) {
        const r = parse(syn, content);
        expect(r.ok, `"${syn}" should parse`).toBe(true);
        if (r.ok) expect(r.command.verb, `"${syn}"`).toBe(id);
      }
    }
  });
});

describe('required verbs (Requirement 1.5)', () => {
  const REQUIRED = ['LOOK', 'EXAMINE', 'TAKE', 'DROP', 'INVENTORY', 'OPEN', 'SEARCH', 'USE', 'GO', 'HELP', 'HINT'];

  it.each(REQUIRED)('%s exists and parses by its own name', (verb) => {
    expect(content.verbs[verb]).toBeDefined();
    const r = parse(verb.toLowerCase(), content);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.verb).toBe(verb);
  });
});
