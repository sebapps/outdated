// Bundled content entry point. Validates at import time and throws loudly if anything is wrong.
import rooms from '../../../content/rooms.json';
import items from '../../../content/items.json';
import verbs from '../../../content/verbs.json';
import hints from '../../../content/hints.json';
import narration from '../../../content/narration.json';
import { loadContent } from './loader';

export * from './types';
export { ContentError, loadContent, type RawContent } from './loader';

export const content = loadContent({ rooms, items, verbs, hints, narration });
