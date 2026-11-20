// Task 10.3 (optional): LlmNarrator with timeout, output validator, and canned fallback.
// The completion function is injected; no network access or keys live in this module.
import type { EngineEvent } from '../engine/state';
import type { CannedNarrator, NarrationContext, NarratorProvider } from './canned';

export interface LlmRequest {
  event: EngineEvent;
  warmth: number;
  /** Short style brief (from narrator-voice.md). */
  styleBrief: string;
  signal: AbortSignal;
}

export type CompletionFn = (req: LlmRequest) => Promise<string>;

export const DEFAULT_TIMEOUT_MS = 1500;
export const MAX_SENTENCES = 3;
export const MAX_CHARS = 280;

/** Default real-name / artist block list (lowercase). Extend via options. */
export const DEFAULT_BLOCKED_NAMES = [
  'michael jackson', 'prince', 'madonna', 'bruce springsteen', 'whitney houston',
  'david bowie', 'cyndi lauper', 'duran duran', 'ronald reagan', 'steven spielberg',
];

// Claims that the world changed (items taken, doors opened, solutions revealed).
const STATE_CLAIM_PATTERNS: RegExp[] = [
  /\byou(?:'ve| have)?\s+(?:now\s+)?(?:pick(?:ed)? up|took|taken|grab(?:bed)?|unlock(?:ed)?|open(?:ed)?|solved|found)\b/i,
  /\b(?:the\s+)?(?:door|lock|drawer|safe|chest|box)\s+(?:is|was|has been|swings?|clicks?)\s+(?:now\s+)?(?:unlocked|open|opens?|opened)\b/i,
  /\b(?:added|adds)\b.*\binventory\b/i,
  /\b(?:the\s+)?(?:answer|solution|code|combination)\s+is\b/i,
  /\byou\s+(?:win|won|finish(?:ed)?|escape[d]?)\b/i,
];

const LYRICS_PATTERNS: RegExp[] = [/♪|♫/, /\blyrics?\b/i, /["“”][^"“”]{40,}["“”]/];

export interface ValidatorOptions {
  blockedNames?: string[];
  maxChars?: number;
  maxSentences?: number;
}

/** Returns the trimmed text when valid, otherwise undefined. */
export function validateNarration(text: unknown, opts: ValidatorOptions = {}): string | undefined {
  if (typeof text !== 'string') return undefined;
  const t = text.trim();
  if (t.length === 0) return undefined;
  if (t.length > (opts.maxChars ?? MAX_CHARS)) return undefined;
  const sentences = (t.match(/[.!?]+(\s|$)/g) ?? []).length || 1;
  if (sentences > (opts.maxSentences ?? MAX_SENTENCES)) return undefined;
  if (LYRICS_PATTERNS.some((r) => r.test(t))) return undefined;
  if (STATE_CLAIM_PATTERNS.some((r) => r.test(t))) return undefined;
  const lower = t.toLowerCase();
  for (const name of opts.blockedNames ?? DEFAULT_BLOCKED_NAMES) {
    if (name && lower.includes(name.toLowerCase())) return undefined;
  }
  return t;
}

export interface LlmNarratorOptions extends ValidatorOptions {
  complete: CompletionFn;
  fallback: Pick<CannedNarrator, 'narrate'>;
  styleBrief?: string;
  timeoutMs?: number;
}

export class LlmNarrator implements NarratorProvider {
  private readonly opts: LlmNarratorOptions;

  constructor(opts: LlmNarratorOptions) {
    this.opts = opts;
  }

  async narrate(event: EngineEvent, ctx: NarrationContext): Promise<string> {
    const { complete, fallback, styleBrief = '', timeoutMs = DEFAULT_TIMEOUT_MS } = this.opts;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('LLM narration timed out'));
        }, timeoutMs);
      });
      const raw = await Promise.race([
        complete({ event, warmth: ctx.warmth, styleBrief, signal: controller.signal }),
        timeout,
      ]);
      const valid = validateNarration(raw, this.opts);
      if (valid !== undefined) return valid;
    } catch {
      // fall through to canned
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    return fallback.narrate(event, ctx);
  }
}
