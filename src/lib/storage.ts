/**
 * localStorage that never throws: private windows and some in-app browsers
 * block it, and the site must work the same without it.
 */
const PREFIX = 'for-thao:'

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* storage unavailable: nothing to do */
  }
}
