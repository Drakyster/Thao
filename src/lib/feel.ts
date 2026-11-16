/** Shared motion vocabulary, so every scene moves the same way. */
export const ease = {
  /** entering / responding to a touch */
  out: [0.23, 1, 0.32, 1] as const,
  /** moving across the screen */
  inOut: [0.77, 0, 0.175, 1] as const,
  /** slow, cinematic reveals (light coming up, paper settling) */
  film: [0.22, 0.61, 0.36, 1] as const,
}

export const spring = {
  /** objects she touches: a little give, no wobble */
  touch: { type: 'spring', duration: 0.5, bounce: 0.18 } as const,
  /** paper landing on a table */
  paper: { type: 'spring', duration: 0.8, bounce: 0.12 } as const,
}

/*
 * iPhone has no navigator.vibrate. Since iOS 18, flipping a native switch
 * (<input type="checkbox" switch>) plays the system's light haptic tick, and
 * a click on its label flips it: a hidden one, outside the film, out of the
 * accessibility tree. Elsewhere it does nothing at all.
 */
let iosSwitch: HTMLLabelElement | null = null

function iosTick() {
  if (!iosSwitch) {
    const label = document.createElement('label')
    label.setAttribute('aria-hidden', 'true')
    label.style.display = 'none'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.setAttribute('switch', '')
    input.tabIndex = -1
    label.appendChild(input)
    document.head.appendChild(label)
    iosSwitch = label
  }
  iosSwitch.click()
}

const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

/**
 * A tiny tap of haptic feedback: vibrate() where it exists (Android), the
 * switch tick on an iPhone (one tick per pulse of the pattern, at most three).
 */
export function haptic(pattern: number | number[] = 8) {
  try {
    // Chrome logs an intervention error when vibrate() runs before her first tap
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern)
      return
    }
    if (!coarse) return
    const steps = Array.isArray(pattern) ? pattern : [pattern]
    let at = 0
    for (let k = 0; k < steps.length && k < 6; k += 2) {
      if (at === 0) iosTick()
      else window.setTimeout(iosTick, at)
      // the system tick needs a little air, or two of them blur into one
      at += Math.max(90, steps[k] + (steps[k + 1] ?? 0))
    }
  } catch {
    /* not supported: ignore */
  }
}
