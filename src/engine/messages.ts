// Plain-text rendering for the content-addressed MESSAGE ids emitted by world.ts.
// Returns undefined for ids owned by the narrator (generic banks such as `cant_do`).
import type { LoadedContent } from './content/types';
import { PUZZLE_MESSAGES } from './puzzles';

function names(content: LoadedContent, list: string): string {
  const parts = list.split(',').filter((s) => s !== '').map((id) => content.items[id]?.name ?? id);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function describeMessage(id: string, content: LoadedContent): string | undefined {
  const puzzleText = PUZZLE_MESSAGES[id];
  if (puzzleText !== undefined) return puzzleText;
  const [kind = '', a = '', b = ''] = id.split(':');
  const name = (itemId: string) => content.items[itemId]?.name ?? itemId;
  switch (kind) {
    case 'room': {
      const r = content.rooms[a as keyof typeof content.rooms];
      return r ? `${r.name}\n${r.description}` : undefined;
    }
    case 'item': {
      const item = content.items[a];
      return item ? (b !== '' ? item.states?.[b] : undefined) ?? item.description : undefined;
    }
    case 'decoy':
      return content.items[a]?.decoyLine;
    case 'decoy_late':
      return content.items[a]?.decoyLineLate ?? content.items[a]?.decoyLine;
    case 'exit':
    case 'exit_locked':
    case 'unlocked': {
      const exit = content.rooms[a as keyof typeof content.rooms]?.exits.find((e) => e.direction === b);
      if (!exit) return undefined;
      return kind === 'exit' ? exit.passText : kind === 'exit_locked' ? exit.lockedText : 'The key turns. It is unlocked.';
    }
    case 'hint': {
      if (b === 'solved') return content.hints[a as keyof typeof content.hints]?.solved;
      const tier = Number(b);
      return content.hints[a as keyof typeof content.hints]?.tiers[tier - 1];
    }
    case 'taken':
      return `Taken: ${name(a)}.`;
    case 'dropped':
      return `Dropped: ${name(a)}.`;
    case 'inventory':
      return `You are carrying: ${names(content, a)}.`;
    case 'inventory_empty':
      return 'You are empty-handed.';
    case 'found':
      return b === ''
        ? `You search the ${name(a)} and find nothing new.`
        : `You search the ${name(a)} and find: ${names(content, b)}.`;
    case 'opened':
      return `You open the ${name(a)}. Inside: ${names(content, b)}.`;
    case 'search_deeper':
      return `Nothing new out in the open. But the ${name(a).toLowerCase()} might be hiding something. Try searching that.`;
    case 'search_nothing':
      return `You find nothing of interest in the ${name(a)}.`;
    case 'cant_take':
      return `You can't take the ${name(a)}.`;
    case 'cant_drop':
      return 'No. Some things stay in your pocket.';
    case 'ambiguous': {
      const list = a.split(',').map((i) => `the ${name(i).toLowerCase()}`);
      return `Which do you mean, ${list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : list[0]}?`;
    }
    case 'not_here':
      return "You don't see that here.";
    case 'need_object':
      return 'Be more specific. What do you mean?';
    case 'already_held':
      return "You're already carrying that.";
    case 'not_carrying':
      return "You aren't carrying that.";
    case 'no_exit':
      return "You can't go that way.";
    case 'ambiguous_exit':
      return 'Which way do you mean?';
    case 'wrong_key':
      return "That key doesn't fit this door.";
    default:
      return undefined;
  }
}
