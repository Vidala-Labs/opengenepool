# AGENTS.md

## Project Shape

OpenGenePool is a Vue 3 component library for DNA sequence viewing, editing, annotation, circular plasmid rendering, and pairwise alignment.

Key entry points:
- `src/index.js`: public exports for components, composables, utilities, and bundled extensions.
- `src/components/SequenceEditor.vue`: main single-document editor shell.
- `src/components/AlignmentEditor.vue`: separate two-document alignment editor, not a mode inside `SequenceEditor`.
- `src/composables/SequenceDocument.js`: reactive document model and mutation surface.
- `src/utils/dna.js`: core DNA primitives and coordinate semantics.
- `example/`: Vite example app with GenBank import/export helpers.

## Commands

The project uses Bun.

```bash
bun install
bun test
bun test --watch
bun run build:wasm
cd example && bun run dev
```

## Critical Domain Invariants

Coordinates are fenced coordinates throughout core code: 0-based, half-open intervals `[start, end)`, matching JavaScript `slice(start, end)`.

Important conversions:
- Internal `Range(0, 10)` means bases 0 through 9.
- GenBank display converts to 1-based inclusive, so internal `0..10` displays as `1..10`.
- Cursor ranges are zero length, such as `Range(5, 5, Orientation.NONE)`.

Core domain classes live in `src/utils/dna.js`:
- `Range`: one contiguous fenced interval with orientation.
- `Span`: multiple ranges for joins/non-contiguous features.
- `Orientation`: `PLUS` = `1`, `MINUS` = `-1`, `NONE` = `0`.

Annotation objects should keep `span` as a `Span` instance inside app state. `SequenceDocument` normalizes plain inputs at boundaries and throws for unsupported span shapes.

## Data Flow

`SequenceDocument` is the source of truth for sequence, annotations, circular flag, gaps, and optional backend notifications.

Mutation methods:
- `insert(position, text, options)`
- `delete(ranges)`
- `replace(start, end, text, options)`
- `addAnnotation(annotation)`
- `updateAnnotation(annotation)`
- `deleteAnnotation(id)`

`SequenceEditor.vue` adapts `SequenceDocument` into editor-local composables:
- `useEditorState`: sequence string, zoom, cursor, line splitting.
- `useSelection`: multi-range selection and handle state.
- `useGraphics`: linear SVG metrics and layout.
- `createEventBus`: local event bus for editor internals.

`SequenceEditor` owns selection as the single source of truth and provides it to child layers via Vue `provide`.

## Rendering Structure

Linear rendering is SVG-based:
- `SequenceLayer.vue`: bases / sequence visual display.
- `SelectionLayer.vue`: selection ranges and handles.
- `AnnotationLayer.vue`: feature bars.
- `TranslationLayer.vue`: CDS amino acid display.
- extension `graphicsLayer` components mount inside the linear SVG.

Circular rendering is SVG/plasmid-map oriented:
- `CircularView.vue` coordinates circular editor pieces.
- `useCircularGraphics.js` handles origin rotation, angle/position conversion, radial zoom, tick marks, row radii, and extension radial space.
- circular extension layers use the extension object's `circularGraphicsLayer`.

`AlignmentEditor.vue` has its own shell and alignment-specific providers. It computes Smith-Waterman alignment from two `SequenceDocument` instances, updates document gaps, and renders aligned query/target rows.

## Alignment

Alignment code lives in `src/utils/alignment.js` and `src/utils/alignment-js.js`.

`align(query, target, options)` uses WASM if `loadWasm()` succeeds; otherwise it falls back to JavaScript. The WASM source is in `src/wasm/alignment.zig`, and the built artifact is `src/utils/alignment.wasm`. Options include `circular` (detect a rotated linearization origin via k-mer seed-and-chain) and `tryReverseComplement` (align both query strands, keep the higher-scoring one, and tag `result.reverseComplement`).

