/**
 * Readonly backend adapter - a no-op backend that silently ignores all edit operations.
 *
 * This is a safety measure for readonly mode: it ensures no edit *notifications* are
 * ever sent to the server. It is NOT, by itself, sufficient to make a document
 * readonly — `SequenceDocument` mutates its in-memory state before notifying the
 * backend, so a readonly backend alone leaves the local document editable.
 *
 * To enforce readonly at the source (so direct `doc.insert/delete/replace/...` calls
 * are no-ops too), construct the document with `readonly: true`:
 *
 *   const doc = new SequenceDocument({ sequence, readonly: true })
 *
 * and (optionally) also pass the editor the `readonly` prop to disable UI
 * affordances. The three layers are complementary:
 *   - `SequenceDocument({ readonly: true })` — blocks all in-memory mutation (the
 *     authoritative guard);
 *   - the editor `readonly` prop — disables keyboard/menu/paste affordances;
 *   - `createReadonlyBackend()` — guarantees nothing is persisted server-side.
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
