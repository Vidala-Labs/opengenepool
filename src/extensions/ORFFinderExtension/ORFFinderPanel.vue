<script setup>
import { ref, inject, computed, watch } from 'vue'
import { orfFinderVisible } from './state.js'
import { CODON_TABLE, START_CODONS } from '../../utils/translation.js'
import { reverseComplement, Span } from '../../utils/dna.js'

const extensionAPI = inject('extensionAPI')

// Search parameters
const minLength = ref(50) // minimum amino acids
const results = ref([])
const removedIds = ref(new Set())

// Modal state for CDS naming
const showNameModal = ref(false)
const pendingOrf = ref(null)
const cdsName = ref('')
const nameInput = ref(null)

// Stop codons
const STOP_CODONS = new Set(['TAA', 'TAG', 'TGA'])

/**
 * Find a matching CDS annotation for an ORF.
 * Returns the annotation's caption if found, null otherwise.
 * Also matches when the CDS annotation is missing the stop codon
 * (ORF extends 3bp beyond annotation and those 3bp are a stop codon).
 */
function findMatchingCDS(orf) {
  const annotations = extensionAPI.getAnnotations()
  if (!annotations) return null

  const sequence = extensionAPI.getSequence()

  for (const ann of annotations) {
    // Only check CDS annotations
    if (ann.type?.toUpperCase() !== 'CDS') continue

    // Parse the annotation's span
    const span = ann.span instanceof Span ? ann.span : Span.parse(ann.span)
    if (!span || span.ranges.length === 0) continue

    // For simple single-range CDS, check if it matches the ORF
    if (span.ranges.length === 1) {
      const range = span.ranges[0]
      const annStart = range.start
      const annEnd = range.end
      const annStrand = span.orientation === -1 ? '-' : '+'

      // Exact match
      if (orf.start === annStart && orf.end === annEnd && orf.strand === annStrand) {
        return ann.caption || ann.label || null
      }

      // Check if ORF extends 3bp beyond annotation (missing stop codon case)
      if (orf.start === annStart && orf.strand === annStrand && orf.end === annEnd + 3) {
        // Verify the extra 3 nucleotides are a stop codon
        let stopCodon
        if (orf.strand === '+') {
          stopCodon = sequence.slice(annEnd, annEnd + 3).toUpperCase()
        } else {
          // For minus strand, the stop codon is at the "start" in forward coords
          // but we need to get the reverse complement
          const fwdCodon = sequence.slice(annEnd, annEnd + 3).toUpperCase()
          stopCodon = reverseComplement(fwdCodon)
        }

        if (STOP_CODONS.has(stopCodon)) {
          return ann.caption || ann.label || null
        }
      }
    }
  }

  return null
}

/**
 * Find ORFs in a sequence for a given frame and strand.
 * Returns array of { start, end, strand, length } in 0-based coordinates.
 */
function findORFsInFrame(sequence, frame, strand, isCircular) {
  const orfs = []
  const seqLen = sequence.length

  // For circular sequences, we need to scan beyond the end
  // to catch ORFs that wrap around
  const scanLen = isCircular ? seqLen + seqLen : seqLen
  const extendedSeq = isCircular ? sequence + sequence : sequence

  let i = frame
  while (i + 3 <= scanLen) {
    const codon = extendedSeq.slice(i, i + 3).toUpperCase()

    // Look for start codon
    if (START_CODONS.has(codon)) {
      const orfStart = i % seqLen
      let j = i + 3
      let foundStop = false

      // Continue until stop codon
      while (j + 3 <= scanLen) {
        const nextCodon = extendedSeq.slice(j, j + 3).toUpperCase()

        if (STOP_CODONS.has(nextCodon)) {
          foundStop = true
          const orfEnd = (j + 3) % seqLen || seqLen // handle wraparound
          const aaLength = (j - i) / 3

          if (aaLength >= minLength.value) {
            // For circular wraparound, end might be less than start
            const wrapsAround = isCircular && j >= seqLen

            orfs.push({
              start: orfStart,
              end: orfEnd,
              strand,
              length: aaLength,
              wrapsAround
            })
          }
          break
        }
        j += 3

        // For circular: don't scan more than one full sequence past start
        if (isCircular && j >= i + seqLen) {
          break
        }
      }

      // Move past this start codon
      i += 3
    } else {
      i += 3
    }

    // For non-circular, stop at sequence end
    if (!isCircular && i >= seqLen) {
      break
    }
    // For circular, stop after scanning one full sequence
    if (isCircular && i >= seqLen) {
      break
    }
  }

  return orfs
}

/**
 * Find all ORFs in the sequence across all 6 reading frames.
 */
