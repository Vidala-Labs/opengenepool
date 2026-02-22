import CDSSearchButton from './CDSSearchButton.vue'
import CDSSearchPanel from './CDSSearchPanel.vue'

export { cdsSearchVisible } from './state.js'

export const CDSSearchExtension = {
  id: 'cds-search',
  name: 'CDS Search',
  toolbarButton: CDSSearchButton,
  panel: CDSSearchPanel
}
