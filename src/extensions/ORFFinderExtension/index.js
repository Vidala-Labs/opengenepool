import { markRaw } from 'vue'
import ORFFinderButton from './ORFFinderButton.vue'
import ORFFinderPanel from './ORFFinderPanel.vue'

export { orfFinderVisible } from './state.js'

export const ORFFinderExtension = markRaw({
  id: 'orf-finder',
  name: 'ORF Finder',
  toolbarButton: markRaw(ORFFinderButton),
  panel: markRaw(ORFFinderPanel)
})