function findAllORFs() {
  const sequence = extensionAPI.getSequence()
  if (!sequence) {
    results.value = []
    return
  }

  // TODO: Get circular status from API - for now assume linear
  const isCircular = false

  const allORFs = []
  let idCounter = 0

  // Forward strand (frames 0, 1, 2)
  for (let frame = 0; frame < 3; frame++) {
    const orfs = findORFsInFrame(sequence, frame, '+', isCircular)
    for (const orf of orfs) {
      const orfWithId = { ...orf, id: idCounter++, frame: frame + 1 }
      orfWithId.cdsLabel = findMatchingCDS(orfWithId)
      allORFs.push(orfWithId)
    }
  }

  // Reverse strand (frames 0, 1, 2)
  const revComp = reverseComplement(sequence)
  for (let frame = 0; frame < 3; frame++) {
    const orfs = findORFsInFrame(revComp, frame, '-', isCircular)
    for (const orf of orfs) {
      // Convert coordinates back to forward strand
      const seqLen = sequence.length
      const fwdStart = seqLen - orf.end
      const fwdEnd = seqLen - orf.start
      const orfWithId = {
        ...orf,
        start: fwdStart,
        end: fwdEnd,
        id: idCounter++,
        frame: frame + 1
      }
      orfWithId.cdsLabel = findMatchingCDS(orfWithId)
      allORFs.push(orfWithId)
    }
  }

  // Sort by start position
  allORFs.sort((a, b) => a.start - b.start)

  results.value = allORFs
  removedIds.value = new Set()
}

// Filtered results (excluding removed)
const visibleResults = computed(() => {
  return results.value.filter(r => !removedIds.value.has(r.id))
})

/**
 * Format result as GenBank notation.
 */
function formatGenBank(orf) {
  if (orf.strand === '-') {
    return `complement(${orf.start + 1}..${orf.end})`
  }
  return `${orf.start + 1}..${orf.end}`
}

/**
 * Select the ORF region.
 */
function selectORF(orf) {
  const spec = orf.strand === '-'
    ? `(${orf.start}..${orf.end})`
    : `${orf.start}..${orf.end}`
  extensionAPI.setSelection(spec)
}

/**
 * Remove an ORF from the visible list.
 */
function removeORF(orf) {
  removedIds.value.add(orf.id)
  // Trigger reactivity
  removedIds.value = new Set(removedIds.value)
}

/**
 * Open the naming modal for creating a CDS annotation.
 */
function createCDS(orf) {
  pendingOrf.value = orf
  cdsName.value = `ORF_${orf.start + 1}_${orf.end}`
  showNameModal.value = true
  // Focus the input after the modal renders
  setTimeout(() => nameInput.value?.focus(), 50)
}

/**
 * Confirm CDS creation from the modal.
 */
function confirmCreateCDS() {
  const orf = pendingOrf.value
  const name = cdsName.value.trim()
  if (!orf || !name) return

  // Build span string in GenBank notation
  const spanStr = orf.strand === '-'
    ? `(${orf.start}..${orf.end})`
    : `${orf.start}..${orf.end}`

  extensionAPI.addAnnotation({
    span: spanStr,
    type: 'CDS',
    caption: name
  })

  // Update the ORF in the list to show the new annotation name
  const orfIndex = results.value.findIndex(r => r.id === orf.id)
  if (orfIndex !== -1) {
    results.value[orfIndex].cdsLabel = name
  }

  cancelCreateCDS()
}

/**
 * Cancel CDS creation modal.
 */
function cancelCreateCDS() {
  showNameModal.value = false
  pendingOrf.value = null
  cdsName.value = ''
}

function adjustMinLength(delta) {
  minLength.value = Math.max(1, minLength.value + delta)
}

function closePanel() {
  orfFinderVisible.value = false
}

// Auto-scan when panel opens
watch(orfFinderVisible, (visible) => {
  if (visible) {
    findAllORFs()
  }
})
</script>

