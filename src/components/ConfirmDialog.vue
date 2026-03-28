<script setup>
import { watch, ref, nextTick } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: 'Confirm'
  },
  message: {
    type: String,
    default: 'Are you sure?'
  },
  confirmLabel: {
    type: String,
    default: 'Delete'
  },
  cancelLabel: {
    type: String,
    default: 'Cancel'
  },
  confirmClass: {
    type: String,
    default: 'danger'  // 'danger' or 'primary'
  }
})

const emit = defineEmits(['confirm', 'cancel'])

const confirmBtnRef = ref(null)

// Focus confirm button when dialog opens
watch(() => props.visible, async (visible) => {
  if (visible) {
    await nextTick()
    confirmBtnRef.value?.focus()
  }
})

function handleConfirm() {
  emit('confirm')
}

function handleCancel() {
  emit('cancel')
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    handleCancel()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="confirm-overlay" @click="handleCancel" @keydown="handleKeydown">
      <div class="confirm-dialog" @click.stop>
        <div class="confirm-header">
          <h3>{{ title }}</h3>
        </div>
        <div class="confirm-body">
          <p>{{ message }}</p>
        </div>
        <div class="confirm-actions">
          <button class="btn btn-cancel" @click="handleCancel">{{ cancelLabel }}</button>
          <button
            ref="confirmBtnRef"
            :class="['btn', confirmClass === 'danger' ? 'btn-danger' : 'btn-primary']"
            @click="handleConfirm"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.confirm-dialog {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  min-width: 300px;
  max-width: 400px;
}

.confirm-header {
  padding: 16px 20px 8px;
  border-bottom: 1px solid #e5e7eb;
}

.confirm-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}

.confirm-body {
  padding: 16px 20px;
}

.confirm-body p {
  margin: 0;
  color: #4b5563;
  font-size: 14px;
  line-height: 1.5;
}

.confirm-actions {
  padding: 12px 20px 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background-color 0.15s;
}

.btn-cancel {
  background: #f3f4f6;
  color: #374151;
}

.btn-cancel:hover {
  background: #e5e7eb;
}

.btn-danger {
  background: #dc2626;
  color: white;
}

.btn-danger:hover {
  background: #b91c1c;
}

.btn-primary {
  background: #2563eb;
  color: white;
}

.btn-primary:hover {
  background: #1d4ed8;
}

.btn:focus {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}
</style>
