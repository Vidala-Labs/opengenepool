<script setup>
import { ref, computed, watch } from 'vue'
import { TrashIcon, PlusIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/vue/20/solid'
import { Span, Range, Orientation } from '../utils/dna.js'

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  span: {
    type: Span,
    default: () => new Span()
  },
  sequenceLength: {
    type: Number,
    default: null
  },
  readonly: {
    type: Boolean,
    default: false
  },
  /** Existing annotation to edit (null = create mode) */
  annotation: {
    type: Object,
    default: null
  },
  /** Additional field definitions from extensions/plugins */
  additionalFields: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'create', 'update'])

// Edit mode when an existing annotation is passed
const isEditMode = computed(() => props.annotation !== null)

// Standard annotation types
const STANDARD_TYPES = [
  'gene', 'CDS', 'promoter', 'terminator', 'misc_feature',
  'rep_origin', 'primer_bind', 'protein_bind', 'regulatory',
  'source', 'exon', 'intron', 'mRNA', 'rRNA', 'tRNA', 'ncRNA', 'misc_RNA'
]

// Optional fields that can be added
const OPTIONAL_FIELDS = [
  { key: 'gene', label: 'Gene' },
  { key: 'product', label: 'Product' },
  { key: 'note', label: 'Note' },
  { key: 'locus_tag', label: 'Locus Tag' },
  { key: 'protein_id', label: 'Protein ID' },
  { key: 'translation', label: 'Translation' },
  { key: 'db_xref', label: 'DB Xref' },
  { key: 'codon_start', label: 'Codon Start' }
]

// Form state
const caption = ref('')
const annotationType = ref('')
const ranges = ref([])
const attributes = ref({})
const visibleFields = ref([])
const customFieldName = ref('')
const additionalFieldValues = ref({})

// Additional fields filtered by current annotation type
const activeAdditionalFields = computed(() => {
  if (!annotationType.value) return []
  return props.additionalFields.filter(field => {
    // Must match annotation type
    if (!field.forTypes.includes(annotationType.value)) return false
    // primer_bind only available for single-range annotations
    if (field.key === 'primer_bind' && ranges.value.length !== 1) return false
    return true
  })
})

// Annotation length computed from ranges
const annotationLength = computed(() => {
  if (!ranges.value || ranges.value.length === 0) return 0
  // Sum up all range lengths
  return ranges.value.reduce((total, range) => {
    return total + (range.end - range.start + 1)
  }, 0)
})

// Full annotation context for extension editors
const annotationContext = computed(() => ({
  type: annotationType.value,
  label: caption.value,
  ranges: ranges.value,
  length: annotationLength.value,
  attributes: attributes.value
}))

// Convert Span object to form-friendly range array
function spanToFormRanges(span) {
  if (!span || !span.ranges || span.ranges.length === 0) {
    return [{ start: 1, end: 1, strand: 'forward', startIndefinite: false, endIndefinite: false }]
  }
  return span.ranges.map(range => ({
    start: range.start + 1,  // Convert fenced to GenBank (1-based)
    end: range.end,
    strand: orientationToStrand(range.orientation),
    startIndefinite: range.startIndefinite,
    endIndefinite: range.endIndefinite
  }))
}

function orientationToStrand(orientation) {
  switch (orientation) {
    case Orientation.MINUS: return 'reverse'
    case Orientation.NONE: return 'none'
    default: return 'forward'
  }
}

function strandToOrientation(strand) {
  switch (strand) {
    case 'reverse': return Orientation.MINUS
    case 'none': return Orientation.NONE
    default: return Orientation.PLUS
  }
}

