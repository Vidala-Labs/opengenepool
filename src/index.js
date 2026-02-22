/**
 * OpenGenePool - DNA Sequence Editor
 * A Vue.js component library for viewing and editing DNA sequences.
 */

// Components
export { default as SequenceEditor } from './components/SequenceEditor.vue'
export { default as AnnotationLayer } from './components/AnnotationLayer.vue'

// Composables
export { useEditorState } from './composables/useEditorState.js'
export { useGraphics } from './composables/useGraphics.js'

// Utilities
export {
  reverseComplement,
  Range,
  Span,
  Orientation
} from './utils/dna.js'

export {
  Annotation,
  AnnotationFragment,
  ANNOTATION_COLORS,
  getAnnotationColor
} from './utils/annotation.js'

// Extensions
export { SearchExtension } from './extensions/SearchExtension/index.js'
export { CDSSearchExtension } from './extensions/CDSSearchExtension/index.js'
export { BlastExtension } from './extensions/BlastExtension/index.js'
