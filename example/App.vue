<script setup>
import { ref, onMounted } from 'vue'
import SequenceEditor from '../src/components/SequenceEditor.vue'
import Sidebar from './Sidebar.vue'
import { ArrowDownTrayIcon, DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
import { listSequences, getSequence, saveSequence, deleteSequence, isEmpty } from './db.js'
import { pUC19 } from './seed.js'
import { parseGenBank } from './genbank-parser.js'
import { toGenBank } from './genbank-writer.js'
import { SearchExtension } from '../src/extensions/SearchExtension/index.js'
import { CDSSearchExtension } from '../src/extensions/CDSSearchExtension/index.js'

// List of sequences for sidebar
const sequences = ref([])

// Currently selected sequence
const selectedId = ref(null)
const currentSequence = ref(null)

const editorRef = ref(null)

// Load sequences on mount, seed if empty
onMounted(async () => {
  const empty = await isEmpty()
  if (empty) {
    // Seed with pUC19
    await saveSequence(pUC19)
  } else {
    // Always update pUC19 seed to ensure latest data
    const existing = await getSequence(pUC19.id)
    if (existing) {
      await saveSequence({ ...pUC19, createdAt: existing.createdAt })
    }
  }
  await refreshList()

  // Check for hash and load that sequence
  const hash = window.location.hash.slice(1)  // Remove the #
  if (hash) {
    const seq = await getSequence(hash)
    if (seq) {
      selectedId.value = hash
      currentSequence.value = seq
    }
  }
})

async function refreshList() {
  sequences.value = await listSequences()
}

function selectSequence(id) {
  // Use hash navigation and refresh to ensure clean state
  window.location.hash = id
  window.location.reload()
}

function handleEdit(data) {
  // Edits are not auto-saved; use "Save As" to persist
}

async function saveAs() {
  if (!currentSequence.value || !editorRef.value) {
    console.error('saveAs: no current sequence or editor ref')
    return
  }

  const name = prompt('Save as:', `${currentSequence.value.name || 'Untitled'} (copy)`)
  if (!name) return

  // Create new sequence entry with current editor state
  // Use JSON parse/stringify to strip Vue reactive proxies
  const newSequence = JSON.parse(JSON.stringify({
    id: crypto.randomUUID(),
    name,
    sequence: editorRef.value.getSequence(),
    annotations: currentSequence.value.annotations || [],
    metadata: currentSequence.value.metadata || {},
    createdAt: new Date().toISOString()
  }))

  try {
    await saveSequence(newSequence)
    // Navigate to new sequence with page reload
    window.location.hash = newSequence.id
    window.location.reload()
  } catch (err) {
    console.error('saveAs failed:', err)
  }
}

function handleSelect(data) {
  // Selection changed
}

async function handleAnnotationsUpdate(updatedAnnotations) {
  if (!currentSequence.value) return

  // Update the current sequence's annotations
  currentSequence.value.annotations = updatedAnnotations

  // Persist to IndexedDB (deep clone to strip Vue proxies)
  const plainData = JSON.parse(JSON.stringify(currentSequence.value))
  await saveSequence(plainData)
}

function downloadSequence() {
  if (!currentSequence.value) return

  const genbank = toGenBank(currentSequence.value)
  const blob = new Blob([genbank], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `${currentSequence.value.name || 'sequence'}.gb`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function handleDelete(id) {
  await deleteSequence(id)
  await refreshList()

  // If we deleted the currently selected sequence, clear the view
  if (selectedId.value === id) {
    selectedId.value = null
    currentSequence.value = null
  }
}

async function handleUpload(file) {
  try {
    const text = await file.text()
    const parsed = parseGenBank(text)

    // Use filename (without extension) as fallback name
    if (!parsed.name || parsed.name === 'Untitled') {
      parsed.name = file.name.replace(/\.(gb|gbk|genbank|txt)$/i, '')
    }

    // Generate unique ID
    parsed.id = crypto.randomUUID()

    // Save to IndexedDB
    const saved = await saveSequence(parsed)

    // Refresh list and select the new sequence
    await refreshList()
    await selectSequence(saved.id)
  } catch (error) {
    console.error('Failed to parse GenBank file:', error)
    alert('Failed to parse file. Please ensure it is a valid GenBank format.')
  }
}
</script>

<template>
  <div class="app-layout">
    <Sidebar
      :sequences="sequences"
      :selected-id="selectedId"
      @select="selectSequence"
      @upload="handleUpload"
      @delete="handleDelete"
    />
    <main class="main-content">
      <div v-if="!currentSequence" class="placeholder">
        <p class="placeholder-desktop">Please select a sequence on the left</p>
        <p class="placeholder-mobile">Please select a sequence above</p>
        <p class="mobile-note">Note: Some features may not have a good user experience on mobile devices.</p>
      </div>
      <SequenceEditor
        v-else
        ref="editorRef"
        :key="currentSequence.id"
        :sequence="currentSequence.sequence"
        :title="currentSequence.name"
        :annotations="currentSequence.annotations || []"
        :metadata="currentSequence.metadata || {}"
        :extensions="[SearchExtension, CDSSearchExtension]"
        @edit="handleEdit"
        @select="handleSelect"
        @annotations-update="handleAnnotationsUpdate"
      >
        <template #toolbar>
          <button class="toolbar-icon-btn" @click="saveAs" title="Save as new sequence">
            <DocumentDuplicateIcon class="toolbar-icon" />
          </button>
          <button class="toolbar-icon-btn" @click="downloadSequence" title="Download as GenBank">
            <ArrowDownTrayIcon class="toolbar-icon" />
          </button>
        </template>
      </SequenceEditor>
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
}

.app-layout {
  display: flex;
  height: 100%;
}

/* Mobile responsive */
@media (max-width: 768px) {
  .app-layout {
    flex-direction: column;
  }

  .main-content {
    height: calc(100% - 100px); /* Account for mobile header */
  }

  .placeholder {
    padding: 20px;
    text-align: center;
  }
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #888;
  font-size: 18px;
  background: #fafafa;
  gap: 12px;
}

.placeholder p {
  margin: 0;
}

.placeholder-mobile,
.mobile-note {
  display: none;
}

@media (max-width: 768px) {
  .placeholder-desktop {
    display: none;
  }

  .placeholder-mobile,
  .mobile-note {
    display: block;
  }

  .mobile-note {
    font-size: 14px;
    color: #999;
    font-style: italic;
  }
}

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
  border-color: #ccc;
}

.toolbar-icon {
  width: 18px;
  height: 18px;
}
</style>
