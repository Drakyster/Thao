import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readingMs } from '../content'
import { useSideways } from './useSideways'

/**
 * One beat of a scene: a subtitle (his voice), a prompt (an instruction),
 * or a silent pause. Beats advance on their own after a generous reading
 * time, unless they wait for her.
 */
export type Beat = {
  id?: string
  /** subtitle in his voice */
  say?: string
  /** instruction for her (shown in sand, smaller) */
  prompt?: string
  /** set to 'vi' for Vietnamese lines */
  lang?: 'vi'
  /**
   * One of the lines that matter most ("Thao.", "I love you.", "Dính như sam."):
   * said in the card's voice (serif italic, larger, cream), never with a chevron.
   */
  vow?: boolean
  /**
   * 'gesture': waits until the scene calls next() (gesture done or fallback used)
   * 'tap': waits for her tap (or Next)
   * 'end': last beat; stays on screen (a tap on the right, after a moment, goes on to the next scene)
   * undefined: advances after `ms` (default: reading time of the line)
   */
  wait?: 'gesture' | 'tap' | 'end'
  /** custom duration in ms for auto beats (silent beats need it) */
  ms?: number
  /**
   * The line can't be tapped away before this many ms (and never leaves
   * on its own before it either). For the lines she must not miss.
   */
  minMs?: number
}

/** a tap that lands this soon after a new line was meant for the previous one */
const MIN_BEFORE_TAP = 800

export function useSequence(beats: Beat[], { running = true }: { running?: boolean } = {}) {
  const [i, setI] = useState(0)
  const startedAt = useRef(0)
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  )

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // the phone turned on its side: the film waits behind the "upright" card
  const sideways = useSideways()

  const beat: Beat | undefined = beats[i]
  const done = i >= beats.length

  const next = useCallback(() => {
    setI((j) => Math.min(j + 1, beats.length))
  }, [beats.length])

  // auto-advance (a line she couldn't see gets its full time again when she is back)
  useEffect(() => {
    startedAt.current = performance.now()
    if (!running || !visible || sideways || !beat || beat.wait) return
    const text = beat.say ?? beat.prompt
    const ms = Math.max(beat.ms ?? (text ? readingMs(text) : 1200), beat.minMs ?? 0)
    const t = window.setTimeout(next, ms)
    return () => window.clearTimeout(t)
  }, [i, beat, running, visible, sideways, next])

  /** her tap on the subtitle: never skips a gesture, never skips a line she has not had time to see */
  const tapNext = useCallback(() => {
    if (!beat || beat.wait === 'gesture' || beat.wait === 'end') return
    if (performance.now() - startedAt.current < (beat.minMs ?? MIN_BEFORE_TAP)) return
    next()
  }, [beat, next])

  /** how long the current beat has been on screen, in ms (for event handlers, not for rendering) */
  const elapsed = useCallback(() => performance.now() - startedAt.current, [])

  // the line before this one, stepping back over silent pauses (a pause is not a line to read again)
  let back = i - 1
  while (back >= 0 && !beats[back].say && !beats[back].prompt && !beats[back].wait) back--
  const canPrev = back >= 0 && !done && beats[back].wait !== 'gesture' && !!beats[back].say
  const prev = useCallback(() => {
    if (canPrev) setI(back)
  }, [canPrev, back])

  const indexOf = useMemo(() => {
    const map = new Map<string, number>()
    beats.forEach((b, k) => b.id && map.set(b.id, k))
    return map
  }, [beats])

  /** true once the sequence has reached (or passed) the beat with this id */
  const reached = useCallback(
    (id: string) => {
      const k = indexOf.get(id)
      return k != null && i >= k
    },
    [i, indexOf],
  )

  const at = useCallback((id: string) => indexOf.get(id) === i, [i, indexOf])

  /** jump straight to a beat (used by fallbacks and gestures) */
  const jump = useCallback(
    (id: string) => {
      const k = indexOf.get(id)
      if (k != null) setI(k)
    },
    [indexOf],
  )

  return { i, beat, done, next, tapNext, elapsed, prev, canPrev, reached, at, jump }
}

export type Sequence = ReturnType<typeof useSequence>
