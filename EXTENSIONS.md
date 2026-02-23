# OpenGenePool Extensions

Extensions add functionality to the SequenceEditor through toolbar buttons, overlay panels, and (in the future) graphical overlays.

## Available Extensions

### SearchExtension

DNA sequence search with IUPAC ambiguity code support and reverse complement matching.

```javascript
import { SequenceEditor, SearchExtension } from 'opengenepool'

<SequenceEditor
  :sequence="dnaSequence"
  :extensions="[SearchExtension]"
/>
```

**Features:**
- Toolbar button with magnifying glass icon
- Overlay panel with search input
- Forward and reverse complement matching
- IUPAC ambiguity code support (N, R, Y, S, W, K, M, B, D, H, V)
- Match navigation (previous/next)
- Pre-fills search with current selection when opened
- Auto-closes when selection changes externally

### ORFFinderExtension

Scans all six reading frames for open reading frames (ORFs).

```javascript
import { SequenceEditor, ORFFinderExtension } from 'opengenepool'

<SequenceEditor
  :sequence="dnaSequence"
  :extensions="[ORFFinderExtension]"
/>
```

**Features:**
- Toolbar button to open ORF finder panel
- Scans all 6 reading frames (3 forward, 3 reverse complement)
- Configurable minimum length filter (default 50 amino acids)
- Results displayed in GenBank notation, clickable to select
- Matches ORFs against existing CDS annotations to show their names
- Custom modal for naming and creating new CDS annotations from ORFs

### BlastExtension

Context menu integration for NCBI BLAST searches.

```javascript
import { SequenceEditor, BlastExtension } from 'opengenepool'

<SequenceEditor
  :sequence="dnaSequence"
  :extensions="[BlastExtension]"
/>
```

**Features:**
- Adds "BLAST (DNA)" to context menu for selections and annotations
- Adds "BLAST (Protein)" to context menu for CDS translations
- Opens NCBI BLAST in a new browser tab with the sequence pre-filled
- No toolbar button or panel (context menu only)

### RestrictionExtension

Restriction enzyme cut site analysis and visualization.

```javascript
import { SequenceEditor, RestrictionExtension } from 'opengenepool'

<SequenceEditor
  :sequence="dnaSequence"
  :extensions="[RestrictionExtension]"
/>
```

**Features:**
- Toolbar button to toggle restriction site visibility
- Panel with 25+ common restriction enzymes (BamHI, EcoRI, HindIII, etc.)
- Real-time cut site detection with count display
- Filter controls:
  - Toggle to show/hide 0-cutters (enzymes with no sites in sequence)
  - Dropdown to filter by cut count (1-cutters, 2-cutters, 3+)
- Search by enzyme name or recognition sequence
- Select All / Clear All buttons
- Recognition sequences displayed with cut position markers (ᵛ top strand, ‸ bottom strand)
- **Linear view**: T-bar markers above sequence at cut positions
- **Circular view**: Leader lines with horizontal labels, annotation-aware positioning, global relaxation for overlap resolution
- Dynamic zoom constraints to keep labels on screen

## Using Extensions

Pass an array of extension objects to the `extensions` prop:

```javascript
import { SearchExtension } from 'opengenepool'

// Single extension
<SequenceEditor :extensions="[SearchExtension]" />

// Multiple extensions
<SequenceEditor :extensions="[SearchExtension, MyCustomExtension]" />

// No extensions (default)
<SequenceEditor :extensions="[]" />
```

## Extension Interface

Extensions are plain objects with the following structure:

```javascript
{
  id: 'my-extension',           // Unique identifier (required)
  name: 'My Extension',         // Display name (required)
  toolbarButton: MyButton,      // Vue component for toolbar (optional)
  panel: MyPanel,               // Vue component for overlay panel (optional)
  contextMenuItems: (context, api) => [],  // Context menu items (optional)
  graphicsLayer: MyLinearLayer,            // Vue component for linear view overlay (optional)
  circularGraphicsLayer: MyCircularLayer   // Vue component for circular view overlay (optional)
}
```

### Toolbar Buttons

