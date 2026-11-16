import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { copy } from '../content'
import { useStage } from './stage'

type Action = {
  /** keeps the same button when only its label changes (the week's 'Next' / 'Next day') */
  id?: string
  label: string
  onClick: () => void
  /**
   * A gesture's fallback: it waits a few seconds after it is offered, so she
   * tries the gesture first (the gesture is the film; the button is only a way
   * through). Once one has appeared in a scene, the next ones come at once.
   */
  late?: boolean
  /** she tried the gesture and it didn't take: offer the fallback now */
  missed?: boolean
}

/** how long a late fallback waits */
export const LATE_MS = 3000

/**
 * The bottom bar every scene shares: Back on the left, the scene's
 * fallback action next to it (so a gesture is never required), and
 * Next on the right once the scene has played out.
 */
export function Controls({
  action,
  showNext = false,
  nextLabel = copy.common.next,
  onNext,
  hideBack = false,
  hidden = false,
  extra,
}: {
  action?: Action | null
  showNext?: boolean
  nextLabel?: string
  onNext?: () => void
  hideBack?: boolean
  hidden?: boolean
  /** anything else for the right side (shown while Next is hidden) */
  extra?: ReactNode
}) {
  const stage = useStage()
  const canBack = stage.index > 0 && !hideBack

  // a late fallback waits LATE_MS (paused while she isn't looking), then the scene's fallbacks come at once
  const [warm, setWarm] = useState(false)
  const waiting = !!action?.late && !action.missed && !warm
  useEffect(() => {
    if (!waiting) return
    let t = 0
    const start = () => {
      window.clearTimeout(t)
      if (document.visibilityState !== 'hidden') t = window.setTimeout(() => setWarm(true), LATE_MS)
    }
    start()
    document.addEventListener('visibilitychange', start)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('visibilitychange', start)
    }
  }, [waiting])
  const offered = action && !waiting ? action : null

  // a fallback pressed from the keyboard leaves as soon as it has done its job:
  // keep the keyboard's place in the bar (on Back, or on the scene) instead of dropping it to the page
  const nav = useRef<HTMLElement>(null)
  const offeredKey = offered ? (offered.id ?? offered.label) : null
  useEffect(() => {
    if (offeredKey) return
    const bar = nav.current
    const active = document.activeElement
    if (!bar || !(active instanceof HTMLElement) || !bar.contains(active) || !active.classList.contains('btn--ghost')) return
    // only a keyboard press keeps its place on Back: after a click, an unseen
    // Back must not catch the next Space or Enter (the scene takes it instead)
    let keyed = false
    try {
      keyed = active.matches(':focus-visible')
    } catch {
      /* an older browser without :focus-visible */
    }
    const target = (keyed ? bar.querySelector<HTMLElement>('.bar__back') : null) ?? bar.closest<HTMLElement>('.scene-wrap')
    target?.focus({ preventScroll: true })
  }, [offeredKey])

  // a hidden bar can't be reached or pressed from the keyboard either (it may hide while it has focus)
  useEffect(() => {
    if (hidden && nav.current?.contains(document.activeElement)) {
      nav.current.closest<HTMLElement>('.scene-wrap')?.focus({ preventScroll: true })
    }
  }, [hidden])

  return (
    <motion.nav
      ref={nav}
      inert={hidden}
      className="bar"
      aria-label="Film controls"
      initial={false}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: hidden ? 0.25 : 0.6 }}
      style={{ pointerEvents: hidden ? 'none' : undefined }}
    >
      <div className="bar__side">
        {canBack ? (
          <button type="button" className="btn btn--text bar__back" onClick={stage.back}>
            {copy.common.back}
          </button>
        ) : null}
        <AnimatePresence initial={false}>
          {offered ? (
            <motion.button
              key={offered.id ?? offered.label}
              type="button"
              className="btn btn--ghost"
              onClick={offered.onClick}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: offered.late ? 0.7 : 0.4, delay: 0.15 } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              {offered.label}
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="bar__side">
        {!showNext ? extra : null}
        <AnimatePresence initial={false}>
          {showNext ? (
            <motion.button
              key="next"
              type="button"
              className="btn btn--next"
              onClick={onNext ?? stage.next}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1, transition: { type: 'spring', duration: 0.5, bounce: 0.2 } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              {nextLabel}
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.nav>
  )
}
