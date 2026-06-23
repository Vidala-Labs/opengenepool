function createStorage() {
  const entries = new Map()

  return {
    get length() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
    getItem(key) {
      const stringKey = String(key)
      return entries.has(stringKey) ? entries.get(stringKey) : null
    },
    key(index) {
      return Array.from(entries.keys())[index] ?? null
    },
    removeItem(key) {
      entries.delete(String(key))
    },
    setItem(key, value) {
      entries.set(String(key), String(value))
    },
  }
}

if (typeof window !== 'undefined') {
  const localStorage = createStorage()
  const sessionStorage = createStorage()

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: sessionStorage,
    configurable: true,
  })
  Object.defineProperty(window, 'localStorage', {
    value: localStorage,
    configurable: true,
  })
  Object.defineProperty(window, 'sessionStorage', {
    value: sessionStorage,
    configurable: true,
  })
}
