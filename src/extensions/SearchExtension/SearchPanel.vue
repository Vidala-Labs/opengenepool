<script setup>
import { ref, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { searchVisible } from './state.js'

const extensionAPI = inject('extensionAPI')

// Search state
const searchQuery = ref('')
const searchMatches = ref([])
const currentMatchIndex = ref(0)
const searchInputRef = ref(null)

// Track if we're navigating matches (to avoid closing on our own selection changes)
let isNavigating = false

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
  const sequence = extensionAPI.getSequence()
  if (!sequence || !searchQuery.value) {
    searchMatches.value = []
    return
  }

  const query = searchQuery.value.toUpperCase()
  const revComp = reverseComplement(query)
  const seq = sequence.toUpperCase()

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

  // Mark that we're navigating so selection change doesn't close the panel
  isNavigating = true

  // Select the match in the editor (with strand orientation)
  const spec = match.strand === '-'
    ? `(${match.start}..${match.end})`
    : `${match.start}..${match.end}`
  extensionAPI.setSelection(spec)

  // Reset navigation flag after a short delay
  setTimeout(() => {
    isNavigating = false
  }, 100)
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

function handleKeydown(event) {
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

function closeSearch() {
  searchVisible.value = false
}

// Subscribe to selection changes
let unsubscribe = null

onMounted(() => {
  unsubscribe = extensionAPI.onSelectionChange(() => {
    // Only close if we're visible and not navigating
    if (searchVisible.value && !isNavigating) {
      closeSearch()
    }
  })
})

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
  }
})

// Pre-fill search with selected sequence when panel opens
watch(searchVisible, async (visible) => {
  if (visible) {
    const selectedSeq = extensionAPI.getSelectedSequence()
    if (selectedSeq) {
      searchQuery.value = selectedSeq
      await nextTick()
      performSearch()
    } else {
      searchQuery.value = ''
      searchMatches.value = []
    }
    // Focus input after panel opens
    await nextTick()
    searchInputRef.value?.focus()
  }
})
</script>

<template>
  <Transition name="fade">
    <div v-if="searchVisible" class="search-overlay">
      <div class="search-modal">
        <div class="search-header">
          <span class="search-title">Search Sequence</span>
        </div>
        <div class="search-body">
          <input
            ref="searchInputRef"
            type="text"
            v-model="searchQuery"
            class="search-input"
            placeholder="Enter DNA sequence (e.g., GAATTC)"
            @keydown="handleKeydown"
            @input="performSearch"
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
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Search Modal - positioned top-right to not block editor */
.search-overlay {
  position: absolute;
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
