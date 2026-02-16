<script setup>
import { ref, onMounted } from 'vue'
import SequenceEditor from '../src/components/SequenceEditor.vue'
import Sidebar from './Sidebar.vue'
import { ArrowDownTrayIcon, MagnifyingGlassIcon, DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
import { listSequences, getSequence, saveSequence, deleteSequence, isEmpty } from './db.js'
import { pUC19 } from './seed.js'
import { parseGenBank } from './genbank-parser.js'
import { toGenBank } from './genbank-writer.js'

// List of sequences for sidebar
const sequences = ref([])

// Currently selected sequence
const selectedId = ref(null)
const currentSequence = ref(null)

// Search state
const searchVisible = ref(false)
const searchQuery = ref('')
const searchMatches = ref([])
const currentMatchIndex = ref(0)
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

function openSearch() {
  searchVisible.value = true
  searchQuery.value = ''
  searchMatches.value = []
  currentMatchIndex.value = 0
}

function closeSearch() {
  searchVisible.value = false
}

function reverseComplement(seq) {
  const complement = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N', R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D' }
  return seq.split('').reverse().map(c => complement[c] || c).join('')
}

// Convert IUPAC ambiguity codes to regex character classes
function iupacToRegex(seq) {
  const iupac = {
    A: 'A', T: 'T', G: 'G', C: 'C',
    N: '[ATGC]',
    R: '[AG]',   // puRine
    Y: '[CT]',   // pYrimidine
    S: '[GC]',   // Strong
    W: '[AT]',   // Weak
    K: '[GT]',   // Keto
    M: '[AC]',   // aMino
    B: '[CGT]',  // not A
    D: '[AGT]',  // not C
    H: '[ACT]',  // not G
    V: '[ACG]'   // not T
  }
  return seq.split('').map(c => iupac[c] || c).join('')
}

function performSearch() {
  if (!currentSequence.value || !searchQuery.value) {
    searchMatches.value = []
    return
  }

  const query = searchQuery.value.toUpperCase()
  const revComp = reverseComplement(query)
  const seq = currentSequence.value.sequence.toUpperCase()
  const queryLen = query.length

  // Convert IUPAC to regex patterns
  const forwardPattern = iupacToRegex(query)
  const revCompPattern = iupacToRegex(revComp)

  // Find forward matches
  const forwardRegex = new RegExp(forwardPattern, 'g')
  const matches = []
  let match

  while ((match = forwardRegex.exec(seq)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length, strand: '+' })
    // Prevent infinite loop on zero-length matches
    if (match.index === forwardRegex.lastIndex) forwardRegex.lastIndex++
  }

  // Find reverse complement matches (if pattern is different from forward)
  if (revCompPattern !== forwardPattern) {
    const revRegex = new RegExp(revCompPattern, 'g')
    while ((match = revRegex.exec(seq)) !== null) {
      // Check if this overlaps with any forward match
      const overlaps = matches.some(m =>
        m.strand === '+' && !(match.index >= m.end || match.index + match[0].length <= m.start)
      )
      if (!overlaps) {
        matches.push({ start: match.index, end: match.index + match[0].length, strand: '-' })
      }
      if (match.index === revRegex.lastIndex) revRegex.lastIndex++
    }
  }

  // Sort by position
  matches.sort((a, b) => a.start - b.start)

  searchMatches.value = matches
  currentMatchIndex.value = 0

  if (matches.length > 0) {
    goToMatch(0)
  }
}

function goToMatch(index) {
  if (searchMatches.value.length === 0) return

  currentMatchIndex.value = index
  const match = searchMatches.value[index]

  // Select the match in the editor (with strand orientation)
  if (editorRef.value) {
    const spec = match.strand === '-'
      ? `(${match.start}..${match.end})`
      : `${match.start}..${match.end}`
    editorRef.value.setSelection(spec)
  }
}

function nextMatch() {
  if (searchMatches.value.length === 0) return
  const next = (currentMatchIndex.value + 1) % searchMatches.value.length
  goToMatch(next)
}

