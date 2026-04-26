import { markRaw } from 'vue'
import SearchButton from './SearchButton.vue'
import SearchPanel from './SearchPanel.vue'

export { searchVisible } from './state.js'

export const SearchExtension = markRaw({
  id: 'search',
  name: 'Sequence Search',
  toolbarButton: markRaw(SearchButton),
  panel: markRaw(SearchPanel)
})
