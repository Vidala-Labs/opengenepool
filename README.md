# OpenGenePool

[![CI](https://github.com/Vidala-Labs/opengenepool/actions/workflows/ci.yml/badge.svg)](https://github.com/Vidala-Labs/opengenepool/actions/workflows/ci.yml)

A Vue.js DNA sequence editor component for viewing and editing genetic sequences with professional annotation support.

## Features

### Views
- **Linear View** - Sequence display with configurable zoom, position labels, and automatic line wrapping
- **Circular View** - Plasmid visualization with draggable origin, zoom control, and origin-spanning selection support

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
- **Backend Adapter** - Optional server communication for edits and annotation changes
- **Extensions** - Plugin system for extra functionality (see [EXTENSIONS.md](EXTENSIONS.md))
- **Toolbar Slot** - Inject custom toolbar content from parent application
- **Exposed API** - Methods for programmatic control (setSelection, scrollToPosition, etc.)
- **Event System** - Comprehensive events for selection, editing, and annotation interactions

## Installation

```bash
npm install opengenepool
```

## Quick Start

```vue
<template>
  <SequenceEditor
    :sequence="dnaSequence"
    :annotations="annotations"
    @edit="handleEdit"
  />
</template>

<script setup>
import { SequenceEditor } from 'opengenepool'

const dnaSequence = 'ATCGATCG...'
const annotations = [
  { id: '1', caption: 'Gene A', type: 'gene', span: '0..500' },
  { id: '2', caption: 'Promoter', type: 'promoter', span: '(500..600)' }
]
</script>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `sequence` | String | `''` | DNA sequence (ATCGNRYSWKMBDHV) |
| `title` | String | `''` | Sequence name displayed in toolbar |
| `annotations` | Array | `[]` | Array of annotation objects |
| `metadata` | Object | `{}` | Sequence metadata (circular, molecule_type, etc.) |
| `initialZoom` | Number | `100` | Bases per line |
| `readonly` | Boolean | `false` | Disable all editing operations |
| `showAnnotationCaptions` | Boolean | `true` | Show labels on annotations |
| `backend` | Object | `null` | Backend adapter for server communication |
| `extensions` | Array | `[]` | Extension objects (see [EXTENSIONS.md](EXTENSIONS.md)) |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `edit` | `{ type, text, position }` | Sequence was modified (insert/delete/cut) |
| `select` | `{ start, end, sequence }` | Selection changed |
| `annotation-click` | `{ annotation, event }` | Annotation clicked |
| `annotation-contextmenu` | `{ annotation, event }` | Annotation right-clicked |
| `annotations-update` | `Array<Annotation>` | Annotations changed (standalone mode) |
| `ready` | - | Component initialized |

## Slots

### `#toolbar`

Inject custom content into the toolbar (appears left of help/settings buttons):

```vue
<SequenceEditor :sequence="seq" :metadata="metadata">
  <template #toolbar>
    <button @click="cloneConstruct">Clone</button>
    <button v-if="metadata.circular" @click="rotateOrigin">Rotate Origin</button>
  </template>
</SequenceEditor>
```

## Public Methods

Access via template ref:

```vue
<SequenceEditor ref="editor" />
```

```javascript
// Selection
editor.setSelection('10..20')           // Single range
editor.setSelection('10..20 + 30..40')  // Multi-range
editor.setSelection('a:annotation-id')  // Select annotation's span
editor.getSelection()                   // → { start, end } | null
editor.clearSelection()

// Navigation
editor.setCursor(100)
editor.scrollToPosition(500)

// Sequence
editor.setSequence('ATCG...', 'New Title')
editor.getSequence()

// Zoom
editor.setZoom(200)

// Modals
editor.openMetadataModal()
```

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

**Note:** GenBank-style indefinite ranges (`<100..200`, `100..>200`) are not currently supported.

## Backend Adapter

For server-side persistence, provide a backend object with async handlers:

```javascript
const backend = {
  // Sequence editing
  async insert({ id, position, text }) { /* ... */ },
  async delete({ id, start, end }) { /* ... */ },

  // Annotation management
  async annotationCreated({ id, caption, type, span, attributes }) { /* ... */ },
  async annotationUpdated({ id, annotationId, ...fields }) { /* ... */ },
  async annotationDeleted({ id, annotationId }) { /* ... */ },

  // Metadata
  async titleUpdate({ id, title }) { /* ... */ },

  // Clipboard (optional) - intercept copy/paste operations
  async copy({ text, selection }) { /* ... */ },  // Called on Ctrl+C / copy
  async paste() { /* return text */ }             // Called on Ctrl+V / paste
}
```

### Clipboard Hooks

The `copy` and `paste` methods are optional. If not provided, the editor uses the system clipboard directly.

**copy({ text, selection })** - Called when the user copies. Receives:
- `text` - The selected sequence text (with proper orientation handling)
- `selection` - The SelectionDomain object with range details

**paste()** - Called when the user pastes. Should return the text to insert, or `null`/`undefined` to cancel.

Use cases:
- Server-side clipboard for cross-session persistence
- Sequence validation/transformation before paste
- Analytics/logging of clipboard operations

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
```

## Support

If you find OpenGenePool useful, consider supporting development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/vidalalabs)

## License

See [LICENCE.txt](LICENCE.txt)
