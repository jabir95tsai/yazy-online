/**
 * Encoding of the stored password digest.
 *
 * Kept free of any `cloudflare:workers` import so it can be unit tested under
 * plain Node — `lib/auth.ts`, which performs the actual derivation, cannot be.
 */

/** Cost assumed for stored hashes written before the cost was recorded. */
export const LEGACY_PBKDF2_ITERATIONS = 100_000;

/**
 * Stored form is `<iterations>:<hex>`.
 *
 * Recording the cost alongside the digest is what makes the iteration count
 * safe to change: verification replays whatever cost each row was written
 * with, so raising it upgrades new passwords without locking anyone out of an
 * existing one.
 */
export function serializeHash(iterations: number, digest: string) {
  return `${iterations}:${digest}`;
}

export function parseHash(stored: string) {
  const separator = stored.indexOf(":");
  if (separator === -1) {
    return { iterations: LEGACY_PBKDF2_ITERATIONS, digest: stored };
  }
  const iterations = Number.parseInt(stored.slice(0, separator), 10);
  return {
    iterations:
      Number.isFinite(iterations) && iterations > 0
        ? iterations
        : LEGACY_PBKDF2_ITERATIONS,
    digest: stored.slice(separator + 1),
  };
}
