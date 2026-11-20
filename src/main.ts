import './ui/crt.css';
import { AudioEngine } from './audio';
import { isMuted, onPreferencesChange } from './ui/prefs';
import { mountTerminal } from './ui/terminal';

const root = document.getElementById('terminal');
if (root) {
  const audio = new AudioEngine({ isMuted });
  onPreferencesChange((p) => audio.setMuted(p.muted));
  // Browsers only allow audio after a user gesture; the first key or click unlocks it.
  const unlock = (): void => audio.unlock();
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('pointerdown', unlock, { once: true });
  // Optional spoken lines. Loads in the background; if it fails the game keeps its synthesized cues and captions.
  void audio.loadVoiceIndex();
  mountTerminal(root, {
    onEvents: (events) => audio.handleEvents(events),
    captionsFor: (events) => audio.captionsFor(events),
  });
}
