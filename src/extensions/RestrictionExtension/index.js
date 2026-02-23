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

export const RestrictionExtension = {
  id: 'restriction',
  name: 'Restriction Enzymes',
  toolbarButton: RestrictionButton,
  panel: RestrictionPanel,
  graphicsLayer: RestrictionLayer,
  circularGraphicsLayer: CircularRestrictionLayer
}
