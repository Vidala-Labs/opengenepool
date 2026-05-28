import { markRaw } from 'vue'
import PrimerBindEditor from './PrimerBindEditor.vue'
import PrimerBindDisplay from './PrimerBindDisplay.vue'

export { default as PrimerBindEditor } from './PrimerBindEditor.vue'
export { default as PrimerBindDisplay } from './PrimerBindDisplay.vue'

export const PrimerBindExtension = markRaw({
  key: 'primer_bind',
  label: "3' Primer binding bases",
  forTypes: ['primer'],
  editor: markRaw(PrimerBindEditor),
  display: markRaw(PrimerBindDisplay)
})
