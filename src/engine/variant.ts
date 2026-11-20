// Deterministic variant selection. The engine never uses Math.random or Date.now;
// wording rotates with GameState.variantCounter instead.

/** Small stable string hash (FNV-1a, 32-bit) so different salts start at different offsets. */
function hashSalt(salt: string | number): number {
  const s = String(salt);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pick a variant by index. Consecutive counters give consecutive indices (mod length),
 * so the same line never repeats back to back when there is more than one variant.
 * `salt` offsets the rotation per message key so different keys do not move in lockstep.
 */
export function pickVariantIndex(length: number, counter: number, salt: string | number = ''): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  const c = Number.isFinite(counter) ? Math.abs(Math.trunc(counter)) : 0;
  const offset = salt === '' ? 0 : hashSalt(salt) % length;
  return (c + offset) % length;
}

export function pickVariant<T>(variants: readonly T[], counter: number, salt: string | number = ''): T {
  return variants[pickVariantIndex(variants.length, counter, salt)] as T;
}