// Initialize form from span prop (create mode) or annotation (edit mode) when modal opens
watch(() => props.open, (isOpen) => {
  if (isOpen && !props.readonly) {
    if (props.annotation) {
      // Edit mode - pre-fill from existing annotation
      caption.value = props.annotation.caption || ''
      annotationType.value = props.annotation.type || ''
      // Get ranges from existing annotation span
      ranges.value = spanToFormRanges(props.annotation.span || props.span)
      // Pre-fill attributes (filter underscore-prefixed keys and extension keys from display)
      const attrs = props.annotation.attributes || {}
      attributes.value = { ...attrs }
      // Build set of keys handled by additionalFields extensions
      const extensionKeys = new Set(props.additionalFields.map(f => f.key))
      visibleFields.value = Object.keys(attrs).filter(key =>
        !key.startsWith('_') && !extensionKeys.has(key)
      )
      // Pre-fill additional field values from existing attributes
      additionalFieldValues.value = {}
      for (const field of props.additionalFields) {
        if (field.key in attrs) {
          additionalFieldValues.value[field.key] = attrs[field.key]
        }
      }
    } else {
      // Create mode - use span prop and reset fields
      ranges.value = spanToFormRanges(props.span)
      caption.value = ''
      annotationType.value = ''
      attributes.value = {}
      visibleFields.value = []
      additionalFieldValues.value = {}
    }
    customFieldName.value = ''
  }
}, { immediate: true })

// Computed label for ranges section
const rangesLabel = computed(() => {
  return ranges.value.length === 1 ? 'Range' : 'Ranges'
})

// Build span object from current ranges
const computedSpan = computed(() => {
  return new Span(ranges.value.map(range => new Range(
    (parseInt(range.start, 10) || 1) - 1,
    parseInt(range.end, 10) || 0,
    strandToOrientation(range.strand),
    range.startIndefinite,
    range.endIndefinite
  )))
})

// Check if a range is complete (has both start and end values)
function isRangeComplete(range) {
  const start = range.start
  const end = range.end
  // Check that both values exist and are valid numbers
  return start !== '' && start !== null && start !== undefined &&
         end !== '' && end !== null && end !== undefined
}

// Check if two ranges overlap (adjacent ranges like 0..10 and 10..20 do NOT overlap)
function rangesOverlap(r1, r2) {
  const s1 = Number(r1.start)
  const e1 = Number(r1.end)
  const s2 = Number(r2.start)
  const e2 = Number(r2.end)
  // Overlap: start1 < end2 AND start2 < end1
  // Using < (not <=) means adjacent ranges don't count as overlapping
  return s1 < e2 && s2 < e1
}

// Computed: which range indices overlap with a previous range
const overlappingRanges = computed(() => {
  const overlaps = new Set()
  for (let i = 1; i < ranges.value.length; i++) {
    if (!isRangeComplete(ranges.value[i])) continue
    for (let j = 0; j < i; j++) {
      if (!isRangeComplete(ranges.value[j])) continue
      if (rangesOverlap(ranges.value[i], ranges.value[j])) {
        overlaps.add(i)
        break
      }
    }
  }
  return overlaps
})

// Form validation
const isValid = computed(() => {
  if (!caption.value.trim()) return false
  if (!annotationType.value.trim()) return false
  // All ranges must be complete
  if (!ranges.value.every(isRangeComplete)) return false
  // No ranges can overlap
  if (overlappingRanges.value.size > 0) return false
  return true
})

// Range management functions
function addRange() {
  const lastStrand = ranges.value.length > 0
    ? ranges.value[ranges.value.length - 1].strand
    : 'forward'
  ranges.value.push({ start: '', end: '', strand: lastStrand, startIndefinite: false, endIndefinite: false })
}

function removeRange(index) {
  ranges.value.splice(index, 1)
}

function moveRangeUp(index) {
  if (index > 0) {
    const temp = ranges.value[index]
    ranges.value[index] = ranges.value[index - 1]
    ranges.value[index - 1] = temp
  }
}

function moveRangeDown(index) {
  if (index < ranges.value.length - 1) {
    const temp = ranges.value[index]
    ranges.value[index] = ranges.value[index + 1]
    ranges.value[index + 1] = temp
  }
}

// Available fields to add (not yet visible)
const availableToAdd = computed(() => {
  const visibleKeys = new Set(visibleFields.value)
  return OPTIONAL_FIELDS.filter(f => !visibleKeys.has(f.key))
})

function addField(key) {
  if (key && !visibleFields.value.includes(key)) {
    visibleFields.value.push(key)
    attributes.value[key] = ''
  }
}

