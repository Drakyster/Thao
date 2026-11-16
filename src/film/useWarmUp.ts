import { animate, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { ease, haptic } from '../lib/feel'

/** The filament catches this much the instant she touches it... */
const SPARK = 0.12
/** ...this fast (s), well inside 100 ms, so even a quick tap visibly answers. */
const SPARK_S = 0.07
/** A bulb that rests warm still sparks visibly above its rest (colours mix in squares: the step must be bigger). */
const SPARK_ABOVE_REST = 0.1
/** After the spark, the slow warm-up: dull red for a while, then a rush to white. */
const WARM_EASE = [0.55, 0.05, 0.9, 0.4] as const
/** Letting go: it dims fast, then lingers. */
const COOL_S = 0.6
/** Presses this close (px) to the left or right edge of the screen belong to the phone's back swipe. */
const EDGE = 24

const isHoldKey = (key: string) => key === ' ' || key === 'Enter'

/**
 * Press and hold to warm the lamp up. The filament sparks the moment she
 * touches it, then warms slowly to white. Letting go early cools it back
 * (no fail state), shows a "keep holding" hint (`hint`) and marks the
 * gesture as `missed`, so the scene can offer its fallback at once
 * (Controls' `missed`). `play()` runs the same warm-up by itself for the
 * fallback button; once it runs, her touches no longer change anything.
 */
export function useWarmUp({
  duration = 1.4,
  onLit,
  rest = 0,
  edge = EDGE,
}: {
  /** seconds of holding, from rest to lit */
  duration?: number
  onLit: () => void
  /** the heat it rests at while nobody holds it (0: cold; a little more: a bulb that is already faintly warm) */
  rest?: number
  /** pointerdowns this close (px) to the screen's left or right edge are ignored (0 turns it off) */
  edge?: number
}) {
  const heat = useMotionValue(rest)
  const [state, setState] = useState<'cold' | 'warming' | 'lit'>('cold')
  const [hint, setHint] = useState(false)
  const [missed, setMissed] = useState(false)
  const anim = useRef<ReturnType<typeof animate> | null>(null)
  const litRef = useRef(false)
  /** play() is warming it by itself */
  const auto = useRef(false)
  /** what is holding it right now: the fingers on it (their pointer ids), and/or a key */
  const fingers = useRef(new Set<number>())
  const key = useRef(false)
  /** stops listening for the ends of the fingers holding it */
  const unlisten = useRef<(() => void) | null>(null)
  const onLitRef = useRef(onLit)
  useEffect(() => {
    onLitRef.current = onLit
  }, [onLit])

  const spark = Math.min(0.9, Math.max(SPARK, rest + SPARK_ABOVE_REST))

  const finish = useCallback(() => {
    if (litRef.current) return
    litRef.current = true
    setState('lit')
    setHint(false)
    haptic(14)
    onLitRef.current()
  }, [])

  const warm = useCallback(
    (speed = 1) => {
      if (litRef.current) return
      anim.current?.stop()
      setState('warming')
      const from = heat.get()
      // the slow part takes what is left of `duration` after the spark, in proportion to the heat still missing
      const slow = (((1 - Math.max(from, spark)) / (1 - spark)) * (duration - SPARK_S)) / speed
      anim.current =
        from < spark
          ? animate(heat, [from, spark, 1], {
              duration: SPARK_S + slow,
              times: [0, SPARK_S / (SPARK_S + slow), 1],
              ease: [ease.out, WARM_EASE],
              onComplete: finish,
            })
          : animate(heat, 1, { duration: slow, ease: WARM_EASE, onComplete: finish })
    },
    [duration, finish, heat, spark],
  )

  /** she let go before it was lit: it cools back to rest, and the scene may teach the gesture */
  const letGo = useCallback(() => {
    if (litRef.current || auto.current) return
    anim.current?.stop()
    setState('cold')
    setHint(true)
    setMissed(true)
    const from = heat.get()
    // a tap shorter than the spark still gets its whole spark before the filament dims
    const left = from < spark ? SPARK_S * Math.min(1, (spark - from) / (spark - rest)) : 0
    anim.current =
      left > 0
        ? animate(heat, [from, spark, rest], {
            duration: left + COOL_S,
            times: [0, left / (left + COOL_S), 1],
            ease: [ease.out, ease.out],
          })
        : animate(heat, rest, { duration: COOL_S, ease: ease.out })
  }, [heat, rest, spark])

  useEffect(
    () => () => {
      anim.current?.stop()
      unlisten.current?.()
    },
    [],
  )

  const holding = () => fingers.current.size > 0 || key.current

  /** a finger on it lifted (or the system took it): idempotent, whichever path reports it first */
  const liftFinger = (pointerId: number) => {
    if (!fingers.current.delete(pointerId)) return
    // another finger still on it keeps the hold: the bulb only cools once the last one lifts
    if (fingers.current.size > 0) return
    unlisten.current?.()
    unlisten.current = null
    if (!holding()) letGo()
  }

  const play = useCallback(() => {
    if (litRef.current) return
    auto.current = true
    fingers.current.clear()
    key.current = false
    unlisten.current?.()
    unlisten.current = null
    warm(1.15)
  }, [warm])

  const release = (e: PointerEvent<HTMLElement>) => liftFinger(e.pointerId)

  const bind = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, a')) return
      if (edge > 0 && (e.clientX < edge || e.clientX > window.innerWidth - edge)) return
      // a touch changes nothing while it is lit or playing by itself
      if (litRef.current || auto.current) return
      const id = e.pointerId
      if (fingers.current.has(id)) return
      // a second finger joins the hold, so the first can lift while it stays
      const already = holding()
      fingers.current.add(id)
      try {
        e.currentTarget.setPointerCapture?.(id)
      } catch {
        /* the pointer is already gone: the window listeners below still hear its end */
      }
      // the hook hears every finger's end itself (one pair of listeners until the last lifts), so a scene's
      // own wrappers (or a lost capture) can never leave it warming
      if (!unlisten.current) {
        const end = (ev: globalThis.PointerEvent) => liftFinger(ev.pointerId)
        window.addEventListener('pointerup', end)
        window.addEventListener('pointercancel', end)
        unlisten.current = () => {
          window.removeEventListener('pointerup', end)
          window.removeEventListener('pointercancel', end)
        }
      }
      if (!already) warm()
    },
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    onKeyDown: (e: KeyboardEvent) => {
      if (!isHoldKey(e.key)) return
      e.preventDefault()
      if (e.repeat || key.current || litRef.current || auto.current) return
      const already = holding()
      key.current = true
      if (!already) warm()
    },
    onKeyUp: (e: KeyboardEvent) => {
      if (!isHoldKey(e.key) || !key.current) return
      key.current = false
      if (!holding()) letGo()
    },
    // focus leaving while a key holds it is a release too (its keyup will land elsewhere)
    onBlur: () => {
      if (!key.current) return
      key.current = false
      if (!holding()) letGo()
    },
  }

  return { heat, state, hint, missed, bind, play }
}
