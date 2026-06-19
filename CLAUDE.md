# CLAUDE.md - OpenGenePool Development Guide

## Project Overview

OpenGenePool is a Vue.js 3 DNA sequence editor component library. It provides biologists and genetic engineers with a complete tool for viewing, editing, and annotating DNA sequences with support for both linear and circular (plasmid) visualizations.

## Tech Stack

- **Vue.js 3.4+** with `<script setup>` Composition API
- **Bun** - Runtime, package manager, and test runner
- **Heroicons Vue** - Icon library
- **Happy DOM** - DOM polyfill for testing

## Commands

```bash
bun install          # Install dependencies
bun test             # Run all tests
bun test --watch     # Watch mode for development
```

To run the example app:
```bash
cd example && bun install && bun run dev
```

## Git Practice

For the near future, development is **local-dev only**: do feature work on local
branches and merge them into `master` locally. Do **not** push branches or open PRs
to the remote unless explicitly asked. (This policy will be amended in the future.)

## Directory Structure

```
src/
├── components/      # Vue SFC components
├── composables/     # Vue 3 composables (state management + the SequenceDocument
│                    #   model and its SequenceDocumentRC reverse-complement wrapper)
├── utils/           # Utility modules (dna.js, annotation.js, translation.js, circular.js)
├── backends/        # Backend adapters (readonly, IndexedDB)
└── index.js         # Public exports
test/                # Test setup (preload config, Vue SFC compiler)
example/             # Working example app with GenBank import/export
```

## Key Architecture Patterns

### Single editor per page (CONSTRAINT)

**Only one editor instance (`SequenceEditor`, `CircularEditor`, or `AlignmentEditor`)
is supported per page.** Annotation-display state — visibility toggle, hidden types,
"reveal hidden", the known-types set, and color overrides — lives at **module scope**
in `src/components/AnnotationLayer.vue` (`showAnnotations`, `hiddenTypes`,
`showHiddenAnnotations`, `allAnnotationTypes`, `annotationColorsRef`, `instanceCount`).
`CircularAnnotationLayer.vue` imports those same refs, and first-instance config
tracking uses `window.__circularAnnotationLayerFirst`. Because this state is shared
across all instances, mounting two editors on one page makes them interfere (toggling
hidden types in one affects the other; config items only render for the first
instance). This is by design — multiple editors per page is not a supported
configuration. If that ever changes, this state must move to provided editor-scoped
state (provide/inject) instead of module/`window` globals.

### Coordinate System (CRITICAL)

This codebase uses **fenced coordinates** - 0-based, half-open intervals `[start, end)`:
- `0..3` includes positions 0, 1, 2 (3 bases total)
- Like JavaScript array slicing: `sequence.slice(start, end)`
- `Range` class enforces `start < end` (or equal for cursor positions)
- GenBank notation: `10..20` (plus strand) or `(10..20)` (minus strand)

### Strand/Orientation

```javascript
import { Orientation } from './utils/dna.js'
// Orientation.PLUS (+1), Orientation.MINUS (-1), Orientation.NONE (0)
```

### Core Classes

- **`Range`** - Single coordinate range with fenced semantics
- **`Span`** - Multi-range collection (for join notation like `join(1..10,20..30)`)
- **`Annotation`** - Feature annotation with span, type, label, color
- **`SelectionDomain`** - Array of `Range` objects for multi-range selections

### State Management

All state flows through composables:
- `useEditorState` - Core sequence, zoom, cursor state
- `useSelection` - Multi-range selection handling
- `useGraphics` - Linear view layout calculations
- `useCircularGraphics` - Circular view angle/radius calculations
- `useAnnotations` - Annotation CRUD operations
- `useEventBus` - Decoupled component communication
- `usePersistedZoom` - localStorage zoom persistence

### Component Patterns

- Use `<script setup>` exclusively
- Heavy use of `computed()` for derived state
- Props with validation and defaults
- Events emitted for parent communication
- `shallowRef()` for large sequence data

## Naming Conventions

- Components: PascalCase (`SequenceEditor.vue`)
- Composables: `use` prefix (`useEditorState.js`)
- Utils: camelCase (`dna.js`)
- Classes: PascalCase (`Range`, `Span`, `Annotation`)
- Constants: SCREAMING_SNAKE_CASE (`DNA_BASES`, `ANNOTATION_COLORS`)

## Testing

Tests use Bun's built-in test runner with `@vue/test-utils`:

```javascript
import { describe, it, expect } from 'bun:test'

describe('Feature', () => {
  it('should do something', () => {
    expect(value).toBe(expected)
  })
})
```

Test files are colocated with source files (e.g., `dna.js` and `dna.test.js`).

## Key Files

- `src/components/SequenceEditor.vue` - Main component (~500 lines), root of all functionality
- `src/utils/dna.js` - Core DNA data structures (Range, Span, Orientation, reverseComplement)
- `src/utils/annotation.js` - Annotation model and color palette
- `src/composables/useEditorState.js` - Central state management
- `src/composables/useSelection.js` - Selection domain logic
- `src/index.js` - Public API exports

## DNA/Biology Specifics

- Full IUPAC ambiguity code support (A, T, G, C, N, R, Y, S, W, K, M, B, D, H, V)
- Complement mapping handles all IUPAC codes
- Translation uses standard genetic code (codon to amino acid)
- CDS (coding sequence) features display amino acid translations

## Common Tasks

### Adding a new component
1. Create `src/components/NewComponent.vue` using `<script setup>`
2. Create `src/components/NewComponent.test.js` with tests
3. Export from `src/index.js` if part of public API

### Adding a new composable
1. Create `src/composables/useNewFeature.js`
2. Create `src/composables/useNewFeature.test.js`
3. Follow reactive pattern with `ref()`, `computed()`

### Working with selections
```javascript
import { useSelection } from './composables/useSelection.js'
const selection = useSelection()
// selection.ranges - array of Range objects
// selection.add(range) - add to selection
// selection.set(range) - replace selection
```

### Working with annotations
```javascript
import { Annotation } from './utils/annotation.js'
import { Span, Range, Orientation } from './utils/dna.js'

const ann = new Annotation({
  span: new Span([new Range(10, 50, Orientation.PLUS)]),
  type: 'CDS',
  label: 'My Gene',
  color: 'blue'
})
```

## Running the Example App

To start the example app for browser testing:

```bash
cd example && bun run dev &
```

The server runs on port 5174 (5173 is used by another project). Use the Playwright MCP tools to interact with the browser:

```javascript
// Navigate to the app
mcp__playwright__browser_navigate({ url: 'http://localhost:5174' })

// Take a snapshot (better than screenshots for accessibility)
mcp__playwright__browser_snapshot()

// Click elements by ref from the snapshot
mcp__playwright__browser_click({ ref: 'E123', element: 'Search button' })
```

## Customization Points

### Custom Tm Calculator

The `tmCalculator` prop accepts a function to customize melting temperature display:

```javascript
<SequenceEditor
  :tm-calculator="myTmCalculator"
/>

// Function signature: (sequence: string) => string | null
function myTmCalculator(sequence) {
  if (!sequence || sequence.length < 10) return null
  const tm = calculateTm(sequence, { salt: 0.05, mg: 0.002 })
  return `Tm (Q5): ${tm}°C`
}
```

Return `null` to hide Tm display, or a formatted string to show.

### Custom Config Panel Sections

The `#config` slot injects content into the gear menu config panel:

```vue
<SequenceEditor>
  <template #config>
    <div class="config-section">
      <span class="config-header">My Setting</span>
      <div class="config-types">
        <label class="type-row">
          <input type="radio" name="setting" value="a">
          <span class="type-name">Option A</span>
        </label>
      </div>
    </div>
  </template>
</SequenceEditor>
```

Use OGP's existing CSS classes (`config-section`, `config-header`, `config-types`, `type-row`, `type-name`) for consistent styling.

### Custom Toolbar Buttons

The `#toolbar` slot adds buttons to the main toolbar:

```vue
<SequenceEditor>
  <template #toolbar>
    <button class="toolbar-button" @click="handleSave">Save</button>
  </template>
</SequenceEditor>
```

### Sequence Alignment Mode

For sequence alignment, use the separate `AlignmentEditor` component. This component is a sibling to `SequenceEditor` and provides a dedicated two-sequence comparison view:

```vue
<AlignmentEditor
  :target="targetDoc"
  :query="queryDoc"
  :extensions="extensions"
/>

<!-- Or conditionally render based on whether query exists -->
<AlignmentEditor
  v-if="queryDoc"
  :target="targetDoc"
  :query="queryDoc"
/>
<SequenceEditor
  v-else
  :sequence="targetDoc"
/>
```