function addCustomField() {
  const key = customFieldName.value.trim()
  if (key && !visibleFields.value.includes(key)) {
    visibleFields.value.push(key)
    attributes.value[key] = ''
    customFieldName.value = ''
  }
}

function removeField(key) {
  visibleFields.value = visibleFields.value.filter(k => k !== key)
  delete attributes.value[key]
}

function getFieldLabel(key) {
  const field = OPTIONAL_FIELDS.find(f => f.key === key)
  return field ? field.label : key
}

function clearAdditionalField(key) {
  delete additionalFieldValues.value[key]
  delete attributes.value[key]
}

function close() {
  emit('close')
}

function handleSubmit() {
  if (!isValid.value) return

  // Keys handled by extension fields - these should only come from additionalFieldValues
  const activeExtensionKeys = new Set(activeAdditionalFields.value.map(f => f.key))

  // Build final attributes (only non-empty values, exclude underscore-prefixed internal attrs)
  const finalAttrs = {}
  for (const [key, value] of Object.entries(attributes.value)) {
    // Skip internal attributes (underscore prefix = one-way from backend)
    if (key.startsWith('_')) continue
    // Skip keys handled by extension fields - they're managed via additionalFieldValues
    if (activeExtensionKeys.has(key)) continue
    if (typeof value === 'string') {
      if (value.trim()) {
        finalAttrs[key] = value.trim()
      }
    } else if (value !== null && value !== undefined) {
      finalAttrs[key] = value
    }
  }

  // Include additional field values (only for active fields matching current type)
  for (const [key, value] of Object.entries(additionalFieldValues.value)) {
    if (activeExtensionKeys.has(key) && value !== null && value !== undefined && value !== '') {
      finalAttrs[key] = value
    }
  }

  // Adjust primer_bind when primer annotation ranges change
  // Keep the binding divider at the same absolute position
  if (isEditMode.value && annotationType.value === 'primer' && props.annotation?.attributes?.primer_bind !== undefined) {
    const originalSpan = props.annotation.span
    const newSpan = computedSpan.value
    const originalPrimerBind = props.annotation.attributes.primer_bind

    if (originalSpan?.ranges?.length === 1 && newSpan?.ranges?.length === 1) {
      const originalRange = originalSpan.ranges[0]
      const newRange = newSpan.ranges[0]

      // Calculate divider position based on orientation
      // For PLUS (forward): 3' end is at range.end, divider at end - primer_bind
      // For MINUS (reverse): 3' end is at range.start, divider at start + primer_bind
      let dividerPos
      let newPrimerBind

      if (originalRange.orientation === Orientation.PLUS) {
        dividerPos = originalRange.end - originalPrimerBind
        newPrimerBind = newRange.end - dividerPos
      } else if (originalRange.orientation === Orientation.MINUS) {
        dividerPos = originalRange.start + originalPrimerBind
        newPrimerBind = dividerPos - newRange.start
      }

      // Validate new primer_bind: must be >= 1 and < new annotation length
      const newLength = newRange.end - newRange.start
      if (newPrimerBind >= 1 && newPrimerBind < newLength) {
        finalAttrs.primer_bind = newPrimerBind
      } else {
        // Invalid - explicitly delete since it may have been copied from additionalFieldValues
        delete finalAttrs.primer_bind
      }
    }
  }

  const data = {
    caption: caption.value.trim(),
    type: annotationType.value.trim(),
    span: computedSpan.value,
    attributes: finalAttrs
  }

  if (isEditMode.value) {
    emit('update', data)
  } else {
    emit('create', data)
  }

  emit('close')
}

function onOverlayClick() {
  close()
}
</script>

