<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: Number,
    default: null
  },
  annotation: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:modelValue'])

const maxLength = computed(() => props.annotation?.length || 0)

function onInput(event) {
  const value = event.target.value
  if (value === '') {
    emit('update:modelValue', null)
  } else {
    emit('update:modelValue', parseInt(value, 10))
  }
}
</script>

<template>
  <input
    type="number"
    :value="modelValue"
    :min="1"
    :max="maxLength - 1"
    @input="onInput"
    class="primer-bind-editor"
  />
</template>

<style scoped>
.primer-bind-editor {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}
</style>
