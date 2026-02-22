<script setup>
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  /** Whether the menu is visible */
  visible: {
    type: Boolean,
    default: false
  },
  /** X position (left) */
  x: {
    type: Number,
    default: 0
  },
  /** Y position (top) */
  y: {
    type: Number,
    default: 0
  },
  /** Array of menu items */
  items: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close'])

const menuRef = ref(null)
const adjustedY = ref(0)
const adjustedX = ref(0)

// Adjust position when menu becomes visible or position changes
async function adjustPosition() {
  // Start at the requested position
  adjustedY.value = props.y
  adjustedX.value = props.x

  // Wait for render, then check bounds
  await nextTick()
  if (menuRef.value) {
    const rect = menuRef.value.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const margin = 8

    // Nudge up if extending past bottom
    if (rect.bottom > viewportHeight - margin) {
      adjustedY.value = viewportHeight - rect.height - margin
    }

    // Nudge left if extending past right edge
    if (rect.right > viewportWidth - margin) {
      adjustedX.value = viewportWidth - rect.width - margin
    }
  }
}

watch(() => props.visible, (visible) => {
  if (visible) {
    adjustPosition()
  }
}, { immediate: true })

// Also adjust when position props change while visible
watch(() => [props.x, props.y], () => {
  if (props.visible) {
    adjustPosition()
  }
})

// Handle menu item click
function handleItemClick(item) {
  if (item.disabled) return
  if (item.separator) return

  if (item.action) {
    item.action()
  }

  emit('close')
}

// Handle keyboard events
function handleKeyDown(event) {
  if (event.key === 'Escape') {
    emit('close')
  }
}

// Handle backdrop click
function handleBackdropClick() {
  emit('close')
}

// Computed style for positioning
const menuStyle = computed(() => ({
  left: `${adjustedX.value}px`,
  top: `${adjustedY.value}px`
}))
</script>

<template>
  <div v-if="visible">
    <!-- Invisible backdrop to catch clicks outside -->
    <div class="context-menu-backdrop" @click="handleBackdropClick" @contextmenu.prevent="handleBackdropClick"></div>

    <!-- The actual menu -->
    <div
      ref="menuRef"
      class="context-menu"
      :style="menuStyle"
      tabindex="0"
      @keydown="handleKeyDown"
      @contextmenu.prevent
    >
      <!-- Empty state -->
      <div v-if="items.length === 0" class="menu-empty">
        No actions available
      </div>

      <!-- Menu items -->
      <template v-for="(item, index) in items" :key="index">
        <!-- Separator -->
        <div v-if="item.separator" class="menu-separator">
          <hr />
        </div>

        <!-- Regular menu item -->
        <div
          v-else
          :class="['menu-item', { disabled: item.disabled }]"
          @click="handleItemClick(item)"
        >
          {{ item.label }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.context-menu-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
}

.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 150px;
  max-width: 300px;
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  padding: 4px 0;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
}

.context-menu:focus {
  outline: none;
}

.menu-item {
  padding: 6px 12px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-item:hover {
  background: #f0f0f0;
}

.menu-item.disabled {
  color: #999;
  cursor: default;
}

.menu-item.disabled:hover {
  background: transparent;
}

.menu-separator {
  margin: 4px 0;
}

.menu-separator hr {
  border: none;
  border-top: 1px solid #ddd;
  margin: 0;
}

.menu-empty {
  padding: 8px 12px;
  color: #999;
  font-style: italic;
}
</style>
