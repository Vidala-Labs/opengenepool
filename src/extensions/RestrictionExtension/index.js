import { markRaw } from 'vue'
import RestrictionButton from './RestrictionButton.vue'
import RestrictionPanel from './RestrictionPanel.vue'
import RestrictionLayer from './RestrictionLayer.vue'
import CircularRestrictionLayer from './CircularRestrictionLayer.vue'

export {
  restrictionSitesVisible,
  restrictionPanelVisible,
  selectedEnzymeNames,
  cutSites,
  oneCutters,
  selectOneCutters
} from './state.js'
export { ENZYMES, ENZYMES_SORTED } from './enzymes.js'
export { findCutSites, findAllCutSites, countCutSites } from './restriction-utils.js'

export const RestrictionExtension = markRaw({
  id: 'restriction',
  name: 'Restriction Enzymes',
  toolbarButton: markRaw(RestrictionButton),
  panel: markRaw(RestrictionPanel),
  graphicsLayer: markRaw(RestrictionLayer),
  circularGraphicsLayer: markRaw(CircularRestrictionLayer)
})
