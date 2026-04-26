export function useClipboard(backend) {
  async function copyText(text, payload = {}) {
    if (!text) return

    if (backend.value?.copy) {
      await backend.value.copy({
        text,
        ...payload
      })
      return
    }

    await navigator.clipboard.writeText(text)
  }

  async function readText() {
    if (backend.value?.paste) {
      return backend.value.paste()
    }

    return navigator.clipboard.readText()
  }

  return {
    copyText,
    readText
  }
}
