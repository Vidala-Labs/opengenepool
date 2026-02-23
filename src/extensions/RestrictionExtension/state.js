import { ref, computed, watch } from 'vue'
import { ENZYMES } from './enzymes.js'
import { findAllCutSites, countCutSites } from './restriction-utils.js'

// localStorage key prefix
const STORAGE_KEY_PREFIX = 'opengenepool:restriction:'

// Whether restriction sites are displayed (toggled by button click)
export const restrictionSitesVisible = ref(false)

// Panel visibility state (toggled by right-click)
export const restrictionPanelVisible = ref(false)

// Selected enzyme names (Set of enzyme names that are checked)
export const selectedEnzymeNames = ref(new Set())

// Current sequence (updated by panel when it mounts/changes)
export const currentSequence = ref('')

// Current construct title (used for localStorage key)
export const currentConstructTitle = ref('')

// Computed: Get selected enzyme objects
export const selectedEnzymes = computed(() => {
  return ENZYMES.filter(e => selectedEnzymeNames.value.has(e.name))
})

// Computed: Cut sites for selected enzymes
export const cutSites = computed(() => {
  if (!currentSequence.value || selectedEnzymeNames.value.size === 0) {
    return []
  }
  return findAllCutSites(currentSequence.value, selectedEnzymes.value)
})

// Computed: Cut site counts for all enzymes
export const cutSiteCounts = computed(() => {
  if (!currentSequence.value) {
    return new Map()
  }
  return countCutSites(currentSequence.value, ENZYMES)
})

// Get enzymes that cut exactly once (one-cutters)
export const oneCutters = computed(() => {
  const counts = cutSiteCounts.value
  return ENZYMES.filter(e => counts.get(e.name) === 1).map(e => e.name)
})

// Toggle enzyme selection
export function toggleEnzyme(enzymeName) {
  const newSet = new Set(selectedEnzymeNames.value)
  if (newSet.has(enzymeName)) {
    newSet.delete(enzymeName)
  } else {
    newSet.add(enzymeName)
  }
  selectedEnzymeNames.value = newSet
  saveSelection()
}

// Select all enzymes
export function selectAllEnzymes() {
  selectedEnzymeNames.value = new Set(ENZYMES.map(e => e.name))
  saveSelection()
}

// Clear all enzyme selections
export function clearAllEnzymes() {
  selectedEnzymeNames.value = new Set()
  saveSelection()
}

// Select only one-cutters
export function selectOneCutters() {
  selectedEnzymeNames.value = new Set(oneCutters.value)
  saveSelection()
}

// Save current selection to localStorage
function saveSelection() {
  if (!currentConstructTitle.value) return

  try {
    const key = STORAGE_KEY_PREFIX + currentConstructTitle.value
    const enzymes = Array.from(selectedEnzymeNames.value)
    localStorage.setItem(key, JSON.stringify(enzymes))
  } catch (e) {
    // localStorage may not be available
  }
}

// Load selection from localStorage, or default to one-cutters
function loadSelection() {
  if (!currentConstructTitle.value) return

  try {
    const key = STORAGE_KEY_PREFIX + currentConstructTitle.value
    const stored = localStorage.getItem(key)

    if (stored) {
      const enzymes = JSON.parse(stored)
      selectedEnzymeNames.value = new Set(enzymes)
    } else {
      // Default to one-cutters for new constructs
      selectOneCutters()
    }
  } catch (e) {
    // localStorage may not be available, default to one-cutters
    selectOneCutters()
  }
}

// Update the current sequence and construct title
export function setSequence(sequence, title = '') {
  const sequenceChanged = currentSequence.value !== sequence
  const titleChanged = currentConstructTitle.value !== title

  currentSequence.value = sequence || ''

  // If title changed, load the saved selection for this construct
  if (titleChanged && title) {
    currentConstructTitle.value = title
    loadSelection()
  } else if (titleChanged) {
    currentConstructTitle.value = title
  }

  // If sequence changed but title didn't, recompute one-cutters if using default
  // (The computed will automatically update)
}
