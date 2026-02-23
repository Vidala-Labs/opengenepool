import ORFFinderButton from './ORFFinderButton.vue'
import ORFFinderPanel from './ORFFinderPanel.vue'

export { orfFinderVisible } from './state.js'

export const ORFFinderExtension = {
  id: 'orf-finder',
  name: 'ORF Finder',
  toolbarButton: ORFFinderButton,
  panel: ORFFinderPanel
}
