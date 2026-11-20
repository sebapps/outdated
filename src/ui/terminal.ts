// Task 12: CRT terminal. Plain DOM, keyboard-only, no framework.
// The visual log is aria-hidden (it types out character by character); a separate polite live region
// receives each turn's full text so screen readers hear it once, complete.
import type { EngineEvent, GameState } from '../engine/state';
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TEXT_SIZE_STEP,
  preferences,
  type PreferencesStore,
} from './prefs';
import { newGame, opening, takeTurn, withVoiceCaptions, type SessionDeps, type UiLine } from './session';

export interface TerminalOptions extends SessionDeps {
  /** Hook for the audio layer (task 13): receives each turn's engine events. */
  onEvents?: (events: readonly EngineEvent[]) => void;
  /** Extra captions (spoken lines) for a turn. Shown whether or not sound is on. */
  captionsFor?: (events: readonly EngineEvent[]) => readonly string[];
  prefs?: PreferencesStore;
}

const TYPE_MS = 18;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountTerminal(root: HTMLElement, options: TerminalOptions = {}): void {
  const prefs = options.prefs ?? preferences();
  let state: GameState = newGame();
  let busy = false;
  let skip = false;
  let over = false;
  const history: string[] = [];
  let historyIndex = 0;

  // ---- structure -------------------------------------------------------------------------------
  const screen = el('div', { class: 'crt-screen' });
  const toolbar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Display and sound settings' });
  const muteBtn = el('button', { type: 'button', 'aria-pressed': 'false' });
  const effectsBtn = el('button', { type: 'button', 'aria-pressed': 'false' });
  const smaller = el('button', { type: 'button', 'aria-label': 'Decrease text size' }, 'A-');
  const larger = el('button', { type: 'button', 'aria-label': 'Increase text size' }, 'A+');
  toolbar.append(muteBtn, effectsBtn, smaller, larger);

  const log = el('div', { class: 'log', 'aria-hidden': 'true' });
  const announcer = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const form = el('form', { class: 'input-line', autocomplete: 'off' });
  const label = el('label', { for: 'command-input', class: 'sr-only' }, 'Type a command and press Enter');
  const prompt = el('span', { class: 'prompt', 'aria-hidden': 'true' }, '>');
  const input = el('input', {
    id: 'command-input',
    type: 'text',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    autocorrect: 'off',
    'aria-describedby': 'keys-help',
  });
  const help = el(
    'p',
    { id: 'keys-help', class: 'keys-help' },
    'Enter sends. Any key skips the typing. Up/Down recalls commands. Alt+M mute, Alt+E effects, Alt+Plus and Alt+Minus text size. Try HELP.',
  );
  form.append(label, prompt, input);
  screen.append(toolbar, log, form, help);
  root.replaceChildren(screen, announcer);

  // ---- preferences -----------------------------------------------------------------------------
  const applyPrefs = (): void => {
    const p = prefs.get();
    root.style.setProperty('--font-size', `${p.textSize}px`);
    root.classList.toggle('reduce-effects', p.reduceEffects);
    muteBtn.textContent = p.muted ? 'Sound: off' : 'Sound: on';
    muteBtn.setAttribute('aria-pressed', String(p.muted));
    muteBtn.setAttribute('aria-label', 'Mute sound (captions always shown)');
    effectsBtn.textContent = p.reduceEffects ? 'Effects: reduced' : 'Effects: full';
    effectsBtn.setAttribute('aria-pressed', String(p.reduceEffects));
    effectsBtn.setAttribute('aria-label', 'Reduce effects (no flicker, flashing or shake)');
    smaller.disabled = p.textSize <= MIN_TEXT_SIZE;
    larger.disabled = p.textSize >= MAX_TEXT_SIZE;
  };
  prefs.subscribe(applyPrefs);
  applyPrefs();

  const toggleMute = (): void => prefs.update({ muted: !prefs.get().muted });
  const toggleEffects = (): void => prefs.update({ reduceEffects: !prefs.get().reduceEffects });
  const resize = (delta: number): void => prefs.update({ textSize: prefs.get().textSize + delta });
  muteBtn.addEventListener('click', toggleMute);
  effectsBtn.addEventListener('click', toggleEffects);
  smaller.addEventListener('click', () => resize(-TEXT_SIZE_STEP));
  larger.addEventListener('click', () => resize(TEXT_SIZE_STEP));

  // ---- output ----------------------------------------------------------------------------------
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const t = window.setTimeout(resolve, ms);
      const poll = window.setInterval(() => {
        if (skip) {
          window.clearTimeout(t);
          window.clearInterval(poll);
          resolve();
        }
      }, 30);
      window.setTimeout(() => window.clearInterval(poll), ms + 50);
    });

  const scroll = (): void => {
    log.scrollTop = log.scrollHeight;
  };

  const instant = (): boolean =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function reveal(node: HTMLElement, text: string): Promise<void> {
    if (skip || instant()) {
      node.textContent = text;
      return;
    }
    for (let i = 1; i <= text.length; i++) {
      if (skip) {
        node.textContent = text;
        break;
      }
      node.textContent = text.slice(0, i);
      scroll();
      await sleep(TYPE_MS);
    }
  }

  function flash(cls: string): void {
    if (prefs.get().reduceEffects) return;
    root.classList.add(cls);
    window.setTimeout(() => root.classList.remove(cls), 600);
  }

  async function print(lines: readonly UiLine[]): Promise<void> {
    const spoken: string[] = [];
    for (const line of lines) {
      if (line.kind === 'pause') {
        if (!skip) await sleep(line.ms);
        continue;
      }
      const node = el('p', { class: line.kind === 'caption' ? 'line caption' : 'line' });
      log.append(node);
      spoken.push(line.text);
      await reveal(node, line.text);
      scroll();
    }
    announcer.textContent = spoken.join(' ');
    scroll();
  }

  function echo(text: string): void {
    log.append(el('p', { class: 'line echo' }, `> ${text}`));
    scroll();
  }

  function effectsFor(events: readonly EngineEvent[]): void {
    for (const e of events) {
      if (e.type !== 'SOUND') continue;
      if (e.cue === 'alarm_buzz') flash('shake');
      if (e.cue === 'static_burst') flash('flash');
    }
  }

  function finish(): void {
    over = true;
    input.disabled = true;
    form.hidden = true;
    help.hidden = true;
    toolbar.focus();
  }

  // ---- input -----------------------------------------------------------------------------------
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (busy || over) return;
    const text = input.value.trim();
    input.value = '';
    if (text !== '') {
      history.push(text);
      historyIndex = history.length;
    }
    echo(text);
    busy = true;
    skip = false;
    void (async () => {
      try {
        const turn = await takeTurn(state, text, options);
        state = turn.state;
        effectsFor(turn.events);
        try {
          options.onEvents?.(turn.events);
        } catch {
          /* audio must never break the game */
        }
        let captions: readonly string[] = [];
        try {
          captions = options.captionsFor?.(turn.events) ?? [];
        } catch {
          /* fall back to the engine's own captions */
        }
        await print(withVoiceCaptions(turn.lines, captions));
        if (turn.ended) finish();
      } finally {
        busy = false;
        skip = false;
        if (!over) input.focus();
      }
    })();
  });

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowUp' && history.length > 0) {
      ev.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] ?? '';
    } else if (ev.key === 'ArrowDown' && history.length > 0) {
      ev.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] ?? '';
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      const k = ev.key.toLowerCase();
      if (k === 'm') { ev.preventDefault(); toggleMute(); return; }
      if (k === 'e') { ev.preventDefault(); toggleEffects(); return; }
      if (k === '+' || k === '=') { ev.preventDefault(); resize(TEXT_SIZE_STEP); return; }
      if (k === '-' || k === '_') { ev.preventDefault(); resize(-TEXT_SIZE_STEP); return; }
    }
    // Any other key skips the typewriter; the key itself is swallowed so it doesn't pollute the input.
    if (busy && !skip && !['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(ev.key)) {
      skip = true;
      ev.preventDefault();
    }
  });

  // Clicking the screen returns focus to the input without stealing button or text-selection clicks.
  screen.addEventListener('click', (ev) => {
    const target = ev.target;
    if (over || (target instanceof HTMLElement && target.closest('button')) || String(window.getSelection()) !== '') return;
    input.focus();
  });

  // ---- start -----------------------------------------------------------------------------------
  busy = true;
  void opening(state, options).then(async (lines) => {
    await print(lines);
    busy = false;
    skip = false;
    input.focus();
  });
}
