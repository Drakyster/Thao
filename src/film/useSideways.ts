import { useSyncExternalStore } from 'react'

/*
 * True while the phone is on its side and the "This one works best upright."
 * card covers the film (.upright in film.css). The film pauses behind it, like
 * it does when she leaves the app, so she never comes back lines later.
 *
 * It reads the card itself rather than repeating its media query, so the
 * script and the stylesheet can never disagree (an older Safari that ignores
 * the query shows no card, and then the film doesn't pause either).
 */

let current: boolean | undefined
const listeners = new Set<() => void>()

function read() {
  const card = document.querySelector('.upright')
  return !!card && getComputedStyle(card).display !== 'none'
}

function update() {
  const now = read()
  if (now === current) return
  current = now
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  if (listeners.size === 1) {
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
  }
  // the card may have mounted after the first read (a page opened sideways)
  update()
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }
}

export function useSideways() {
  return useSyncExternalStore(
    subscribe,
    () => (current ??= read()),
    () => false,
  )
}