Props:
- `target` (SequenceDocument, required): The main sequence document
- `query` (SequenceDocument, required): The query sequence to align against target
- `initialZoom`, `readonly`, `clipboardBackend`, `extensions`: Same as SequenceEditor

The alignment view shows:
- Side-by-side sequence comparison with gaps
- Match line with `|` for identical bases
- Annotations from both sequences mapped through gap positions
- Selection support with `selection.source` tracking which row ('target' or 'query')
- Edit operations (delete) routed to the correct document based on selection source

#### Displaying Alignment Statistics

Alignment statistics are available via the exposed `alignmentResult` property. To display them, provide an `#info` slot - this will automatically show an info icon (i) in the toolbar that opens a popup with your content when clicked:

```vue
<AlignmentEditor
  ref="editorRef"
  :target="targetDoc"
  :query="queryDoc"
>
  <template #title>
    {{ title }} &mdash; {{ length }} bp (alignment)
  </template>
  <template #info>
    <div class="info-row">
      <span class="info-label">Score:</span>
      <span class="info-value">{{ editorRef?.alignmentResult?.score }}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Identity:</span>
      <span class="info-value">{{ editorRef?.alignmentResult?.identity }}%</span>
    </div>
    <!-- Add more fields as needed -->
  </template>
</AlignmentEditor>
```

The `alignmentResult` object contains:
- `score`: Alignment score
- `identity`: Identity percentage
- `queryStart`, `queryEnd`: Query sequence range
- `targetStart`, `targetEnd`: Target sequence range
- `queryAligned`, `targetAligned`: Aligned sequences with gaps

The info icon only appears when an `#info` slot is provided. See `example/App.vue` for a complete implementation.

To use the alignment function directly:

```javascript
import { align } from 'opengenepool'

const result = align('ATCGATCG', 'ATCGAATCG', {
  match: 2,       // Score for matching bases (default: 2)
  mismatch: -1,   // Penalty for mismatches (default: -1)
  gapOpen: -3,    // Gap opening penalty (default: -3)
  gapExtend: -1   // Gap extension penalty (default: -1)
})

// result = {
//   score: 12,
//   queryStart: 0, queryEnd: 8,
//   targetStart: 0, targetEnd: 9,
//   queryAligned: 'ATCG-ATCG',
//   targetAligned: 'ATCGAATCG',
//   identity: 88.9
// }
```

## Backend Adapter Protocol

Backend adapters must implement these methods (all optional):
- `insertSequence(position, sequence)` - Insert bases
- `deleteSequence(range)` - Delete bases
- `replaceSequence(range, sequence)` - Replace bases
- `addAnnotation(annotation)` - Create annotation
- `updateAnnotation(annotation)` - Update annotation
- `deleteAnnotation(id)` - Delete annotation
- `setMetadata(key, value)` - Update metadata
- `getClipboard()` - Get clipboard content
- `setClipboard(content)` - Set clipboard content

### Insert vs. annotation events (length-preservation contract)

Sequence events (`insert`/`delete`) and annotation events (`annotationCreated`/
`annotationUpdate`/`annotationDeleted`) are **separate channels**. On an `insert`,
the backend is responsible for adjusting annotations from the insert alone — OGP
does not re-report adjustments it expects the backend to infer.

The governing rule: **an insert never changes an annotation's length unless the
insertion site strictly straddles it** (`low < site < high`, which grows it by the
insert length). Equivalently, at a boundary:

- `site === low` (the annotation's start coordinate) → annotation shifts right (both
  ends move); length preserved.
- `site === high` (the annotation's end coordinate) → annotation unchanged.
- `site < low` (entirely before) → shifts right; `site > high` (entirely after) →
  untouched.

This is **geometric and strand-agnostic**: it depends on the low/high coordinates,
not on whether the annotation is forward or reverse, and not on which marker
(`Start`/`End`) happens to sit at a coordinate. A backend that stores annotations as
marker pairs must apply gravity by low/high coordinate, not by marker type.

`annotationUpdate` fires on insert **only** for annotations the caller explicitly
extended (`extendStartIds`/`extendEndIds`) — the one deliberate exception to
length-preservation, which the backend cannot infer from the insert. No extend ids
→ no `annotationUpdate`.

## IMPORTANT NOTE

When applicable, always use TDD for new features or debugging:
- write a failing test (RED)
- apply your proposed fix
- verify that the test now passes (GREEN)