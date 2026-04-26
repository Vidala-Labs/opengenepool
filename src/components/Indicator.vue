<script setup>
defineProps({
  text: {
    type: String,
    default: null
  }
})
</script>

<template>
  <div
    v-if="text"
    class="selection-status"
  >{{ text }}</div>
</template>

<style scoped>
.selection-status {
  position: absolute;
  bottom: 0.75rem;
  right: 1rem;
  background: rgba(0, 0, 0, 0.75);
  color: white;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-family: monospace;
  pointer-events: none;
  z-index: 10;
}
</style>
