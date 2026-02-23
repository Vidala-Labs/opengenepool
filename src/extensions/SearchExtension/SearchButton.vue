<script setup>
import { MagnifyingGlassIcon } from '@heroicons/vue/24/outline'
import { searchVisible } from './state.js'

function openSearch() {
  searchVisible.value = true
}
</script>

<template>
  <button class="toolbar-icon-btn" @click="openSearch" title="Search sequence (Ctrl+F)">
    <MagnifyingGlassIcon class="toolbar-icon" />
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
