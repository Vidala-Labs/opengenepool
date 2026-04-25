<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  sequences: {
    type: Array,
    default: () => []
  },
  selectedId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['select', 'upload', 'delete', 'align'])

// Context menu state
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuSequenceId = ref(null)

const fileInput = ref(null)

const selectedSequence = computed(() =>
  props.sequences.find(s => s.id === props.selectedId)
)

function selectSequence(id) {
  emit('select', id)
}

function handleSelectChange(event) {
  const id = event.target.value
  if (id) {
    emit('select', id)
  }
}

function deleteSequence(event, id) {
  event.stopPropagation()  // Don't trigger select
  emit('delete', id)
}

function triggerUpload() {
  fileInput.value?.click()
}

function handleFileChange(event) {
  const file = event.target.files?.[0]
  if (file) {
    emit('upload', file)
    // Reset input so same file can be uploaded again
    event.target.value = ''
  }
}

function handleContextMenu(event, id) {
  // Don't show context menu for the currently selected sequence
  if (id === props.selectedId) return

  event.preventDefault()
  contextMenuSequenceId.value = id
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true

  // Close menu when clicking elsewhere
  document.addEventListener('click', closeContextMenu, { once: true })
}

function closeContextMenu() {
  contextMenuVisible.value = false
  contextMenuSequenceId.value = null
}

function alignWithCurrent() {
  if (contextMenuSequenceId.value) {
    emit('align', contextMenuSequenceId.value)
  }
  closeContextMenu()
}
</script>

<template>
  <!-- Mobile Header -->
  <header class="mobile-header">
    <div class="mobile-branding">
      <span class="mobile-title">OpenGenePool</span>
      <span class="mobile-by">by</span>
      <a href="https://vidalalabs.com" target="_blank">
        <img src="./vidala-labs.svg" alt="Vidala Labs" class="mobile-logo" />
      </a>
    </div>
    <div class="mobile-controls">
      <select
        class="sequence-select"
        :value="props.selectedId || ''"
        @change="handleSelectChange"
      >
        <option value="" disabled>Select sequence...</option>
        <option v-for="seq in props.sequences" :key="seq.id" :value="seq.id">
          {{ seq.name }}
        </option>
      </select>
      <button class="upload-btn" @click="triggerUpload" title="Upload GenBank file">
        +
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept=".gb,.gbk,.genbank,.txt"
      style="display: none"
      @change="handleFileChange"
    />
  </header>

  <!-- Desktop Sidebar -->
  <aside class="sidebar">
    <div class="branding">
      <div class="brand-title">OpenGenePool</div>
      <div class="brand-by">by</div>
      <a href="https://vidalalabs.com" target="_blank" class="vidala-link">
        <img src="./vidala-labs.svg" alt="Vidala Labs" class="vidala-logo" />
      </a>
      <div class="brand-links">
        <a href="https://github.com/Vidala-Labs/opengenepool" target="_blank" class="brand-link">
          GitHub
        </a>
        <span class="link-separator">•</span>
        <a href="https://buymeacoffee.com/vidalalabs" target="_blank" class="brand-link">
          Buy Me a Coffee
        </a>
      </div>
    </div>
    <div class="sidebar-header">
      <h2>Sequences</h2>
      <button class="upload-btn" @click="triggerUpload" title="Upload GenBank file">
        +
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".gb,.gbk,.genbank,.txt"
        style="display: none"
        @change="handleFileChange"
      />
    </div>
    <ul class="sequence-list">
      <li
        v-for="seq in props.sequences"
        :key="seq.id"
        :class="{ selected: seq.id === props.selectedId }"
        @click="selectSequence(seq.id)"
        @contextmenu="handleContextMenu($event, seq.id)"
      >
        <span class="seq-name">{{ seq.name }}</span>
        <button
          class="delete-btn"
          @click="deleteSequence($event, seq.id)"
          title="Delete sequence"
        >
          ×
        </button>
      </li>
    </ul>
    <div v-if="props.sequences.length === 0" class="empty-state">
      No sequences stored
    </div>

    <!-- Context Menu -->
    <div
      v-if="contextMenuVisible"
      class="context-menu"
      :style="{ left: contextMenuX + 'px', top: contextMenuY + 'px' }"
    >
      <div class="context-menu-item" @click="alignWithCurrent">
        Align with current
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* Mobile Header - hidden on desktop */
.mobile-header {
  display: none;
  background: #e0e8e0;
  padding: 12px 16px;
  border-bottom: 1px solid #ddd;
}

.mobile-branding {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 12px;
}

.mobile-title {
  font-size: 16px;
  font-weight: 600;
}

.mobile-by {
  font-size: 11px;
  color: #666;
}

.mobile-logo {
  height: 20px;
  width: auto;
}

.mobile-controls {
  display: flex;
  gap: 8px;
}

.sequence-select {
  flex: 1;
  padding: 8px 12px;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
}

/* Desktop Sidebar */
.sidebar {
  width: 250px;
  background: #f5f5f5;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Mobile responsive */
@media (max-width: 768px) {
  .mobile-header {
    display: block;
  }

  .sidebar {
    display: none;
  }
}

.branding {
  padding: 16px;
  background: #e0e8e0;
  color: #333;
  text-align: center;
  border-bottom: 1px solid #ddd;
}

.brand-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}

.brand-by {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.vidala-link {
  display: block;
  margin-bottom: 8px;
}

.vidala-logo {
  width: 180px;
  height: auto;
}

.brand-links {
  font-size: 12px;
}

.brand-link {
  color: #0066cc;
  text-decoration: none;
}

.brand-link:hover {
  text-decoration: underline;
}

.link-separator {
  margin: 0 6px;
  color: #999;
}

.sidebar-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #ddd;
  background: #eee;
  gap: 8px;
}

h2 {
  margin: 0;
  font-size: 16px;
  flex: 1;
}

.upload-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: #4a90d9;
  color: white;
  font-size: 18px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.upload-btn:hover {
  background: #357abd;
}

.sequence-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  overflow-y: auto;
}

.sequence-list li {
  padding: 8px 16px;
  cursor: pointer;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
  gap: 8px;
}

.seq-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.delete-btn {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: #999;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.delete-btn:hover {
  background: #e74c3c;
  color: white;
}

.sequence-list li:hover {
  background: #e8e8e8;
}

.sequence-list li.selected {
  background: #d0e0ff;
  font-weight: 500;
}

.empty-state {
  padding: 16px;
  color: #888;
  font-size: 14px;
}

/* Context Menu */
.context-menu {
  position: fixed;
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 150px;
}

.context-menu-item {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
}

.context-menu-item:hover {
  background: #f0f0f0;
}
</style>
