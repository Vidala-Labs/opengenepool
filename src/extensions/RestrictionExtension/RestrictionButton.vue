<script setup>
import { ScissorsIcon } from '@heroicons/vue/24/outline'
import { restrictionSitesVisible, restrictionPanelVisible } from './state.js'

function toggleSites() {
  restrictionSitesVisible.value = !restrictionSitesVisible.value
}

function openPanel(event) {
  event.preventDefault()
  restrictionPanelVisible.value = true
}
</script>

<template>
  <button
    class="toolbar-icon-btn"
    :class="{ active: restrictionSitesVisible }"
    @click="toggleSites"
    @contextmenu="openPanel"
    title="Restriction Enzymes (right-click for options)"
  >
    <ScissorsIcon class="toolbar-icon" />
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

.toolbar-icon-btn.active {
  background: #e3f2fd;
  border-color: #2196F3;
  color: #1976D2;
}

.toolbar-icon {
  width: 18px;
  height: 18px;
}
</style>
