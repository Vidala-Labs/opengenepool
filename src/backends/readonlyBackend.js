/**
 * Readonly backend adapter - a no-op backend that silently ignores all edit operations.
 *
 * This is a safety measure for readonly mode. Even if UI elements aren't properly
 * disabled, this backend ensures no edits can be sent to the server.
 *
 * Usage:
 *   import { createReadonlyBackend } from '../backends/readonlyBackend.js'
 *   const backend = readonly ? createReadonlyBackend() : createLiveViewBackend(live)
 */

export function createReadonlyBackend() {
  return {
    // Sequence operations - silently ignore
    insert: () => {},
    delete: () => {},

    // Annotation operations - silently ignore
    annotationCreated: () => {},
    annotationUpdate: () => {},
    annotationDeleted: () => {},

    // Metadata operations - silently ignore
    titleUpdate: () => {},
    metadataUpdate: () => {},
  }
}
