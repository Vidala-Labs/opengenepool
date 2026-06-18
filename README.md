# OpenGenePool

[![CI](https://github.com/Vidala-Labs/opengenepool/actions/workflows/ci.yml/badge.svg)](https://github.com/Vidala-Labs/opengenepool/actions/workflows/ci.yml)

A Vue.js DNA sequence editor component library for viewing, editing, and annotating genetic sequences with professional annotation support.

## Features

### Views
- **Linear View** - Sequence display with configurable zoom, position labels, and automatic line wrapping
- **Circular View** - Plasmid visualization with draggable origin, zoom control, and origin-spanning selection support
- **Alignment View** - Side-by-side sequence comparison with Smith-Waterman alignment

### Selection
- **Multi-range Selection** - Select multiple non-contiguous regions with independent strand orientation
- **Keyboard Navigation** - Arrow keys, Home/End, Shift+Arrow to extend
- **Mouse Interactions** - Click, drag, Shift+Click (extend), Ctrl+Click (add range)
- **Selection Status** - Real-time GenBank notation display

### Editing
- **Insert/Replace/Delete** - Modal dialogs for sequence modification
- **Clipboard Support** - Cut, copy, paste with Ctrl+X/C/V
- **Direct Input** - Type DNA bases to insert at cursor
- **IUPAC Codes** - Full ambiguity code support (N, R, Y, S, W, K, M, B, D, H, V)

### Annotations
- **Visual Display** - Color-coded arrows with automatic stacking for overlaps
- **Multi-range Support** - Annotations can span non-contiguous regions (join notation)
- **CRUD Operations** - Create, edit, delete via context menu
- **Type Filtering** - Show/hide annotation types with custom colors (persisted)
- **CDS Translation** - Automatic amino acid display for coding sequences

### Developer Features
- **SequenceDocument** - Reactive document model for sequence and annotations
- **AlignmentEditor** - Dedicated component for sequence alignment comparison
- **Extensions** - Plugin system for extra functionality (see [EXTENSIONS.md](EXTENSIONS.md))
- **Customizable Slots** - Title, toolbar, and config panel customization
- **Exposed API** - Methods for programmatic control (setSelection, scrollToPosition, etc.)
- **Event System** - Comprehensive events for selection, editing, and annotation interactions
- **Pluggable IDs** - `setUuidGenerator(fn)` overrides how new annotation IDs are
  minted (sync or async, e.g. a server-synchronized UUIDv7 round-trip); defaults to
  a guarded `crypto.randomUUID()`

## Installation

OpenGenePool is **not published to npm**. Install it directly from GitHub, pinned
to a specific commit so your build is reproducible:

```bash
npm install github:vidala-labs/opengenepool#12faa94
```

Or pin it in `package.json`:

```json
{
  "dependencies": {
    "opengenepool": "github:vidala-labs/opengenepool#12faa94"
  }
}
```

Replace `12faa94` with the commit hash you want to track. Pin to a full hash (not a
branch) so upstream changes never silently alter your build.

To run the bundled demo app instead of integrating the library, see
[Development](#development) / the `example/` directory.

### Requirements

OpenGenePool ships as **raw ESM source** (no precompiled `dist/`). The package
entrypoint (`opengenepool` → `src/index.js`) re-exports Vue Single-File
Components (`.vue`), and at runtime it loads a Web Worker and a WASM module via
`new URL('./…', import.meta.url)`. Consuming it therefore requires a bundler that
can compile `.vue` files and resolve worker/asset URLs — **Vite** (or an
equivalent Vue + ESM toolchain such as a suitably configured webpack 5). It is not
consumable from plain Node without such a build step. The Web Worker and WASM both
degrade gracefully: if your bundler can't build them, alignment falls back to the
main thread / the pure-JS implementation.

## Quick Start

```vue
<template>
  <SequenceEditor
    :sequence="doc"
    @edit="handleEdit"
  />
</template>

<script setup>
import { SequenceEditor, SequenceDocument, Span, Range, Orientation } from 'opengenepool'

const doc = new SequenceDocument({
  sequence: 'ATCGATCG...',
  annotations: [
    { id: '1', label: 'Gene A', type: 'gene', span: new Span([new Range(0, 500, Orientation.PLUS)]) },
    { id: '2', label: 'Promoter', type: 'promoter', span: new Span([new Range(500, 600, Orientation.MINUS)]) }
  ],
  circular: true
})

function handleEdit(data) {
  console.log('Edit:', data)
}
</script>
```

## Components

### SequenceEditor

The main component for viewing and editing a single sequence.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `sequence` | SequenceDocument | required | Document containing sequence, annotations, and metadata |
| `initialZoom` | Number | `100` | Bases per line |
| `readonly` | Boolean | `false` | Disable all editing operations |
| `clipboardBackend` | Object | `null` | Custom clipboard handler |
| `extensions` | Array | `[]` | Extension objects (see [EXTENSIONS.md](EXTENSIONS.md)) |
| `tmCalculator` | Function | `null` | Custom melting temperature calculator |

#### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `edit` | `{ type, ranges, to }` | Sequence was modified |
| `select` | `{ start, end, sequence }` | Selection changed |
| `annotations-update` | `Array<Annotation>` | Annotations changed |
| `ready` | - | Component initialized |

### AlignmentEditor

A dedicated component for comparing two sequences with Smith-Waterman alignment.

```vue
<template>
  <AlignmentEditor
    v-if="queryDoc"
    ref="alignmentRef"
    :target="targetDoc"
    :query="queryDoc"
  >
    <template #title>
      {{ name }} (alignment)
    </template>
    <template #info>
      <!-- Info icon appears automatically when this slot is provided -->
      <div>Score: {{ alignmentRef?.alignmentResult?.score }}</div>
      <div>Identity: {{ alignmentRef?.alignmentResult?.identity }}%</div>
    </template>
  </AlignmentEditor>
  <SequenceEditor v-else :sequence="targetDoc" />
</template>

<script setup>
import { ref } from 'vue'
import { AlignmentEditor, SequenceEditor, SequenceDocument } from 'opengenepool'

const alignmentRef = ref(null)
</script>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `target` | SequenceDocument | required | The main sequence document |
| `query` | SequenceDocument | required | The sequence to align against target |
| `initialZoom` | Number | `100` | Bases per line |
| `readonly` | Boolean | `false` | Disable editing |
| `clipboardBackend` | Object | `null` | Custom clipboard handler |
| `extensions` | Array | `[]` | Extension objects |

#### Exposed Properties

Access via template ref:

- `alignmentResult` - Alignment statistics (score, identity, ranges, aligned sequences)
- `selection` - Selection state with `source` tracking ('target' or 'query')
- `targetDoc`, `queryDoc` - The document instances

## Slots

### `#title`

Customize the title display in the toolbar:

```vue
<SequenceEditor :sequence="doc">
  <template #title>
    <strong>{{ doc.name }}</strong> &mdash; {{ doc.sequence.length }} bp
  </template>
</SequenceEditor>
```

### `#info`

Provide content for an info popup. When this slot is provided, an info icon (i) automatically appears next to the title. Clicking it opens a popup with your content:

```vue
<SequenceEditor :sequence="doc">
  <template #info>
    <div>Molecule Type: {{ metadata.molecule_type }}</div>
    <div>Organism: {{ metadata.organism }}</div>
  </template>
</SequenceEditor>
```

### `#toolbar`

Inject custom buttons into the toolbar:

```vue
<SequenceEditor :sequence="doc">
  <template #toolbar>
    <button @click="saveAs">Save As</button>
    <button @click="download">Download</button>
  </template>
</SequenceEditor>
```

### `#config`

Add custom sections to the settings panel:

```vue
<SequenceEditor :sequence="doc">
  <template #config>
    <div class="config-section">
      <span class="config-header">My Settings</span>
      <div class="config-types">
        <label class="type-row">
          <input type="checkbox" v-model="myOption">
          <span class="type-name">Enable Feature</span>
        </label>
      </div>
    </div>
  </template>
</SequenceEditor>
```

## SequenceDocument

A reactive document model that encapsulates sequence data, annotations, and edit operations.

```javascript
import { SequenceDocument } from 'opengenepool'

const doc = new SequenceDocument({
  sequence: 'ATCGATCG',
  annotations: [...],
  circular: false,
  name: 'My Sequence'
})

// Reactive properties
doc.sequence        // The DNA sequence string
doc.annotations     // Array of annotations
doc.circular        // Boolean for circular/linear
doc.sequenceRef     // Vue ref for reactivity tracking

// Edit operations (mutate the document)
doc.insert(position, bases)
doc.delete([{ start, end }, ...])
doc.replace(start, end, newBases)
```

## Alignment Function

Use the alignment algorithm directly:

```javascript
import { align } from 'opengenepool'

const result = align('ATCGATCG', 'ATCGAATCG', {
  match: 2,       // Score for matching bases (default: 2)
  mismatch: -1,   // Penalty for mismatches (default: -1)
  gapOpen: -3,    // Gap opening penalty (default: -3)
  gapExtend: -1,  // Gap extension penalty (default: -1)
  // circular: true,             // detect a rotated origin (plasmids)
  // tryReverseComplement: true  // also try the antisense query strand
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

With `{ tryReverseComplement: true }`, `align` aligns both strands of the query
and keeps the higher-scoring orientation, tagging the result with
`reverseComplement: true | false`. This composes with `{ circular: true }`, which
detects a rotated linearization origin (common for plasmids) before aligning.
The `AlignmentEditor` enables both automatically: when the query matches only on
the antisense strand, it shows a reverse-complement badge, displays the query row
in the matching orientation with true (descending) coordinates, and round-trips
edits back to the original query document.

## Coordinate System

OpenGenePool uses **fenced coordinates** (0-based, half-open intervals):

```
Sequence:   A  T  C  G  A  T
Position:  0  1  2  3  4  5  6
```

- `0..3` = bases at positions 0, 1, 2 (length 3)
- `0..0` = cursor at start (length 0)

### Strand Notation

| Format | Meaning |
|--------|---------|
| `10..20` | Plus strand (forward) |
| `(10..20)` | Minus strand (reverse complement) |
| `10..20 + 30..40` | Multi-range (join) |

Ranges are always specified start ≤ end, regardless of strand.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+A | Select all |
| Ctrl+C | Copy selection |
| Ctrl+V | Paste |
| Escape | Clear selection |
| Delete/Backspace | Delete selection |

## Development

```bash
bun install
bun test
bun test --watch

# Run example app
cd example && bun run dev
```

## Support

If you find OpenGenePool useful, consider supporting development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/vidalalabs)

## License

See [LICENCE.txt](LICENCE.txt)
