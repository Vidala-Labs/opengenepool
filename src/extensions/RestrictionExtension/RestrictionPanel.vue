<script setup>
import { ref, inject, onMounted, onUnmounted, watch, computed } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { ENZYMES_SORTED } from './enzymes.js'
import {
  restrictionPanelVisible,
  selectedEnzymeNames,
  cutSiteCounts,
  cutSites,
  toggleEnzyme,
  selectAllEnzymes,
  clearAllEnzymes,
  setSequence
} from './state.js'

const extensionAPI = inject('extensionAPI')

// Search filter
const searchQuery = ref('')

// Filtered enzymes based on search
const filteredEnzymes = computed(() => {
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return ENZYMES_SORTED

  return ENZYMES_SORTED.filter(enzyme =>
    enzyme.name.toLowerCase().includes(query) ||
    enzyme.recognitionSequence.toLowerCase().includes(query)
  )
})

// Summary text
const summaryText = computed(() => {
  const siteCount = cutSites.value.length
  const enzymeCount = selectedEnzymeNames.value.size

  if (enzymeCount === 0) {
    return 'No enzymes selected'
  }

  const sitePlural = siteCount === 1 ? 'site' : 'sites'
  const enzymePlural = enzymeCount === 1 ? 'enzyme' : 'enzymes'
  return `${siteCount} cut ${sitePlural} from ${enzymeCount} ${enzymePlural}`
})

// Format recognition sequence with cut position markers
// ᵛ (U+1D5B) for top/forward strand cut
// ‸ (U+2038) for bottom/reverse strand cut
function formatCutSequence(enzyme) {
  const { recognitionSequence, cutPosition, cutPositionComplement } = enzyme
  const seq = recognitionSequence

  // For blunt cutters, just show a single marker
  if (cutPosition === cutPositionComplement) {
    return seq.slice(0, cutPosition) + '|' + seq.slice(cutPosition)
  }

  // Insert markers at cut positions
  // We need to handle insertion order carefully
  const markers = []
  markers.push({ pos: cutPosition, char: 'ᵛ' })  // top strand
  markers.push({ pos: cutPositionComplement, char: '‸' })  // bottom strand

  // Sort by position descending so we can insert from end to start
  markers.sort((a, b) => b.pos - a.pos)

  let result = seq
  for (const marker of markers) {
    result = result.slice(0, marker.pos) + marker.char + result.slice(marker.pos)
  }

  return result
}

// Update sequence when panel opens or sequence changes
function updateSequence() {
  if (extensionAPI) {
    setSequence(extensionAPI.getSequence(), extensionAPI.getTitle())
  }
}

// Watch for panel visibility to update sequence
watch(restrictionPanelVisible, (visible) => {
  if (visible) {
    updateSequence()
  }
})

// Set up sequence update on mount
onMounted(() => {
  if (restrictionPanelVisible.value) {
    updateSequence()
  }
})

function closePanel() {
  restrictionPanelVisible.value = false
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    closePanel()
  }
}
</script>

<template>
  <Transition name="fade">
    <div v-if="restrictionPanelVisible" class="restriction-overlay" @keydown="handleKeydown">
      <div class="restriction-panel">
        <div class="panel-header">
          <span class="panel-title">Restriction Enzymes</span>
          <button class="close-btn" @click="closePanel" title="Close">
            <XMarkIcon class="close-icon" />
          </button>
        </div>

        <div class="panel-body">
          <!-- Search input -->
          <input
            type="text"
            v-model="searchQuery"
            class="search-input"
            placeholder="Search enzymes..."
          />

          <!-- Action buttons -->
          <div class="action-buttons">
            <button class="action-btn" @click="selectAllEnzymes">Select All</button>
            <button class="action-btn" @click="clearAllEnzymes">Clear All</button>
          </div>

          <!-- Enzyme list -->
          <div class="enzyme-list">
            <label
              v-for="enzyme in filteredEnzymes"
              :key="enzyme.name"
              class="enzyme-row"
            >
              <input
                type="checkbox"
                :checked="selectedEnzymeNames.has(enzyme.name)"
                @change="toggleEnzyme(enzyme.name)"
              />
              <span class="enzyme-name">{{ enzyme.name }}</span>
              <span class="enzyme-sequence">{{ formatCutSequence(enzyme) }}</span>
              <span class="enzyme-count">({{ cutSiteCounts.get(enzyme.name) || 0 }})</span>
            </label>
          </div>

          <!-- Summary -->
          <div class="summary">
            {{ summaryText }}
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

.restriction-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  pointer-events: none;
}

.restriction-panel {
  position: absolute;
  top: 60px;
  right: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  width: 300px;
  max-height: calc(100vh - 100px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.panel-title {
  font-weight: 600;
  font-size: 14px;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  background: none;
  cursor: pointer;
  color: #666;
  border-radius: 4px;
}

.close-btn:hover {
  background: #f0f0f0;
  color: #333;
}

.close-icon {
  width: 18px;
  height: 18px;
}

.panel-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid #ddd;
  border-radius: 4px;
  outline: none;
}

.search-input:focus {
  border-color: #2196F3;
  box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.2);
}

.action-buttons {
  display: flex;
  gap: 8px;
}

.action-btn {
  flex: 1;
  padding: 6px 12px;
  font-size: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}

.action-btn:hover {
  background: #f5f5f5;
  border-color: #ccc;
}

.enzyme-list {
  flex: 1;
  overflow-y: auto;
  max-height: 300px;
  border: 1px solid #eee;
  border-radius: 4px;
}

.enzyme-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
}

.enzyme-row:hover {
  background: #f5f5f5;
}

.enzyme-row input[type="checkbox"] {
  margin: 0;
}

.enzyme-name {
  font-weight: 500;
  min-width: 60px;
}

.enzyme-sequence {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 11px;
  color: #666;
  flex: 1;
}

.enzyme-count {
  color: #999;
  font-size: 12px;
}

.summary {
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 12px;
  color: #666;
  text-align: center;
}

/* Mobile responsiveness */
@media (max-width: 768px) {
  .restriction-panel {
    top: 120px;
    right: 10px;
    left: 10px;
    width: auto;
  }
}
</style>