<template>
  <div v-if="open && !readonly" class="modal-overlay" @click="onOverlayClick">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h3>{{ isEditMode ? 'Edit Annotation' : 'Create Annotation' }}</h3>
        <button class="modal-close" @click="close">&times;</button>
      </div>

      <div class="modal-body">
        <form class="annotation-form" @submit.prevent="handleSubmit">
          <!-- Caption (required) -->
          <div class="form-group">
            <label for="annotation-caption">Caption <span class="required">*</span></label>
            <input
              type="text"
              id="annotation-caption"
              v-model="caption"
              placeholder="e.g., GFP, lacZ, T7 promoter"
            />
          </div>

          <!-- Type (combo control: input + datalist) -->
          <div class="form-group">
            <label for="annotation-type">Type <span class="required">*</span></label>
            <input
              type="text"
              id="annotation-type"
              v-model="annotationType"
              list="annotation-type-list"
              placeholder="Select or type a custom type"
            />
            <datalist id="annotation-type-list">
              <option v-for="t in STANDARD_TYPES" :key="t" :value="t" />
            </datalist>
          </div>

          <!-- Ranges section -->
          <div class="form-group ranges-section">
            <div class="form-label-row">
              <label>{{ rangesLabel }}</label>
              <button type="button" class="btn-add-range" @click="addRange" title="Add range">
                <PlusIcon class="icon-small" />
              </button>
            </div>
            <div
              v-for="(range, index) in ranges"
              :key="index"
              class="range-row"
            >
              <template v-if="ranges.length > 1">
                <button
                  type="button"
                  class="btn-remove-range"
                  @click="removeRange(index)"
                  title="Remove range"
                >
                  <TrashIcon class="icon-small" />
                </button>
                <div class="range-move-controls">
                  <button
                    v-if="index > 0"
                    type="button"
                    class="btn-move-up"
                    @click="moveRangeUp(index)"
                    title="Move up"
                  >
                    <ChevronUpIcon class="icon-small" />
                  </button>
                  <button
                    v-if="index < ranges.length - 1"
                    type="button"
                    class="btn-move-down"
                    @click="moveRangeDown(index)"
                    title="Move down"
                  >
                    <ChevronDownIcon class="icon-small" />
                  </button>
                </div>
              </template>
              <label class="indefinite-checkbox" title="5' indefinite (uncertain start)">
                <input type="checkbox" v-model="range.startIndefinite" />
                <span>&lt;</span>
              </label>
              <input
                type="number"
                class="range-start"
                v-model="range.start"
                min="1"
                :max="range.end !== '' && range.end !== null ? Number(range.end) : props.sequenceLength"
                placeholder="Start"
              />
              <input
                type="number"
                class="range-end"
                v-model="range.end"
                :min="range.start !== '' && range.start !== null ? Number(range.start) : 1"
                :max="props.sequenceLength"
                placeholder="End"
              />
              <label class="indefinite-checkbox" title="3' indefinite (uncertain end)">
                <input type="checkbox" v-model="range.endIndefinite" />
                <span>&gt;</span>
              </label>
              <select class="range-strand" v-model="range.strand">
                <option value="forward">Forward</option>
                <option value="reverse">Reverse</option>
                <option value="none">None</option>
              </select>
              <div v-if="overlappingRanges.has(index)" class="range-overlap-error">
                ! This range overlaps with a previous range
              </div>
            </div>
          </div>

          <!-- Optional fields -->
          <div v-for="key in visibleFields" :key="key" class="form-group">
            <div class="form-label-row">
              <label :for="'annotation-attr-' + key">{{ getFieldLabel(key) }}</label>
              <button
                type="button"
                class="btn-remove-field"
                @click="removeField(key)"
                title="Remove field"
              >
                <TrashIcon class="icon-small" />
              </button>
            </div>
            <textarea
              v-if="key === 'translation' || key === 'note'"
              :id="'annotation-attr-' + key"
              v-model="attributes[key]"
              rows="3"
            ></textarea>
            <input
              v-else
              type="text"
              :id="'annotation-attr-' + key"
              v-model="attributes[key]"
            />
          </div>

          <!-- Additional fields from extensions/plugins -->
          <div v-for="field in activeAdditionalFields" :key="field.key" class="form-group">
            <div class="form-label-row">
              <label :for="'annotation-additional-' + field.key">{{ field.label }}</label>
              <button
                v-if="additionalFieldValues[field.key] !== undefined && additionalFieldValues[field.key] !== null && additionalFieldValues[field.key] !== ''"
                type="button"
                class="btn-remove-field"
                @click="clearAdditionalField(field.key)"
                title="Clear field"
              >
                <TrashIcon class="icon-small" />
              </button>
            </div>
            <component
              :is="field.editor"
              :id="'annotation-additional-' + field.key"
              v-model="additionalFieldValues[field.key]"
              :annotation="annotationContext"
            />
          </div>

          <!-- Add field dropdown and actions -->
          <div class="form-actions">
            <div class="add-field-controls">
              <button
                v-if="customFieldName.trim()"
                type="button"
                class="add-field-button"
                @click="addCustomField"
              >
                Add field:
              </button>
              <select
                v-else-if="availableToAdd.length > 0"
                class="add-field-select"
                @change="addField($event.target.value); $event.target.value = ''"
              >
                <option value="">Add field...</option>
                <option v-for="field in availableToAdd" :key="field.key" :value="field.key">
                  {{ field.label }}
                </option>
              </select>
              <input
                type="text"
                class="custom-field-input"
                v-model="customFieldName"
                placeholder="Custom field"
                @keyup.enter="addCustomField"
              />
            </div>
            <div class="form-actions-right">
              <button type="button" class="btn-cancel" @click="close">Cancel</button>
              <button type="submit" class="btn-create" :disabled="!isValid">{{ isEditMode ? 'Update' : 'Create' }}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
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

