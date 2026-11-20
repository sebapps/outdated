// Player preferences (task 12). Persisted in localStorage and exposed to other layers.
// The audio layer (task 13) reads `isMuted()` and subscribes with `onPreferencesChange`.

export interface Preferences {
  muted: boolean;
  reduceEffects: boolean;
  /** Terminal font size in px. */
  textSize: number;
}

export const STORAGE_KEY = 'eighties-game:prefs';
export const MIN_TEXT_SIZE = 14;
export const MAX_TEXT_SIZE = 32;
export const DEFAULT_TEXT_SIZE = 18;
export const TEXT_SIZE_STEP = 2;

/** Minimal storage surface so tests and non-browser hosts can supply their own. */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function clampTextSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TEXT_SIZE;
  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(n)));
}

export function defaultPreferences(systemReducedMotion: boolean): Preferences {
  return { muted: false, reduceEffects: systemReducedMotion, textSize: DEFAULT_TEXT_SIZE };
}

/** Parses stored JSON defensively; bad or missing fields fall back to defaults. */
export function parsePreferences(raw: string | null, systemReducedMotion: boolean): Preferences {
  const base = defaultPreferences(systemReducedMotion);
  if (raw === null) return base;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return base;
    const r = data as Record<string, unknown>;
    return {
      muted: typeof r.muted === 'boolean' ? r.muted : base.muted,
      reduceEffects: typeof r.reduceEffects === 'boolean' ? r.reduceEffects : base.reduceEffects,
      textSize: typeof r.textSize === 'number' ? clampTextSize(r.textSize) : base.textSize,
    };
  } catch {
    return base;
  }
}

type Listener = (prefs: Readonly<Preferences>) => void;

export class PreferencesStore {
  private prefs: Preferences;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly storage: PrefsStorage | null,
    systemReducedMotion: boolean,
  ) {
    this.prefs = parsePreferences(this.read(), systemReducedMotion);
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  get(): Readonly<Preferences> {
    return this.prefs;
  }

  update(patch: Partial<Preferences>): void {
    const next: Preferences = { ...this.prefs, ...patch };
    next.textSize = clampTextSize(next.textSize);
    this.prefs = next;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage may be full or blocked; preferences still apply for this session.
    }
    for (const l of this.listeners) l(next);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function browserStorage(): PrefsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function systemPrefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let shared: PreferencesStore | undefined;

/** The app-wide store, created on first use. */
export function preferences(): PreferencesStore {
  shared ??= new PreferencesStore(browserStorage(), systemPrefersReducedMotion());
  return shared;
}

/** For the audio layer: true when sound must not play. Captions are always shown regardless. */
export function isMuted(): boolean {
  return preferences().get().muted;
}

export function onPreferencesChange(listener: Listener): () => void {
  return preferences().subscribe(listener);
}