Toolbar button components are rendered in the toolbar area, before the toolbar slot content. They should be small icon buttons that trigger extension functionality.

### Panels

Panel components are rendered after the main editor content as overlay elements. They can be modal dialogs, floating panels, or any other UI that should appear above the editor.

### Context Menu Items

Extensions can add items to context menus by providing a `contextMenuItems` function. This function receives context about what was right-clicked and returns an array of menu items.

```javascript
{
  id: 'my-extension',
  name: 'My Extension',
  contextMenuItems: (context, extensionAPI) => {
    // context.type: 'selection' | 'annotation' | 'translation' | 'handle' | 'sequence'
    // context.data: relevant data for that context type

    if (context.type === 'selection') {
      return [{
        label: 'Process Selection',
        action: () => {
          const sequence = context.data.sequence
          // Do something with the selected sequence
        }
      }]
    }

    return []  // Return empty array for contexts you don't handle
  }
}
```

**Context Types:**

| Type | When | Data Provided |
|------|------|---------------|
| `sequence` | Right-click on sequence background | `{ position: number }` |
| `selection` | Right-click on highlighted selection | `{ sequence: string, domain: SelectionDomain }` |
| `annotation` | Right-click on annotation bar | `{ annotation: object, sequence: string, fragment: object }` |
| `translation` | Right-click on amino acid (CDS) | `{ translation: string, annotation: object }` |
| `handle` | Right-click on selection handle | `{ range: Range, position: 'start' \| 'end' \| 'cursor' }` |

**Menu Item Format:**

```javascript
{
  label: 'Menu Item Text',    // Displayed text
  action: () => { ... }       // Function called when clicked
}
```

Extension items appear in a separate section at the end of the context menu, separated by a divider.

**Example: BLAST Extension**

```javascript
export const BlastExtension = {
  id: 'blast',
  name: 'NCBI BLAST',
  contextMenuItems: (context) => {
    if (context.type === 'translation') {
      return [{
        label: 'BLAST (Protein)',
        action: () => {
          const url = `https://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=blastp&QUERY=${context.data.translation}`
          window.open(url, '_blank')
        }
      }]
    }

    if (context.type === 'selection' && context.data.sequence) {
      return [{
        label: 'BLAST (DNA)',
        action: () => {
          const url = `https://blast.ncbi.nlm.nih.gov/Blast.cgi?PROGRAM=blastn&QUERY=${context.data.sequence}`
          window.open(url, '_blank')
        }
      }]
    }

    return []
  }
}
```

## Extension API

Extension components receive the editor API via Vue's provide/inject:

```javascript
import { inject } from 'vue'

const extensionAPI = inject('extensionAPI')
```

### Available Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getSequence()` | `string` | Get the current DNA sequence |
| `getSelectedSequence()` | `string` | Get the selected sequence text (orientation-aware) |
| `getAnnotations()` | `array` | Get all annotations in the editor |
| `setSelection(spec)` | `void` | Set selection using span notation (`'10..20'`, `'(10..20)'`, etc.) |
| `clearSelection()` | `void` | Clear the current selection |
| `scrollToPosition(pos)` | `void` | Scroll to make a position visible |
| `addAnnotation(data)` | `void` | Create a new annotation (`{ span, type, label, color?, attributes? }`) |
| `onSelectionChange(handler)` | `() => void` | Subscribe to selection changes; returns unsubscribe function |

### Example: Custom Extension

```javascript
// extensions/MyExtension/index.js
import { ref } from 'vue'
import MyButton from './MyButton.vue'
import MyPanel from './MyPanel.vue'

// Shared state between button and panel
export const panelVisible = ref(false)

export const MyExtension = {
  id: 'my-extension',
  name: 'My Extension',
  toolbarButton: MyButton,
  panel: MyPanel
}
```

```vue
<!-- extensions/MyExtension/MyButton.vue -->
<script setup>
import { BeakerIcon } from '@heroicons/vue/24/outline'
import { panelVisible } from './index.js'

function toggle() {
  panelVisible.value = !panelVisible.value
}
</script>

<template>
  <button class="toolbar-icon-btn" @click="toggle" title="My Extension">
    <BeakerIcon class="toolbar-icon" />
  </button>
</template>

<style scoped>
.toolbar-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  color: #666;
  cursor: pointer;
}

.toolbar-icon-btn:hover {
  background: #f0f0f0;
  color: #333;
}

.toolbar-icon {
  width: 18px;
  height: 18px;
}
</style>
```