.modal-content {
  background: white;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  padding: 0 4px;
  line-height: 1;
}

.modal-close:hover {
  color: #333;
}

.modal-body {
  padding: 20px;
}

.annotation-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group > label:first-child,
.form-label-row > label {
  font-weight: 600;
  font-size: 13px;
  color: #666;
}

.required {
  color: #cc4444;
}

.form-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-remove-field {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #cc4444;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.btn-remove-field:hover {
  opacity: 1;
}

.icon-small {
  width: 14px;
  height: 14px;
  display: block;
}

.form-group select,
.form-group input[type="text"],
.form-group input[type="number"],
.form-group textarea {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

.ranges-section {
  gap: 8px;
}

.btn-add-range {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #4CAF50;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.btn-add-range:hover {
  opacity: 1;
}

.range-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.range-overlap-error {
  width: 100%;
  color: #cc4444;
  font-size: 12px;
  margin-top: -4px;
}

.range-row .btn-remove-range {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #cc4444;
  opacity: 0.6;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.range-row .btn-remove-range:hover {
  opacity: 1;
}

.range-move-controls {
  display: flex;
  flex-direction: column;
  width: 18px;
  flex-shrink: 0;
}

.range-move-controls button {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: #666;
  opacity: 0.6;
  transition: opacity 0.15s;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.range-move-controls button:hover {
  opacity: 1;
}

.range-row .range-start,
.range-row .range-end {
  flex: 1;
  min-width: 0;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

.indefinite-checkbox {
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: #666;
  flex-shrink: 0;
}

.indefinite-checkbox input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
  margin: 0;
}

.indefinite-checkbox:has(input:checked) span {
  color: #4CAF50;
}

.range-row .range-strand {
  width: 100px;
  flex-shrink: 0;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

.form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.form-actions-right {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.btn-cancel {
  padding: 8px 16px;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
}

.btn-cancel:hover {
  background: #e0e0e0;
}

.btn-create {
  padding: 8px 16px;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-create:hover:not(:disabled) {
  background: #45a049;
}

.btn-create:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.add-field-select {
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  font-size: 13px;
  cursor: pointer;
  color: #666;
}

.add-field-select:hover {
  border-color: #999;
}

.add-field-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.custom-field-input {
  width: 120px;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
}

.custom-field-input:focus {
  outline: none;
  border-color: #4CAF50;
}

.add-field-button {
  padding: 8px 12px;
  border: 1px solid #4CAF50;
  border-radius: 4px;
  background: #f0fff0;
  font-size: 13px;
  cursor: pointer;
  color: #4CAF50;
}

.add-field-button:hover {
  background: #e0ffe0;
}
</style>
