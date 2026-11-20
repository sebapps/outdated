import { it } from 'vitest';
import { createInitialState, runInput, candidateCommands, stateKey, isEnded } from '../src/engine/index.js';

it('probe', () => {
  const s0 = createInitialState();
  const cmds = candidateCommands(s0);
  let t = performance.now();
  for (const c of cmds) runInput(s0, c);
  console.log('candidates', cmds.length, 'ms per run', (performance.now() - t) / cmds.length);
  const seen = new Set<string>([stateKey(s0)]);
  const q = [s0];
  let expanded = 0;
  t = performance.now();
  let found = false;
  while (q.length && expanded < 60) {
    expanded++;
    const s = q.shift()!;
    for (const c of candidateCommands(s)) {
      const n = runInput(s, c).state;
      if (isEnded(n)) { found = true; break; }
      const k = stateKey(n);
      if (!seen.has(k)) { seen.add(k); q.push(n); }
    }
    if (found) break;
    if (expanded % 20 === 0) console.log(expanded, 'seen', seen.size, 'ms', Math.round(performance.now() - t));
  }
  console.log('found', found, 'expanded', expanded, 'seen', seen.size, 'ms', Math.round(performance.now() - t));
}, 600000);
