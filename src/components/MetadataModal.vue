<script setup>
import { ref, computed, watch, toRaw } from 'vue'
import { TrashIcon, PencilIcon, PlusIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/vue/20/solid'

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  metadata: {
    type: Object,
    default: null
  },
  readonly: {
    type: Boolean,
    default: false
  },
  backend: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close'])

// Optional fields that can be added (molecule_type, circular, locus_name are always shown)
const OPTIONAL_FIELDS = [
  { key: 'definition', label: 'Definition' },
  { key: 'division', label: 'Division' },
  { key: 'accession', label: 'Accession' },
  { key: 'version', label: 'Version' },
  { key: 'organism', label: 'Organism' },
  { key: 'source', label: 'Source' },
  { key: 'keywords', label: 'Keywords' },
]

// Local metadata - source of truth for display
const localMetadata = ref(null)

// Edit mode state
const editMode = ref(false)
const editMetadata = ref(null)  // Copy for editing, cleared on save/cancel
const editingReferenceIndex = ref(null)  // Index of reference being edited inline

// Effective backend (null when readonly)
const effectiveBackend = computed(() => props.readonly ? null : props.backend)

// Initialize localMetadata from props
watch(() => props.metadata, (newMetadata) => {
  if (!editMode.value) {
    localMetadata.value = cloneMetadata(newMetadata)
  }
}, { immediate: true, deep: true })

// Metadata is application data, not necessarily JSON-only. structuredClone
// preserves values such as undefined, Date, Map, and cyclic references.
function cloneMetadata(value) {
  return value == null ? value : structuredClone(toRaw(value))
}

// Optional fields visible in edit form (exist in editMetadata)
const visibleOptionalFields = computed(() => {
  if (!editMetadata.value) return []
  return OPTIONAL_FIELDS.filter(f => f.key in editMetadata.value)
})

// Fields available to add (not visible in edit form)
const availableToAdd = computed(() => {
  const visibleKeys = new Set(visibleOptionalFields.value.map(f => f.key))
  return OPTIONAL_FIELDS.filter(f => !visibleKeys.has(f.key))
})

function addField(key) {
  editMetadata.value[key] = ''
}

function removeField(key) {
  delete editMetadata.value[key]
}

function removeReference(index) {
  editMetadata.value.references.splice(index, 1)
}

function addReference() {
  editMetadata.value.references.push({
    title: '',
    authors: '',
    journal: '',
    pubmed: ''
  })
}

function moveReferenceUp(index) {
  if (index > 0) {
    const refs = editMetadata.value.references
    ;[refs[index - 1], refs[index]] = [refs[index], refs[index - 1]]
  }
}

function moveReferenceDown(index) {
  const refs = editMetadata.value.references
  if (index < refs.length - 1) {
    ;[refs[index], refs[index + 1]] = [refs[index + 1], refs[index]]
  }
}

function startEditingReference(index) {
  editingReferenceIndex.value = index
}

function cancelEditingReference() {
  editingReferenceIndex.value = null
}

function saveEditingReference() {
  // Changes are already bound to editMetadata, just exit edit mode
  editingReferenceIndex.value = null
}

function close() {
  editMode.value = false
  editMetadata.value = null
  editingReferenceIndex.value = null
  localMetadata.value = cloneMetadata(props.metadata)
  emit('close')
}

function enterEditMode() {
  // Copy localMetadata into edit state
  editMetadata.value = cloneMetadata(localMetadata.value || {})

  // Ensure required fields exist
  editMetadata.value.molecule_type = editMetadata.value.molecule_type || ''
  editMetadata.value.circular = editMetadata.value.circular ?? false
  editMetadata.value.locus_name = editMetadata.value.locus_name || ''
  editMetadata.value.references = editMetadata.value.references || []

  editMode.value = true
}

function cancelEdit() {
  editMetadata.value = null
  editMode.value = false
  editingReferenceIndex.value = null
  localMetadata.value = cloneMetadata(props.metadata)
}

function save() {
  // Remove empty optional fields before saving
  for (const field of OPTIONAL_FIELDS) {
    if (editMetadata.value[field.key] === '') {
      delete editMetadata.value[field.key]
    }
  }

  // Update localMetadata with the changes
  localMetadata.value = cloneMetadata(editMetadata.value)

  // Send full metadata to backend
  const editId = crypto.randomUUID()
  effectiveBackend.value?.metadataUpdate?.({ id: editId, metadata: editMetadata.value })

  editMetadata.value = null
  editMode.value = false
}

// Reset edit mode when modal closes
function onOverlayClick() {
  close()
}

// Expose for testing
defineExpose({
  enterEditMode,
  cancelEdit,
  save
})
</script>

<template>
  <div v-if="open" class="modal-overlay" @click="onOverlayClick">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h3>Sequence Information</h3>
        <div class="modal-header-actions">
          <!-- Edit button (not rendered in readonly mode or during edit) -->
          <button
            v-if="!props.readonly && !editMode"
            class="edit-button"
            @click="enterEditMode"
          >Edit</button>
          <button class="modal-close" @click="close">&times;</button>
        </div>
      </div>
      <div class="modal-body">
        <!-- View Mode -->
        <div v-if="!editMode">
          <dl class="metadata-list">
            <template v-if="localMetadata?.locus_name">
              <dt>Locus</dt>
              <dd>{{ localMetadata.locus_name }}</dd>
            </template>
            <template v-if="localMetadata?.molecule_type">
              <dt>Type</dt>
              <dd>{{ localMetadata.molecule_type }}<template v-if="localMetadata?.circular !== undefined"> — {{ localMetadata.circular ? 'circular' : 'linear' }}</template></dd>
            </template>
            <template v-for="field in visibleOptionalFields" :key="field.key">
              <dt>{{ field.label }}</dt>
              <dd>{{ localMetadata[field.key] }}</dd>
            </template>
          </dl>
        </div>

        <!-- Edit Mode -->
        <div v-else>
          <form class="metadata-edit-form" @submit.prevent="save">
            <div class="form-group">
              <label for="edit-locus">Locus</label>
              <input type="text" id="edit-locus" v-model="editMetadata.locus_name" />
            </div>

            <div class="form-row-half">
              <div class="form-group">
                <label for="edit-type">Type</label>
                <select id="edit-type" v-model="editMetadata.molecule_type">
                  <option value="">— Select —</option>
                  <option value="DNA">DNA</option>
                  <option value="RNA">RNA</option>
                  <option value="mRNA">mRNA</option>
                  <option value="rRNA">rRNA</option>
                  <option value="tRNA">tRNA</option>
                  <option value="snRNA">snRNA</option>
                  <option value="scRNA">scRNA</option>
                  <option value="ssDNA">ssDNA</option>
                  <option value="pre-RNA">pre-RNA</option>
                  <option value="cRNA">cRNA</option>
                </select>
              </div>

              <div class="form-group">
                <label>Topology</label>
                <div class="toggle-switch">
                  <button
                    type="button"
                    :class="['toggle-option', { active: !editMetadata.circular }]"
                    @click="editMetadata.circular = false"
                  >Linear</button>
                  <button
                    type="button"
                    :class="['toggle-option', { active: editMetadata.circular }]"
                    @click="editMetadata.circular = true"
                  >Circular</button>
                </div>
              </div>
            </div>

            <!-- Dynamic optional fields -->
            <div v-for="field in visibleOptionalFields" :key="field.key" class="form-group">
              <div class="form-label-row">
                <label :for="'edit-' + field.key">{{ field.label }}</label>
                <button
                  type="button"
                  class="btn-remove-field"
                  @click="removeField(field.key)"
                  title="Remove field"
                >
                  <TrashIcon class="icon-small" />
                </button>
              </div>
              <textarea
                v-if="field.key === 'definition'"
                :id="'edit-' + field.key"
                v-model="editMetadata[field.key]"
                rows="3"
              ></textarea>
              <input
                v-else
                type="text"
                :id="'edit-' + field.key"
                v-model="editMetadata[field.key]"
              />
            </div>

            <div class="form-actions">
              <div v-if="availableToAdd.length > 0" class="add-field-dropdown">
                <select class="add-field-select" @change="addField($event.target.value); $event.target.value = ''">
                  <option value="">Add field...</option>
                  <option v-for="field in availableToAdd" :key="field.key" :value="field.key">
                    {{ field.label }}
                  </option>
                </select>
              </div>
              <div class="form-actions-right">
                <button type="button" class="btn-cancel" @click="cancelEdit">Cancel</button>
                <button type="submit" class="btn-save">Save</button>
              </div>
            </div>
          </form>
        </div>

        <!-- References section -->
        <template v-if="editMode || (localMetadata?.references && localMetadata.references.length > 0)">
          <div class="references-header-row">
            <h4 class="references-header">References</h4>
            <button v-if="editMode" type="button" class="btn-add-reference" title="Add reference" @click="addReference">
              <PlusIcon class="icon-small" />
            </button>
          </div>

          <!-- Edit mode: show all references -->
          <div v-if="editMode && editMetadata.references?.length" class="references-list">
            <div v-for="(ref, index) in editMetadata.references" :key="index" class="reference-item-edit">
              <!-- Inline edit form for this reference -->
              <template v-if="editingReferenceIndex === index">
                <div class="reference-edit-form">
                  <div class="ref-field">
                    <label :for="'ref-title-' + index">Title</label>
                    <input :id="'ref-title-' + index" type="text" v-model="ref.title" />
                  </div>
                  <div class="ref-field">
                    <label :for="'ref-authors-' + index">Authors</label>
                    <input :id="'ref-authors-' + index" type="text" v-model="ref.authors" />
                  </div>
                  <div class="ref-field">
                    <label :for="'ref-journal-' + index">Journal</label>
                    <input :id="'ref-journal-' + index" type="text" v-model="ref.journal" />
                  </div>
                  <div class="ref-field">
                    <label :for="'ref-pubmed-' + index">PubMed ID</label>
                    <input :id="'ref-pubmed-' + index" type="text" v-model="ref.pubmed" />
                  </div>
                  <div class="ref-edit-actions">
                    <button type="button" class="btn-ref-cancel" @click="cancelEditingReference">Cancel</button>
                    <button type="button" class="btn-ref-save" @click="saveEditingReference">Done</button>
                  </div>
                </div>
              </template>

              <!-- Display mode for this reference -->
              <template v-else>
                <div class="reference-actions">
                  <button type="button" class="btn-remove-reference" title="Remove reference" @click="removeReference(index)">
                    <TrashIcon class="icon-small" />
                  </button>
                  <button type="button" class="btn-edit-reference" title="Edit reference" @click="startEditingReference(index)">
                    <PencilIcon class="icon-small" />
                  </button>
                  <button v-if="index > 0" type="button" class="btn-move-reference" title="Move up" @click="moveReferenceUp(index)">
                    <ArrowUpIcon class="icon-small" />
                  </button>
                  <button v-if="index < editMetadata.references.length - 1" type="button" class="btn-move-reference" title="Move down" @click="moveReferenceDown(index)">
                    <ArrowDownIcon class="icon-small" />
                  </button>
                </div>
                <div class="reference-content">
                  <div v-if="ref.title" class="ref-title">{{ ref.title }}</div>
                  <div v-if="ref.authors" class="ref-authors">{{ ref.authors }}</div>
                  <div v-if="ref.journal" class="ref-journal">{{ ref.journal }}</div>
                  <div v-if="ref.pubmed" class="ref-pubmed">
                    <a :href="`https://pubmed.ncbi.nlm.nih.gov/${ref.pubmed}/`" target="_blank" rel="noopener noreferrer">
                      PubMed: {{ ref.pubmed }}
                    </a>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- View mode: complete references first, then collapsible "more" -->
          <template v-else-if="localMetadata?.references?.length">
            <div class="references-list">
              <template v-for="(ref, index) in localMetadata.references" :key="index">
                <div v-if="ref.authors && ref.title && ref.journal && ref.pubmed" class="reference-item">
                  <div class="ref-title">{{ ref.title }}</div>
                  <div class="ref-authors">{{ ref.authors }}</div>
                  <div class="ref-journal">{{ ref.journal }}</div>
                  <div class="ref-pubmed">
                    <a :href="`https://pubmed.ncbi.nlm.nih.gov/${ref.pubmed}/`" target="_blank" rel="noopener noreferrer">
                      PubMed: {{ ref.pubmed }}
                    </a>
                  </div>
                </div>
              </template>
            </div>
            <details v-if="localMetadata.references.some(ref => !(ref.authors && ref.title && ref.journal && ref.pubmed))" class="references-more">
              <summary>more</summary>
              <div class="references-list">
                <template v-for="(ref, index) in localMetadata.references" :key="'more-' + index">
                  <div v-if="!(ref.authors && ref.title && ref.journal && ref.pubmed)" class="reference-item">
                    <div v-if="ref.title" class="ref-title">{{ ref.title }}</div>
                    <div v-if="ref.authors" class="ref-authors">{{ ref.authors }}</div>
                    <div v-if="ref.journal" class="ref-journal">{{ ref.journal }}</div>
                    <div v-if="ref.pubmed" class="ref-pubmed">
                      <a :href="`https://pubmed.ncbi.nlm.nih.gov/${ref.pubmed}/`" target="_blank" rel="noopener noreferrer">
                        PubMed: {{ ref.pubmed }}
                      </a>
                    </div>
                  </div>
                </template>
              </div>
            </details>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.modal-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.edit-button {
  padding: 4px 12px;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.edit-button:hover {
  background: #e0e0e0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  padding: 0 4px;
  line-height: 1;
}

.modal-close:hover {
  color: #333;
}

.modal-body {
  padding: 20px;
}

.metadata-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  margin: 0;
}

.metadata-list dt {
  font-weight: 600;
  color: #666;
}

.metadata-list dd {
  margin: 0;
  color: #333;
  word-break: break-word;
}

/* Metadata edit form */
.metadata-edit-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row-half {
  display: flex;
  gap: 16px;
}

.form-row-half > .form-group {
  flex: 1;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group > label:first-child,
.form-label-row > label {
  font-weight: 600;
  font-size: 13px;
  color: #666;
}

.form-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-remove-field {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #cc4444;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.btn-remove-field:hover {
  opacity: 1;
}

.icon-small {
  width: 14px;
  height: 14px;
  display: block;
}

.form-group select,
.form-group input[type="text"],
.form-group textarea {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

.toggle-switch {
  display: flex;
  border: 1px solid #ccc;
  border-radius: 4px;
  overflow: hidden;
  width: 100%;
}

.toggle-option {
  flex: 1;
  padding: 9px 16px;
  border: none;
  background: #f5f5f5;
  cursor: pointer;
  font-size: 14px;
  color: #666;
  transition: background-color 0.15s, color 0.15s;
}

.toggle-option:first-child {
  border-right: 1px solid #ccc;
}

.toggle-option:hover:not(.active) {
  background: #e8e8e8;
}

.toggle-option.active {
  background: #4CAF50;
  color: white;
}

.form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.form-actions-right {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.btn-cancel {
  padding: 8px 16px;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
}

.btn-cancel:hover {
  background: #e0e0e0;
}

.btn-save {
  padding: 8px 16px;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-save:hover {
  background: #45a049;
}

.add-field-dropdown {
  /* Left-aligned in form-actions */
}

.add-field-select {
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  font-size: 13px;
  cursor: pointer;
  color: #666;
}

.add-field-select:hover {
  border-color: #999;
}

/* References styles */
.references-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0 12px 0;
  border-top: 1px solid #eee;
  padding-top: 16px;
}

.references-header {
  margin: 0;
  font-size: 14px;
  color: #666;
}

.btn-add-reference {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #4CAF50;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.btn-add-reference:hover {
  opacity: 1;
}

.references-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Edit mode reference items - fused boxes */
.references-list:has(.reference-item-edit) {
  gap: 0;
  border: 1px solid #336;
  border-radius: 4px;
  overflow: hidden;
}

.reference-item-edit {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  background: #f0f4ff;
  border-bottom: 1px solid #336;
}

.reference-item-edit:last-child {
  border-bottom: none;
}

.reference-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  margin-top: 2px;
}

.btn-remove-reference,
.btn-edit-reference,
.btn-move-reference {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.btn-remove-reference {
  color: #cc4444;
}

.btn-edit-reference {
  color: #4488cc;
}

.btn-move-reference {
  color: #666;
}

.btn-remove-reference:hover,
.btn-edit-reference:hover,
.btn-move-reference:hover {
  opacity: 1;
}

.reference-content {
  flex: 1;
}

.reference-item {
  font-size: 13px;
  line-height: 1.4;
}

.ref-title {
  font-weight: 600;
  color: #333;
}

.ref-authors {
  color: #666;
  font-style: italic;
}

.ref-journal {
  color: #666;
}

.ref-pubmed a {
  color: #0066cc;
  text-decoration: none;
}

.ref-pubmed a:hover {
  text-decoration: underline;
}

.references-more {
  margin-top: 12px;
}

.references-more summary {
  cursor: pointer;
  color: #666;
  font-size: 13px;
}

.references-more summary:hover {
  color: #333;
}

.references-more .references-list {
  margin-top: 12px;
}

/* Reference edit form */
.reference-edit-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ref-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ref-field label {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
}

.ref-field input {
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
}

.ref-field input:focus {
  outline: none;
  border-color: #4488cc;
}

.ref-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn-ref-cancel {
  padding: 6px 12px;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-ref-cancel:hover {
  background: #e0e0e0;
}

.btn-ref-save {
  padding: 6px 12px;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-ref-save:hover {
  background: #45a049;
}
</style>
