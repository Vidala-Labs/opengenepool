<script setup>
import { ref, watch, nextTick } from 'vue'

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
  }
})

const emit = defineEmits(['submit', 'cancel'])

const inputRef = ref(null)
const text = ref('')
const includeAnnotations = ref(true)

// Update text when initialText changes
watch(() => props.initialText, (val) => {
  text.value = val
})

// Reset includeAnnotations when modal opens
watch(() => props.visible, (visible) => {
  if (visible) {
    includeAnnotations.value = true
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
    emit('submit', value, includeAnnotations.value)
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
      <label v-if="overlayAnnotationCount > 0" class="annotation-toggle">
        <input type="checkbox" v-model="includeAnnotations" />
        <span>Include {{ overlayAnnotationCount }} annotation{{ overlayAnnotationCount === 1 ? '' : 's' }}</span>
      </label>
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
</style>