```vue
<!-- extensions/MyExtension/MyPanel.vue -->
<script setup>
import { inject, onMounted, onUnmounted } from 'vue'
import { panelVisible } from './index.js'

const extensionAPI = inject('extensionAPI')

function doSomething() {
  const sequence = extensionAPI.getSequence()
  // Process sequence...
  extensionAPI.setSelection('100..200')
}

// Subscribe to selection changes
let unsubscribe = null

onMounted(() => {
  unsubscribe = extensionAPI.onSelectionChange(() => {
    // React to selection changes
  })
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <div v-if="panelVisible" class="my-panel">
    <h3>My Extension</h3>
    <button @click="doSomething">Do Something</button>
  </div>
</template>

<style scoped>
.my-panel {
  position: absolute;
  top: 60px;
  right: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  padding: 16px;
  z-index: 1000;
}
</style>
```

## Graphics Layers

Extensions can render custom graphics in both linear and circular sequence views by providing Vue components:

- **`graphicsLayer`** - Rendered in the linear sequence view SVG
- **`circularGraphicsLayer`** - Rendered in the circular plasmid view SVG

### Linear Graphics Layer

Linear graphics layers receive injected state via Vue's provide/inject:

```javascript
import { inject } from 'vue'

const editorState = inject('editorState')  // Sequence, zoom, cursor state
const graphics = inject('graphics')         // Layout metrics and line geometry
```

The `graphics` object provides:
- `getLineY(lineIndex)` - Y position for a line
- `basesPerLine` - Current zoom level
- `lineHeight`, `charWidth` - Layout dimensions
- `setLineExtraHeight(line, pixels, sourceId)` - Request extra space above a line

### Circular Graphics Layer

Circular graphics layers receive:

```javascript
const editorState = inject('editorState')
const circularGraphics = inject('circularGraphics')
const circularAnnotations = inject('circularAnnotations')  // For annotation-aware positioning
```

The `circularGraphics` object provides:
- `positionToAngle(position)` - Convert sequence position to angle
- `positionToCartesian(position, radius)` - Convert to x,y coordinates
- `backboneRadius`, `centerX`, `centerY` - Circle geometry
- `getRowRadius(rowIndex)` - Radius for annotation row
- `setExtensionRadialSpace(sourceId, pixels)` - Register radial space for zoom constraints

### Example: Restriction Sites (simplified)

```vue
<script setup>
import { inject, computed } from 'vue'
import { cutSites, restrictionSitesVisible } from './state.js'

const circularGraphics = inject('circularGraphics')

const markers = computed(() => {
  if (!restrictionSitesVisible.value) return []

  return cutSites.value.map(site => {
    const angle = circularGraphics.positionToAngle(site.position)
    const point = circularGraphics.positionToCartesian(
      site.position,
      circularGraphics.backboneRadius.value
    )
    return { ...site, angle, point }
  })
})
</script>

<template>
  <g class="restriction-markers">
    <circle
      v-for="marker in markers"
      :key="marker.id"
      :cx="marker.point.x"
      :cy="marker.point.y"
      r="3"
      fill="red"
    />
  </g>
</template>
```

## Best Practices

1. **Use shared refs for state** - Export reactive refs from your extension's index.js for communication between button and panel components

2. **Clean up subscriptions** - Always unsubscribe from events in `onUnmounted`

3. **Handle missing API gracefully** - Extensions may be used in contexts where the API isn't available:
   ```javascript
   const extensionAPI = inject('extensionAPI', null)
   if (!extensionAPI) return
   ```

4. **Use scoped styles** - Avoid style conflicts with the editor

5. **Keep toolbar buttons small** - Use 18x18px icons, minimal padding

6. **Position panels thoughtfully** - Use `position: absolute` with appropriate z-index, avoid blocking key editor areas
