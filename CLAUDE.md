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

## Directory Structure

```
src/
├── components/      # 23 Vue SFC components
├── composables/     # 7 Vue 3 composables for state management
├── utils/           # Utility modules (dna.js, annotation.js, translation.js, circular.js)
├── backends/        # Backend adapters (readonly, IndexedDB)
└── index.js         # Public exports
test/                # Test setup (preload config, Vue SFC compiler)
example/             # Working example app with GenBank import/export
```

## Key Architecture Patterns

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
const ann = new Annotation({
  span: '10..50',        // or Span object
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
