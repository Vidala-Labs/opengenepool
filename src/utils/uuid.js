/**
 * Pluggable identifier generation.
 *
 * Persistent annotation IDs are minted through an overridable generator so a host
 * can supply its own scheme — e.g. an Elixir backend doing a round-trip for a
 * server-synchronized UUIDv7. By default we use the platform `crypto.randomUUID()`
 * (v4), guarded so SSR / older browsers / non-browser tooling don't crash.
 *
 * Install a generator once at app startup:
 *   import { setUuidGenerator } from 'opengenepool'
 *   setUuidGenerator(async () => await fetchServerUuidV7())
 *
 * The generator may be sync (`() => string`) or async (`() => Promise<string>`);
 * `generateId()` always returns a Promise and awaits it.
 */

let customGenerator = null

/**
 * Install (or clear) the global UUID generator.
 * @param {(() => string | Promise<string>) | null} fn - generator, or null to reset to default.
 */
export function setUuidGenerator(fn) {
  customGenerator = typeof fn === 'function' ? fn : null
}

/**
 * Guarded platform UUID (v4). Falls back to a non-crypto random id when
 * `crypto.randomUUID` is unavailable, so it never throws.
 * @returns {string}
 */
function platformUuid() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  // Last-resort fallback (non-cryptographic) for environments without crypto.
  // Shape mirrors a v4 UUID; uniqueness is best-effort.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Generate a persistent id, awaiting the configured generator (default: platform UUID).
 * Always returns a Promise so a host can do an async round-trip (server-synced v7).
 * @returns {Promise<string>}
 */
export async function generateId() {
  if (customGenerator) {
    return await customGenerator()
  }
  return platformUuid()
}

/**
 * Generate an id synchronously using the guarded platform UUID. Used on paths that
 * cannot be async (e.g. the SequenceDocument constructor / bulk normalization, and
 * ephemeral backend edit-correlation ids). Never throws; ignores any async override.
 * @returns {string}
 */
export function generateIdSync() {
  return platformUuid()
}