<template>
  <Transition name="fade">
    <div v-if="orfFinderVisible" class="orf-finder-overlay">
      <div class="orf-finder-panel">
        <div class="panel-header">
          <span class="panel-title">Find ORFs</span>
          <button class="close-btn" @click="closePanel">&times;</button>
        </div>

        <div class="panel-controls">
          <label class="min-length-label">
            Min length (aa):
            <div class="length-input-group">
              <button class="length-btn" @click="adjustMinLength(-10)">-10</button>
              <button class="length-btn" @click="adjustMinLength(-1)">-</button>
              <input
                type="number"
                v-model.number="minLength"
                class="length-input"
                min="1"
              />
              <button class="length-btn" @click="adjustMinLength(1)">+</button>
              <button class="length-btn" @click="adjustMinLength(10)">+10</button>
            </div>
          </label>
          <button class="scan-btn" @click="findAllORFs">Rescan</button>
        </div>

        <div class="results-header">
          {{ visibleResults.length }} ORF{{ visibleResults.length === 1 ? '' : 's' }} found
        </div>

        <div class="results-list">
          <div
            v-for="orf in visibleResults"
            :key="orf.id"
            class="result-item"
          >
            <span
              class="result-location"
              :class="{ 'has-annotation': orf.cdsLabel }"
              @click="selectORF(orf)"
              :title="`${orf.length} aa, frame ${orf.strand}${orf.frame}${orf.cdsLabel ? '' : ' - ' + formatGenBank(orf)}`"
            >
              {{ orf.cdsLabel || formatGenBank(orf) }}
            </span>
            <span class="result-length">{{ orf.length }} aa</span>
            <button v-if="!orf.cdsLabel" class="create-btn" @click="createCDS(orf)" title="Create CDS annotation">+</button>
            <button class="remove-btn" @click="removeORF(orf)" title="Remove from list">&times;</button>
          </div>
          <div v-if="visibleResults.length === 0" class="no-results">
            No ORFs found with minimum length {{ minLength }} aa
          </div>
        </div>
      </div>
    </div>
  </Transition>

  <!-- CDS Naming Modal -->
  <Transition name="fade">
    <div v-if="showNameModal" class="name-modal-overlay" @click.self="cancelCreateCDS">
      <div class="name-modal">
        <div class="name-modal-header">
          <span class="name-modal-title">Create CDS Annotation</span>
          <button class="close-btn" @click="cancelCreateCDS">&times;</button>
        </div>
        <div class="name-modal-body">
          <label class="name-label">
            Name:
            <input
              ref="nameInput"
              v-model="cdsName"
              type="text"
              class="name-input"
              @keydown.enter="confirmCreateCDS"
              @keydown.escape="cancelCreateCDS"
            />
          </label>
          <div v-if="pendingOrf" class="name-modal-info">
            {{ pendingOrf.strand === '-' ? 'complement(' : '' }}{{ pendingOrf.start + 1 }}..{{ pendingOrf.end }}{{ pendingOrf.strand === '-' ? ')' : '' }}
            <span class="info-detail">({{ pendingOrf.length }} aa)</span>
          </div>
        </div>
        <div class="name-modal-footer">
          <button class="btn-cancel" @click="cancelCreateCDS">Cancel</button>
          <button class="btn-confirm" @click="confirmCreateCDS" :disabled="!cdsName.trim()">Create</button>
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

.orf-finder-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  pointer-events: none;
}

.orf-finder-panel {
  position: absolute;
  top: 60px;
  right: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  min-width: 300px;
  max-width: 400px;
  max-height: 70vh;
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
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
  padding: 0 4px;
}

.close-btn:hover {
  color: #333;
}

.panel-controls {
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.min-length-label {
  display: block;
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
}

.length-input-group {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.length-btn {
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
}

.length-btn:hover {
  background: #f5f5f5;
}

.length-input {
  width: 60px;
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  text-align: center;
  font-size: 13px;
}

.scan-btn {
  margin-top: 12px;
  width: 100%;
  padding: 8px 16px;
  background: #4285f4;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.scan-btn:hover {
  background: #3367d6;
}

.results-header {
  padding: 8px 16px;
  font-size: 12px;
  color: #666;
  background: #f9f9f9;
  border-bottom: 1px solid #eee;
}

.results-list {
  flex: 1;
  overflow-y: auto;
  max-height: 300px;
}

.result-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.result-item:last-child {
  border-bottom: none;
}

.result-location {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 13px;
  color: #0066cc;
  cursor: pointer;
  flex: 1;
}

.result-location:hover {
  text-decoration: underline;
}

.result-location.has-annotation {
  color: #2e7d32;
  font-weight: 500;
}

.result-length {
  font-size: 11px;
  color: #999;
  margin-left: 8px;
}

.create-btn {
  background: none;
  border: 1px solid #4a4;
  border-radius: 3px;
  font-size: 14px;
  cursor: pointer;
  color: #4a4;
  padding: 0 6px;
  margin-left: 8px;
  font-weight: bold;
}

.create-btn:hover {
  background: #4a4;
  color: white;
}

.remove-btn {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #ccc;
  padding: 0 4px;
  margin-left: 4px;
}

.remove-btn:hover {
  color: #f44;
}

.no-results {
  padding: 16px;
  text-align: center;
  color: #999;
  font-size: 13px;
}

@media (max-width: 768px) {
  .orf-finder-panel {
    top: 120px;
    right: 10px;
    left: 10px;
    min-width: auto;
    max-width: none;
  }
}

/* CDS Naming Modal */
.name-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.name-modal {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  min-width: 320px;
  max-width: 400px;
}

.name-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}

.name-modal-title {
  font-weight: 600;
  font-size: 14px;
}

.name-modal-body {
  padding: 16px;
}

.name-label {
  display: block;
  font-size: 13px;
  color: #333;
}

.name-input {
  width: 100%;
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

.name-input:focus {
  outline: none;
  border-color: #4285f4;
  box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
}

.name-modal-info {
  margin-top: 12px;
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 12px;
  color: #666;
}

.info-detail {
  color: #999;
  margin-left: 6px;
}

.name-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #eee;
}

.btn-cancel {
  padding: 8px 16px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  color: #666;
  cursor: pointer;
  font-size: 13px;
}

.btn-cancel:hover {
  background: #f5f5f5;
}

.btn-confirm {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  background: #4285f4;
  color: white;
  cursor: pointer;
  font-size: 13px;
}

.btn-confirm:hover:not(:disabled) {
  background: #3367d6;
}

.btn-confirm:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
