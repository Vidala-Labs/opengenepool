<script setup>
defineProps({
  value: {
    type: Number,
    default: null
  }
})
</script>

<template>
  <span v-if="value !== null && value !== undefined" class="primer-bind-display">
    {{ value }} bp
  </span>
</template>

<style scoped>
.primer-bind-display {
  color: #333;
}
</style>
