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
  panel: MyPanel                // Vue component for overlay panel (optional)
}
```

### Toolbar Buttons

Toolbar button components are rendered in the toolbar area, before the toolbar slot content. They should be small icon buttons that trigger extension functionality.

### Panels

Panel components are rendered after the main editor content as overlay elements. They can be modal dialogs, floating panels, or any other UI that should appear above the editor.

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
| `setSelection(spec)` | `void` | Set selection using span notation (`'10..20'`, `'(10..20)'`, etc.) |
| `clearSelection()` | `void` | Clear the current selection |
| `scrollToPosition(pos)` | `void` | Scroll to make a position visible |
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

## Future: Graphics API

Extensions will be able to render custom graphics in the sequence view (planned for future releases). This will enable:

- **Restriction enzyme cut sites** - Visual markers at recognition sequences
- **Primer binding sites** - Arrows showing primer annealing positions
- **Custom annotations** - Application-specific visual overlays
- **Interactive markers** - Clickable/hoverable graphical elements

The graphics API will provide access to:

```javascript
// Planned API (not yet implemented)
const graphicsAPI = inject('graphicsAPI')

graphicsAPI.addOverlay({
  id: 'my-overlay',
  render: (ctx, metrics) => {
    // Draw using canvas-like API or return SVG elements
  }
})

graphicsAPI.removeOverlay('my-overlay')
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
