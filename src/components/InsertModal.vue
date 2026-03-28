<script setup>
import { ref, watch, nextTick, computed } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  initialText: {
    type: String,
    default: ''
  },
  isReplace: {
    type: Boolean,
    default: false
  },
  position: {
    type: Number,
    default: 0
  },
  overlayAnnotationCount: {
    type: Number,
    default: 0
  },
  selectionLength: {
    type: Number,
    default: 0
  },
  affectedAnnotationCount: {
    type: Number,
    default: 0
  },
  touchingAnnotations: {
    type: Array,
    default: () => []
  },
  orientation: {
    type: Number,
    default: 1  // 1 = plus strand, -1 = minus strand
  }
})

const emit = defineEmits(['submit', 'cancel'])

const inputRef = ref(null)
const text = ref('')
const includeAnnotations = ref(true)
const preserveAnnotations = ref(false)
const extendSelections = ref([])  // Array of keys like 'ann1:start', 'ann2:end'

// Computed: current text length matches selection length (equal-length replace)
const isEqualLengthReplace = computed(() => {
  if (!props.isReplace || props.selectionLength === 0) return false
  const cleanedLength = text.value.toUpperCase().replace(/[^ATCGNRYSWKMBDHV]/g, '').length
  return cleanedLength === props.selectionLength
})

// Show radio buttons when equal-length replace AND there are overlay annotations AND affected annotations
const showRadioButtons = computed(() => isEqualLengthReplace.value && props.overlayAnnotationCount > 0 && props.affectedAnnotationCount > 0)

// Show checkbox when equal-length replace AND no overlay annotations AND there are affected annotations
const showPreserveCheckbox = computed(() => isEqualLengthReplace.value && props.overlayAnnotationCount === 0 && props.affectedAnnotationCount > 0)

// Update text when initialText changes
watch(() => props.initialText, (val) => {
  text.value = val
})

// Reset state when modal opens
watch(() => props.visible, (visible) => {
  if (visible) {
    includeAnnotations.value = true
    preserveAnnotations.value = false
    extendSelections.value = []
  }
})

// Focus input when modal becomes visible
watch(() => props.visible, async (visible) => {
  if (visible) {
    text.value = props.initialText
    await nextTick()
    inputRef.value?.focus()
    // Move cursor to end (not select all)
    const len = text.value.length
    inputRef.value?.setSelectionRange(len, len)
  }
}, { immediate: true })

function handleSubmit() {
  // Remove whitespace/newlines and invalid characters, uppercase
  const value = text.value.toUpperCase().replace(/[^ATCGNRYSWKMBDHV]/g, '')
  if (value) {
    // Determine annotation mode:
    // - "preserve" = don't adjust existing annotations, no overlay annotations
    // - "include" = adjust existing annotations, include overlay annotations
    // - "default" = adjust existing annotations, no overlay annotations
    let annotationMode = 'default'
    if (preserveAnnotations.value) {
      annotationMode = 'preserve'
    } else if (showRadioButtons.value || (props.overlayAnnotationCount > 0 && includeAnnotations.value)) {
      annotationMode = 'include'
    }
    emit('submit', value, annotationMode, extendSelections.value)
  }
  text.value = ''
}

function handleCancel() {
  text.value = ''
  emit('cancel')
}

function handleKeyDown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    handleSubmit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    handleCancel()
  }
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="handleCancel">
    <div class="modal-content">
      <label class="modal-label">
        {{ isReplace ? 'Replace sequence with:' : `Insert sequence at ${position}:` }}
      </label>
      <textarea
        ref="inputRef"
        v-model="text"
        class="modal-input"
        placeholder="Enter DNA sequence (A, T, C, G, N, ...)"
        rows="4"
        @keydown="handleKeyDown"
      />
      <div class="modal-hint">
        Valid characters: A, T, C, G, N, R, Y, S, W, K, M, B, D, H, V
      </div>
      <!-- Warning for reverse complement replacement -->
      <div v-if="isReplace && orientation === -1" class="reverse-complement-warning">
        This sequence will be inserted as a reverse complement.
      </div>
      <!-- Radio buttons for equal-length replace with overlay annotations -->
      <div v-if="showRadioButtons" class="annotation-options">
        <label class="annotation-radio">
          <input type="radio" v-model="preserveAnnotations" :value="false" />
          <span>Include {{ overlayAnnotationCount }} annotation{{ overlayAnnotationCount === 1 ? '' : 's' }}</span>
        </label>
        <label class="annotation-radio">
          <input type="radio" v-model="preserveAnnotations" :value="true" />
          <span>Sequence only (preserve existing annotations)</span>
        </label>
      </div>
      <!-- Checkbox for overlay annotations when NOT equal-length replace -->
      <label v-else-if="overlayAnnotationCount > 0" class="annotation-toggle">
        <input type="checkbox" v-model="includeAnnotations" />
        <span>Include {{ overlayAnnotationCount }} annotation{{ overlayAnnotationCount === 1 ? '' : 's' }}</span>
      </label>
      <!-- Checkbox for preserving annotations when no overlay annotations but equal-length replace -->
      <label v-if="showPreserveCheckbox" class="annotation-toggle">
        <input type="checkbox" v-model="preserveAnnotations" />
        <span>Preserve existing annotations</span>
      </label>
      <!-- Checkboxes for extending annotations at insertion point (disciplined inserts) -->
      <div v-if="!isReplace && touchingAnnotations.length > 0" class="extend-annotations">
        <div class="extend-label">Extend annotations to include insert:</div>
        <label v-for="ann in touchingAnnotations" :key="ann.key" class="annotation-checkbox">
          <input type="checkbox" v-model="extendSelections" :value="ann.key" />
          <span class="annotation-name">{{ ann.label }}</span>
        </label>
      </div>
      <div class="modal-buttons">
        <button class="btn btn-cancel" @click="handleCancel">Cancel</button>
        <button class="btn btn-submit" @click="handleSubmit">
          {{ isReplace ? 'Replace' : 'Insert' }}
        </button>
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
  padding: 20px;
  min-width: 350px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
  color: #333;
}

.modal-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  font-family: monospace;
  border: 1px solid #ccc;
  border-radius: 4px;
  text-transform: uppercase;
  box-sizing: border-box;
  resize: vertical;
  line-height: 1.4;
}

.modal-input:focus {
  outline: none;
  border-color: #4a90d9;
  box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.2);
}

.modal-hint {
  font-size: 11px;
  color: #888;
  margin-top: 6px;
}

.reverse-complement-warning {
  font-size: 11px;
  font-style: italic;
  color: #996600;
  margin-top: 6px;
}

.modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  padding: 8px 16px;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid #ccc;
}

.btn-cancel {
  background: white;
  color: #333;
}

.btn-cancel:hover {
  background: #f0f0f0;
}

.btn-submit {
  background: #4a90d9;
  color: white;
  border-color: #4a90d9;
}

.btn-submit:hover {
  background: #357abd;
}

.annotation-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: #333;
  cursor: pointer;
}

.annotation-toggle input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.annotation-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.annotation-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #333;
  cursor: pointer;
}

.annotation-radio input[type="radio"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.extend-annotations {
  margin-top: 12px;
  padding: 8px;
  background: #f8f8f8;
  border-radius: 4px;
}

.extend-label {
  font-size: 12px;
  color: #666;
  margin-bottom: 6px;
}

.annotation-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #333;
  cursor: pointer;
  padding: 4px 0;
}

.annotation-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.annotation-name {
  font-family: monospace;
  font-size: 12px;
}
</style>
