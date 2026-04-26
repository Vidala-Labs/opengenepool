<script setup>
import { ref, useSlots } from 'vue'
import { Cog6ToothIcon, QuestionMarkCircleIcon, InformationCircleIcon } from '@heroicons/vue/24/outline'

const slots = useSlots()
const infoPopupVisible = ref(false)

function toggleInfoPopup() {
  infoPopupVisible.value = !infoPopupVisible.value
}

function closeInfoPopup() {
  infoPopupVisible.value = false
}

const props = defineProps({
  zoomLevel: {
    type: Number,
    required: true
  },
  availableZooms: {
    type: Array,
    default: () => []
  },
  titleVisible: {
    type: Boolean,
    default: true
  },
  showZoom: {
    type: Boolean,
    default: true
  },
  showViewModeToggle: {
    type: Boolean,
    default: false
  },
  viewMode: {
    type: String,
    default: 'linear'
  },
  helpText: {
    type: String,
    default: ''
  },
  configPanelOpen: {
    type: Boolean,
    default: false
  },
  extensions: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'zoom-change',
  'update:viewMode',
  'toggle-config'
])

function handleZoomChange(event) {
  emit('zoom-change', Number(event.target.value))
}

function toggleConfigPanel() {
  emit('toggle-config')
}
</script>

<template>
  <div class="toolbar">
    <label v-if="showZoom" class="zoom-control">
      Zoom:
      <select :value="zoomLevel" @change="handleZoomChange">
        <option
          v-for="opt in availableZooms"
          :key="opt.value"
          :value="opt.value"
        >
          {{ opt.label }}
        </option>
      </select>
    </label>

    <span v-if="titleVisible" class="info">
      <slot name="title" />
      <button
        v-if="slots.info"
        class="info-button"
        title="Show info"
        @click="toggleInfoPopup"
      >
        <InformationCircleIcon class="icon-toolbar-sm" />
      </button>
    </span>

    <div v-if="showViewModeToggle" class="view-mode-toggle">
      <button
        :class="['view-mode-btn', { active: viewMode === 'linear' }]"
        @click="emit('update:viewMode', 'linear')"
        title="Linear view"
      >
        Linear
      </button>
      <button
        :class="['view-mode-btn', { active: viewMode === 'circular' }]"
        @click="emit('update:viewMode', 'circular')"
        title="Circular view"
      >
        Circular
      </button>
    </div>

    <div class="toolbar-spacer"></div>

    <component
      v-for="ext in props.extensions.filter(e => e.toolbarButton)"
      :key="ext.id"
      :is="ext.toolbarButton"
    />

    <slot name="toolbar" />

    <button
      class="help-button"
      :title="helpText"
    >
      <QuestionMarkCircleIcon class="icon-toolbar-lg" />
    </button>

    <div class="config-container">
      <button class="config-button" @click.stop="toggleConfigPanel" title="Settings">
        <Cog6ToothIcon class="icon-toolbar-lg" />
      </button>

      <div v-if="configPanelOpen" class="config-panel" @click.stop>
        <slot name="config" />
      </div>
    </div>

    <!-- Info Popup -->
    <div v-if="infoPopupVisible && slots.info" class="info-popup-overlay" @click="closeInfoPopup">
      <div class="info-popup" @click.stop>
        <div class="info-popup-header">
          <h3>Info</h3>
          <button class="info-popup-close" @click="closeInfoPopup">&times;</button>
        </div>
        <div class="info-popup-content">
          <slot name="info" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #ddd;
  background: #f8f8f8;
  align-items: center;
  flex-shrink: 0;
}

.zoom-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.zoom-control select {
  padding: 0.25rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  background: white;
}

.toolbar-spacer {
  flex: 1;
}

.help-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  background: transparent;
  color: #6b7280;
  cursor: help;
  transition: all 0.15s;
}

.help-button:hover {
  background: #f3f4f6;
  color: #374151;
}

.config-container {
  position: relative;
}

.config-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;
}

.config-button:hover {
  background: #f3f4f6;
  color: #374151;
}

.config-panel {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  min-width: 200px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 0.75rem;
  z-index: 1000;
}

.view-mode-toggle {
  display: flex;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  overflow: hidden;
}

.view-mode-btn {
  padding: 0.375rem 0.75rem;
  border: none;
  background: white;
  color: #6b7280;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.15s;
}

.view-mode-btn:hover {
  background: #f9fafb;
}

.view-mode-btn.active {
  background: #3b82f6;
  color: white;
}

.view-mode-btn:first-child {
  border-right: 1px solid #d1d5db;
}

.icon-toolbar-lg {
  width: 1.25rem;
  height: 1.25rem;
}

.icon-toolbar-sm {
  width: 1rem;
  height: 1rem;
}

.info-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  margin-left: 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #666;
  cursor: pointer;
  vertical-align: middle;
}

.info-button:hover {
  background: #e5e7eb;
  color: #333;
}

/* Info Popup */
.info-popup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.info-popup {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  min-width: 300px;
  max-width: 500px;
}

.info-popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.info-popup-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.info-popup-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  line-height: 1;
  padding: 0;
}

.info-popup-close:hover {
  color: #333;
}

.info-popup-content {
  padding: 16px;
}

@media (max-width: 768px) {
  .toolbar {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .toolbar-spacer {
    display: none;
  }

  .zoom-control {
    font-size: 0.875rem;
  }

  .view-mode-toggle {
    order: 10;
  }

  .help-button {
    margin-left: auto;
  }
}
</style>
