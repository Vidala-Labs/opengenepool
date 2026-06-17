# Context-Menu Refactor — Contributor Service

This document describes the refactor of OpenGenePool's right-click context-menu
construction from per-editor, hand-assembled menus into a single **contributor
service** shared by all editors.

## Why

Context menus were built ad-hoc and duplicated:

- **Each editor hand-enumerated its layer refs** and concatenated menu items
  (`annotationLayerRef.getMenuItemsForElement(...)`, `selectionLayerRef...`, etc.).
- **"Global" items** (Copy / Select all / Insert / Replace / Delete / Create
  annotation) were duplicated between `SequenceEditor.buildContextMenuItems` and a
  **divergent** copy in `CircularEditor` — even the labels differed
  ("Replace selection..." vs "Replace sequence with...", "Create annotation..." vs
  "Create Annotation").
- **Two contributor styles** coexisted: linear layers *returned* items via
  `getMenuItemsForElement(dataset)` (parsing stringified `data-*`), while circular
  layers *emitted events*; annotation Edit/Delete was implemented twice.
- A fully-built `useRegionRegistry` composable existed but was **dead code**.

The result: adding one menu item (e.g. "Hide annotation") meant editing multiple
editors, and the circular/alignment menus drifted from the linear one.

## What changed

One **menu service**; each layer **self-registers a contributor**. The editor
hit-tests, resolves a **rich context**, asks the service to aggregate, and shows the
result. No editor-owned menu items; linear, circular, and alignment editors share
the same contributors.

### 1. The service — `src/composables/useContextMenu.js`

```js
const menu = useContextMenu()
menu.register({ id, getItems(context) => MenuItem[] })   // idempotent by id
menu.unregister(contributorOrId)
menu.buildMenu(context) => MenuItem[]                    // aggregated + normalized
```

- Contributors run in **registration order**.
- A single **separator is inserted between** non-empty contributors; empty/falsy
  contributor results are skipped.
- `normalizeMenuItems(items)` (exported, pure, unit-tested) collapses separators so
  the menu never shows a **leading, trailing, or doubled** divider — even if a
  contributor emits its own boundary separators.

Each editor instance creates and `provide('contextMenu', menu)`s its **own** service,
so stacked editors (alignment's target/query) never cross-talk.

### 2. Rich context (resolved once by the editor)

The editor turns a right-click into a plain context object and passes it to every
contributor. Contributors receive **real objects** (annotation, `Range`, selection),
not stringified `data-*` ids.

```
{ kind: 'annotation', annotation, rangeIndex, selection, document, readonly, mode, annotations }
{ kind: 'selection',  rangeIndex, range, handleType, selection, readonly, mode }
{ kind: 'sequence',   pos, selection, readonly, mode, sequenceLength }
{ kind: 'background',  pos, selection, readonly, mode, sequenceLength }
```

#### `mode` — the display surface that was clicked (single enum)

`mode: 'linear' | 'circular' | 'target' | 'query'` — mutually exclusive:

- `'linear'`   — single-sequence **linear** display (`SequenceEditor`).
- `'circular'` — **circular** display (`CircularEditor`).
- `'target'` / `'query'` — the two rows of the **alignment** display
  (`AlignmentEditor`).

> **Important:** `'target'` is *conceptually* linear, but it is **never** part of a
> plain linear sequence display — it appears **only** in the alignment display
> (likewise `'query'`). The four values are **disjoint surfaces** owned by three
> different editors, so a contributor never sees `mode === 'linear'` together with a
> target/query row.

`mode` is **load-bearing** (not a render flag): contributors use it to filter to the
clicked alignment row, attribute `selection.source` (target/query), and choose
original-vs-aligned coordinates / reverse-complement-for-query in the alignment view.

#### Effective annotation (alignment)

In alignment mode an annotation is drawn against *aligned* coordinates, with the real
annotation at `attributes._originalAnnotation` and the row at
`attributes._alignmentMode`. The **editor's resolver** unwraps this up front, so
`context.annotation` is always the *effective* annotation and the shared annotation
contributor never reads alignment internals.

### 3. Contributors — `src/components/menus/*MenuContributor.js`

Coordinate-system-agnostic pure functions, one per kind, imported by the linear,
circular, and alignment layers (single source of truth):

- **`annotationMenuContributor.js`** — Edit, Delete, Hide/Unhide (`ogp:hidden`),
  Subtract, Merge L/R, Split, Clip-primer ×2.
- **`selectionMenuContributor.js`** — owns *all* selection items; distinguishes a
  click **on** a selection range/handle (`kind:'selection'` → strand/move/extend)
  from a sequence/background context where a selection merely exists (Copy / Select
  none / Replace / Delete / Create annotation).
- **`sequenceMenuContributor.js`** — Select all + Insert, with alignment-row
  (`mode`) filtering and selection-source attribution.

Each is `getItems(context, deps)`; the layer supplies `deps`.

### 4. Action transport — direct handler calls (events removed)

A menu item's `action` calls **injected handlers directly** — the old per-layer
events (`@edit-annotation`, `@delete-annotation`, `@toggle-hidden`, and the
`@contextmenu`-with-`action` merge/split indirection) are **removed**. The editor
provides a per-kind handler bundle (its real functions: open-modal, delete, toggle
`ogp:hidden`, merge, split, copy, …); each layer injects it, captures it as the
contributor's `deps`, and registers the contributor on mount.

Flow:

1. Layer emits "a click happened here" (with the clicked annotation/range).
2. Editor builds the rich context and calls `menu.buildMenu(context)`.
3. Each registered contributor's `getItems(context)` runs (with its captured deps).
4. Editor shows the normalized, aggregated items in its `ContextMenu`.

### Hide / Unhide

The per-annotation `ogp:hidden` hide/unhide menu item ships as part of the annotation
contributor, so it appears identically in the linear, circular, and alignment menus.

## Removed / replaced

- **Deleted:** `src/composables/useRegionRegistry.{js,test.js}` (dead code).
- **Removed from editors:** the duplicated `buildContextMenuItems` /
  `buildGlobalContextMenuItems` global-item blocks, the divergent circular labels,
  the dead `buildContextMenuFromRegistry`, `getMenuItemsForElement` on each layer,
  AlignmentEditor's bespoke annotation-menu block, and the per-layer context-menu
  action events.
- **Unchanged:** DOM hit-testing still uses `elementsFromPoint` for background/
  sequence clicks; click *routing* (`handleSvgClick` / `handleClickForElement`) is a
  separate concern and was intentionally left as-is.

## Testing

- `useContextMenu.test.js` — registration order, aggregation, adversarial separator
  normalization, context pass-through, idempotent registration.
- `menus/*MenuContributor.test.js` — exact item sets and conditions, and that each
  action routes to the right injected dep (mocked).
- Editor integration tests assert all editors produce the **same** annotation items
  and global labels, alignment per-row filtering (no duplicates), and that the
  existing `[data-action="..."]` selectors still resolve.
