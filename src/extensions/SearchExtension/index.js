import SearchButton from './SearchButton.vue'
import SearchPanel from './SearchPanel.vue'

export { searchVisible } from './state.js'

export const SearchExtension = {
  id: 'search',
  name: 'Sequence Search',
  toolbarButton: SearchButton,
  panel: SearchPanel
}
