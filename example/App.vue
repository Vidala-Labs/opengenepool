<script setup>
import { ref, shallowRef, computed, watch, onMounted } from 'vue'
import SequenceEditor from '../src/components/SequenceEditor.vue'
import AlignmentEditor from '../src/components/AlignmentEditor.vue'
import { SequenceDocument } from '../src/composables/SequenceDocument.js'
import { Span, Range } from '../src/utils/dna.js'
import Sidebar from './Sidebar.vue'
import { ArrowDownTrayIcon, DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
import { listSequences, getSequence, saveSequence, deleteSequence, isEmpty } from './db.js'
import { snapshotDoc } from './persistence.js'
import { pUC19, testAlignmentSequence } from './seed.js'
import { parseGenBank } from './genbank-parser.js'
import { toGenBank } from './genbank-writer.js'
import { SearchExtension } from '../src/extensions/SearchExtension/index.js'
import { ORFFinderExtension } from '../src/extensions/ORFFinderExtension/index.js'
import { BlastExtension } from '../src/extensions/BlastExtension/index.js'
import { RestrictionExtension } from '../src/extensions/RestrictionExtension/index.js'
import { PrimerBindExtension } from '../src/extensions/PrimerBindExtension/index.js'

// List of sequences for sidebar
const sequences = ref([])

// Currently selected sequence (raw data from DB)
const selectedId = ref(null)
const currentSequenceData = ref(null)

const editorRef = ref(null)

// Alignment mode state
const alignmentSequenceData = ref(null)

// Rehydrate a persisted span (string or plain object) into real Span/Range objects.
// IndexedDB structured-clone keeps own props but strips prototypes, so span arrives
// as { ranges: [{start,end,orientation,...}] }; JSON-persisted spans arrive as fenced
// strings. OGP requires real Span/Range objects across its boundary, so rebuild here.
function normalizeSpan(span) {
  if (span instanceof Span) return span
  if (typeof span === 'string') return Span.parse(span)
  if (span?.ranges) {
    return new Span(span.ranges.map(r =>
      r instanceof Range
        ? r
        : (typeof r === 'string'
            ? Range.parse(r)
            : new Range(r.start, r.end, r.orientation, r.startIndefinite, r.endIndefinite))
    ))
  }
  return new Span()
}

function normalizeAnnotations(annotations = []) {
  return annotations.map(annotation => ({
    ...annotation,
    span: normalizeSpan(annotation.span),
    attributes: annotation.attributes || {}
  }))
}

function normalizeSequenceData(data) {
  if (!data) return null
  return {
    ...data,
    annotations: normalizeAnnotations(data.annotations)
  }
}

// Create SequenceDocument instances
// IMPORTANT: Use shallowRef + watch instead of computed to avoid creating new
// instances on every access. This allows mutations (delete, insert) to persist.
const targetDoc = shallowRef(null)
const queryDoc = shallowRef(null)

// Watch for changes to currentSequenceData ID and create new document only when needed
watch(
  () => currentSequenceData.value?.id,
  (newId, oldId) => {
    if (!currentSequenceData.value) {
      targetDoc.value = null
      return
    }
    // Only create new document when ID changes (sequence was switched)
    if (newId !== oldId || !targetDoc.value) {
      targetDoc.value = new SequenceDocument({
        sequence: currentSequenceData.value.sequence,
        name: currentSequenceData.value.name,
        annotations: currentSequenceData.value.annotations || [],
        circular: currentSequenceData.value.metadata?.circular || false
      })
    }
  },
  { immediate: true }
)

// Watch for changes to alignmentSequenceData ID
watch(
  () => alignmentSequenceData.value?.id,
  (newId, oldId) => {
    if (!alignmentSequenceData.value) {
      queryDoc.value = null
      return
    }
    // Only create new document when ID changes
    if (newId !== oldId || !queryDoc.value) {
      queryDoc.value = new SequenceDocument({
        sequence: alignmentSequenceData.value.sequence,
        name: alignmentSequenceData.value.name,
        annotations: alignmentSequenceData.value.annotations || [],
        circular: alignmentSequenceData.value.metadata?.circular || false
      })
    }
  },
  { immediate: true }
)

// Note: targetDoc and queryDoc are passed directly to editors

// Load sequences on mount, seed if empty
onMounted(async () => {
  const empty = await isEmpty()
  if (empty) {
    // Seed with pUC19 and test alignment sequence
    await saveSequence(pUC19)
    await saveSequence(testAlignmentSequence)
  } else {
    // Always update seed sequences to ensure latest data
    const existing = await getSequence(pUC19.id)
    if (existing) {
      await saveSequence({ ...pUC19, createdAt: existing.createdAt })
    }
    const existingTest = await getSequence(testAlignmentSequence.id)
    if (!existingTest) {
      await saveSequence(testAlignmentSequence)
    }
  }
  await refreshList()

  // Check for hash and load that sequence
  const hash = window.location.hash.slice(1)  // Remove the #
  if (hash) {
    const seq = await getSequence(hash)
    if (seq) {
      selectedId.value = hash
      currentSequenceData.value = normalizeSequenceData(seq)
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

// Snapshot the LIVE editor document back into currentSequenceData + IndexedDB.
// Sequence edits (insert/delete/replace) mutate the live SequenceDocument in place
// but are not otherwise persisted; without this they are lost on reload and stale
// on export. Reads the live doc via the editor ref (target doc in both editor types).
async function persistCurrentDoc() {
  const liveDoc = editorRef.value?.targetDoc?.value
  if (!currentSequenceData.value || !liveDoc) return
  const snapshot = snapshotDoc(currentSequenceData.value, liveDoc)
  if (!snapshot) return
  currentSequenceData.value = snapshot
  await saveSequence(snapshot)
}

// Edit handling: sequence edits are applied to the live SequenceDocument by the
// editor; persist the resulting state so it survives reload and export.
function handleEdit(data) {
  persistCurrentDoc()
}

async function saveAs() {
  if (!currentSequenceData.value || !editorRef.value) {
    console.error('saveAs: no current sequence or editor ref')
    return
  }

  const name = prompt('Save as:', `${currentSequenceData.value.name || 'Untitled'} (copy)`)
  if (!name) return

  // Get current state from the document
  const doc = editorRef.value.targetDoc.value

  // Create new sequence entry with current editor state
  const newSequence = JSON.parse(JSON.stringify({
    id: crypto.randomUUID(),
    name,
    sequence: doc.sequence,
    annotations: doc.annotations,
    metadata: { ...currentSequenceData.value.metadata, circular: doc.circular },
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
  if (!currentSequenceData.value) return

  // Persist from the LIVE document so annotation AND sequence state stay consistent
  // (the live doc holds both the updated annotations and any prior base edits).
  if (editorRef.value?.targetDoc?.value) {
    await persistCurrentDoc()
    return
  }

  // Fallback (no editor ref yet): persist the annotations we were handed.
  currentSequenceData.value.annotations = updatedAnnotations
  await saveSequence(JSON.parse(JSON.stringify(currentSequenceData.value)))
}

function downloadSequence() {
  if (!currentSequenceData.value) return

  // Export from the LIVE document's current bases, not the stale loaded record.
  const liveDoc = editorRef.value?.targetDoc?.value
  const source = liveDoc ? snapshotDoc(currentSequenceData.value, liveDoc) : currentSequenceData.value
  const genbank = toGenBank(source)
  const blob = new Blob([genbank], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `${currentSequenceData.value.name || 'sequence'}.gb`
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
    currentSequenceData.value = null
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

async function handleAlign(sequenceId) {
  // Get the sequence to align with
  const seqToAlign = await getSequence(sequenceId)
  if (!seqToAlign) return

  // Set alignment mode
  alignmentSequenceData.value = normalizeSequenceData(seqToAlign)
}

function clearAlignment() {
  alignmentSequenceData.value = null
}

// Computed for title display
const displayTitle = computed(() => currentSequenceData.value?.name || 'Untitled')
const queryTitle = computed(() => alignmentSequenceData.value?.name || 'Untitled')
const sequenceLength = computed(() => targetDoc.value?.sequence?.length || 0)
const hasMetadata = computed(() => {
  const m = currentSequenceData.value?.metadata
  return m && (m.molecule_type || m.definition)
})
</script>

<template>
  <div class="app-layout">
    <Sidebar
      :sequences="sequences"
      :selected-id="selectedId"
      @select="selectSequence"
      @upload="handleUpload"
      @delete="handleDelete"
      @align="handleAlign"
    />
    <main class="main-content">
      <div v-if="!currentSequenceData" class="placeholder">
        <p class="placeholder-desktop">Please select a sequence on the left</p>
        <p class="placeholder-mobile">Please select a sequence above</p>
        <p class="mobile-note">Note: Some features may not have a good user experience on mobile devices.</p>
      </div>
      <!-- AlignmentEditor - used when comparing two sequences (tested in AlignmentEditor.test.js) -->
      <AlignmentEditor
        v-else-if="queryDoc"
        ref="editorRef"
        :key="currentSequenceData.id + '-alignment'"
        :target="targetDoc"
        :query="queryDoc"
        :extensions="[BlastExtension]"
        @edit="handleEdit"
        @select="handleSelect"
        @annotations-update="handleAnnotationsUpdate"
      >
        <template #title>
          <strong class="title-display">{{ displayTitle }}</strong> x <strong class="title-display">{{ queryTitle }}</strong>
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
          <div class="info-row">
            <span class="info-label">Aligned Length:</span>
            <span class="info-value">{{ editorRef?.alignmentResult?.targetAligned?.length || 0 }} positions</span>
          </div>
          <div class="info-row">
            <span class="info-label">Query Range:</span>
            <span class="info-value">{{ (editorRef?.alignmentResult?.queryStart || 0) + 1 }}..{{ editorRef?.alignmentResult?.queryEnd }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Target Range:</span>
            <span class="info-value">{{ (editorRef?.alignmentResult?.targetStart || 0) + 1 }}..{{ editorRef?.alignmentResult?.targetEnd }}</span>
          </div>
        </template>
        <template #toolbar>
          <button class="toolbar-icon-btn close-alignment-btn" @click="clearAlignment" title="Close alignment view">
            ✕
          </button>
          <button class="toolbar-icon-btn" @click="saveAs" title="Save as new sequence">
            <DocumentDuplicateIcon class="toolbar-icon" />
          </button>
          <button class="toolbar-icon-btn" @click="downloadSequence" title="Download as GenBank">
            <ArrowDownTrayIcon class="toolbar-icon" />
          </button>
        </template>
      </AlignmentEditor>

      <!-- SequenceEditor - for single sequence editing -->
      <SequenceEditor
        v-else
        ref="editorRef"
        :key="currentSequenceData.id"
        :sequence="targetDoc"
        :extensions="[SearchExtension, ORFFinderExtension, BlastExtension, RestrictionExtension]"
        :annotation-fields="[PrimerBindExtension]"
        @edit="handleEdit"
        @select="handleSelect"
        @annotations-update="handleAnnotationsUpdate"
      >
        <template #title>
          <strong class="title-display">{{ displayTitle }}</strong>
          &mdash; {{ sequenceLength.toLocaleString() }} bp
        </template>
        <template v-if="hasMetadata" #info>
          <div v-if="currentSequenceData?.metadata?.molecule_type" class="info-row">
            <span class="info-label">Molecule Type:</span>
            <span class="info-value">{{ currentSequenceData.metadata.molecule_type }}</span>
          </div>
          <div v-if="currentSequenceData?.metadata?.definition" class="info-row">
            <span class="info-label">Definition:</span>
            <span class="info-value">{{ currentSequenceData.metadata.definition }}</span>
          </div>
          <div v-if="currentSequenceData?.metadata?.accession" class="info-row">
            <span class="info-label">Accession:</span>
            <span class="info-value">{{ currentSequenceData.metadata.accession }}</span>
          </div>
          <div v-if="currentSequenceData?.metadata?.organism" class="info-row">
            <span class="info-label">Organism:</span>
            <span class="info-value">{{ currentSequenceData.metadata.organism }}</span>
          </div>
        </template>
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

.title-display {
  cursor: default;
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

.close-alignment-btn {
  color: #e74c3c;
  font-weight: bold;
}

.close-alignment-btn:hover {
  background: #fde8e8;
  border-color: #e74c3c;
}

/* Info row styles for #info slot content */
.info-row {
  display: flex;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  font-weight: 500;
  color: #666;
  min-width: 120px;
}

.info-value {
  color: #333;
}
</style>