Reverse-complement query support lives in one seam: `src/composables/SequenceDocumentRC.js` wraps a `SequenceDocument` and presents the same API reverse-complemented (reads RC'd, writes translated back to the underlying doc). When the kernel reports an antisense match, `AlignmentEditor` swaps in this wrapper so the rest of the pipeline stays orientation-blind. Do not re-scatter RC special-cases through the editor; extend the wrapper instead.

Coordinate mapping helpers:
- `buildCoordinateMap`
- `buildAlignedToOriginalMap`
- `mapCoordinate`
- `buildReverseCoordinateMap`
- `mapAnnotationThroughAlignment`
- `reverseComplementAnnotation`
- `extractGaps`

## Extensions

Extensions are plain objects passed to `SequenceEditor`/`AlignmentEditor` through the `extensions` prop. The documented interface is in `EXTENSIONS.md`.

Supported extension hooks:
- `toolbarButton`
- `panel`
- `contextMenuItems(context, extensionAPI)`
- `graphicsLayer`
- `circularGraphicsLayer`

Bundled extensions:
- `SearchExtension`: toolbar button plus panel.
- `ORFFinderExtension`: toolbar button plus panel.
- `BlastExtension`: context menu integration.
- `RestrictionExtension`: toolbar button, panel, linear layer, circular layer.
- `PrimerBindExtension`: annotation field extension, not a normal editor toolbar/panel extension.

Extension components consume `extensionAPI` via Vue injection. Useful methods include:
- `getSequence()`
- `getSelectedSequence()`
- `getAnnotations()`
- `setSelection(spec)`
- `clearSelection()`
- `scrollToPosition(pos)`
- `addAnnotation(data)`
- `onSelectionChange(handler)`

## Testing Setup

Tests are colocated with source files and use Bun's test runner plus `@vue/test-utils`.

`test/setup.js` registers:
- custom Vue SFC loader from `test/vue-plugin.js`
- Happy DOM globals

There are broad tests across utilities, composables, components, backends, alignment, and extensions. Use targeted tests while iterating, then `bun test` before finishing larger changes.

## Common Gotchas

- Preserve fenced coordinate semantics. Off-by-one errors are the highest-risk class of bugs here.
- Do not convert `Span` instances to plain objects inside runtime state; many layers expect methods/properties from `Span`/`Range`.
- `SequenceEditor` and `AlignmentEditor` duplicate some shell behavior but are intentionally separate components.
- Annotation labels use `caption` in the current model. Some docs/examples mention `label`; check current code before assuming field names.
- `readonly` disables editing operations and clipboard writes, but selection/copy behavior may still be relevant.
- `localStorage` is used for zoom, annotation color preferences, and rich copy/paste overlay data.
- Circular mode has separate interaction and layout paths; fixes in linear layers often need an explicit circular check.
- `PrimerBindExtension` is an annotation field extension shape, unlike the standard editor extension interface.

## Useful Files By Task

Selection behavior:
- `src/composables/useSelection.js`
- `src/components/SelectionLayer.vue`
- `src/components/CircularSelectionLayer.vue`
- `src/components/SequenceEditor.keyboard.test.js`

Annotation behavior:
- `src/utils/annotation.js`
- `src/composables/SequenceDocument.js`
- `src/components/AnnotationLayer.vue`
- `src/components/AnnotationModal.vue`
- `src/components/CircularAnnotationLayer.vue`

Sequence editing:
- `src/composables/SequenceDocument.js`
- `src/components/SequenceEditor.vue`
- `src/components/InsertModal.vue`
- `src/composables/useClipboard.js`

Circular view:
- `src/components/CircularView.vue`
- `src/composables/useCircularGraphics.js`
- `src/composables/useCircularAnnotations.js`
- `src/utils/circular.js`

Alignment:
- `src/components/AlignmentEditor.vue`
- `src/utils/alignment.js`
- `src/utils/alignment-js.js`
- `src/wasm/alignment.zig`

Extension work:
- `EXTENSIONS.md`
- `src/components/Toolbar.vue`
- `src/components/ContextMenu.vue`
- `src/extensions/*`
