<script setup>
import { cdsSearchVisible } from './state.js'

function openCDSSearch() {
  cdsSearchVisible.value = true
}
</script>

<template>
  <button class="toolbar-icon-btn" @click="openCDSSearch" title="Find ORFs (Open Reading Frames)">
    <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <!-- Gene arrow pointing right -->
      <path d="M4 12h12m0 0l-4-4m4 4l-4 4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="19" cy="12" r="2" fill="currentColor" stroke="none"/>
    </svg>
  </button>
</template>

<style scoped>
.toolbar-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  color: #666;
  cursor: pointer;
}

.toolbar-icon-btn:hover {
  background: #f0f0f0;
  color: #333;
  border-color: #ccc;
}

.toolbar-icon {
  width: 18px;
  height: 18px;
}
</style>