function prevMatch() {
  if (searchMatches.value.length === 0) return
  const prev = (currentMatchIndex.value - 1 + searchMatches.value.length) % searchMatches.value.length
  goToMatch(prev)
}

function handleSearchKeydown(event) {
  if (event.key === 'Enter') {
    if (event.shiftKey) {
      prevMatch()
    } else if (searchMatches.value.length > 0) {
      nextMatch()
    } else {
      performSearch()
    }
  } else if (event.key === 'Escape') {
    closeSearch()
  }
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
        @edit="handleEdit"
        @select="handleSelect"
        @annotations-update="handleAnnotationsUpdate"
      >
        <template #toolbar>
          <button class="toolbar-icon-btn" @click="openSearch" title="Search sequence">
            <MagnifyingGlassIcon class="toolbar-icon" />
          </button>
          <button class="toolbar-icon-btn" @click="saveAs" title="Save as new sequence">
            <DocumentDuplicateIcon class="toolbar-icon" />
          </button>
          <button class="toolbar-icon-btn" @click="downloadSequence" title="Download as GenBank">
            <ArrowDownTrayIcon class="toolbar-icon" />
          </button>
        </template>
      </SequenceEditor>
    </main>

    <!-- Search Modal -->
    <div v-if="searchVisible" class="search-overlay">
      <div class="search-modal">
        <div class="search-header">
          <span class="search-title">Search Sequence</span>
          <button class="search-close" @click="closeSearch">&times;</button>
        </div>
        <div class="search-body">
          <input
            type="text"
            v-model="searchQuery"
            class="search-input"
            placeholder="Enter DNA sequence (e.g., GAATTC)"
            @keydown="handleSearchKeydown"
            @input="performSearch"
            autofocus
          />
          <div class="search-results">
            <span v-if="searchQuery && searchMatches.length === 0" class="no-matches">
              No matches found
            </span>
            <template v-else-if="searchMatches.length > 0">
              <span class="match-count">
                {{ currentMatchIndex + 1 }} of {{ searchMatches.length }} matches:
              </span>
              <span class="match-location">
                {{ searchMatches[currentMatchIndex].strand === '-' ? 'complement(' : '' }}{{ searchMatches[currentMatchIndex].start + 1 }}..{{ searchMatches[currentMatchIndex].end }}{{ searchMatches[currentMatchIndex].strand === '-' ? ')' : '' }}
              </span>
            </template>
          </div>
          <div v-if="searchMatches.length > 0" class="search-nav">
            <button @click="prevMatch" class="nav-btn">&larr; Previous</button>
            <button @click="nextMatch" class="nav-btn">Next &rarr;</button>
          </div>
        </div>
      </div>
    </div>
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

/* Search Modal - positioned top-right to not block editor */
.search-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  pointer-events: none;
}

.search-modal {
  position: absolute;
  top: 60px;
  right: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  min-width: 320px;
  max-width: 400px;
  pointer-events: auto;
}

.search-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.search-title {
  font-weight: 600;
  font-size: 14px;
}

.search-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
  padding: 0 4px;
}

.search-close:hover {
  color: #333;
}

.search-body {
  padding: 16px;
}

.search-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  font-family: "Lucida Console", Monaco, monospace;
  border: 1px solid #ccc;
  border-radius: 4px;
  outline: none;
}

.search-input:focus {
  border-color: #4285f4;
  box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
}

.search-results {
  margin-top: 12px;
  font-size: 13px;
  color: #666;
  min-height: 20px;
}

.no-matches {
  color: #999;
}

.match-count {
  color: #333;
}

.match-location {
  font-family: "Lucida Console", Monaco, monospace;
  color: #0066cc;
  margin-left: 4px;
}

.search-nav {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.nav-btn {
  flex: 1;
  padding: 8px 16px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 13px;
}

.nav-btn:hover {
  background: #f5f5f5;
  border-color: #999;
}

/* Mobile search modal */
@media (max-width: 768px) {
  .search-modal {
    top: 120px;
    right: 10px;
    left: 10px;
    min-width: auto;
    max-width: none;
  }
}
</style>
