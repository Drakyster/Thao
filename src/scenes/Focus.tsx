import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import { copy } from '../content'
import { Controls } from '../film/Controls'
import { Frame } from '../film/Frame'
import { useSequence, type Beat } from '../film/sequence'
import { useSound } from '../film/sound'
import { Subtitles } from '../film/Subtitles'
import { ease, haptic, spring } from '../lib/feel'
import { laugh, preload, type Pt } from '../photos'
import './focus.css'

const t = copy.focus

/** after "There you are.", her sharp, laughing face holds this long in silence */
const FOUND_HOLD = 1200

const BEATS: Beat[] = [
  { id: 'lead', say: t.lead },
  { id: 'prompt', prompt: t.prompt, wait: 'gesture' },
  // the lens is moving: nobody talks while it focuses
  { id: 'pull', wait: 'gesture' },
  // only if she tapped him. A gesture beat, so "previous line" never brings it back when she didn't miss
  { id: 'missed', say: t.missed, wait: 'gesture' },
  { id: 'found', say: t.found },
  // let it land: nothing but her face before he goes on (no text, so nothing to tap away)
  { id: 'hold', ms: FOUND_HOLD },
  ...t.after.map((say, k): Beat => (k === t.after.length - 1 ? { id: 'end', say, wait: 'end' } : { say })),
]

/** her face: where the fallback lands, and where the camera goes after a miss */
const HER = laugh.her.face
/** the focus square, in CSS px */
const SQUARE = 64
/** the square never sits closer than this to the frame's edge */
const EDGE = 8
/** how long the 'missed' line holds on his sharp face before the camera goes looking for her */
const MISSED_HOLD = 1600
/** quiet time on the prompt before a pulsing square shows her where to tap */
const HINT_AFTER = 7000
/** a tap this soon after the prompt appears was meant for the line before it, not a miss */
const MISS_GRACE = 800

type Phase = 'blurry' | 'pulling' | 'sharp'

/** the square's size, shared with the stylesheet */
const SCENE_STYLE = { '--focus-square': `${SQUARE}px` } as CSSProperties
/** the slow push-in after focus closes in on where their heads touch */
const PUSH_ORIGIN = { '--push-origin': `${laugh.join * 100}% 50%` } as CSSProperties

/*
 * Focus pulls. A crossfade already reads as sharp once the blurred copy is
 * below ~70%, so the pull accelerates into focus (slow start, fast finish),
 * the way a lens motor does, instead of snapping in on an ease-out.
 */
const INTO_FOCUS = [0.55, 0, 0.85, 0.55] as const
const SETTLE = [0.45, 0, 0.55, 1] as const

const sleep = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The half-focused picture after a tap on him: the blurred copy with a soft
 * hole where the square landed, so only that part of the photo comes sharp.
 * The ellipse is a circle about half a frame wide (52% x 39% on 3:4), and the
 * stops follow a smoothstep so the edge of the sharp area never reads as a ring.
 */
function holeAt(p: Pt): CSSProperties {
  const at = `${(p.x * 100).toFixed(2)}% ${(p.y * 100).toFixed(2)}%`
  const mask = `radial-gradient(ellipse 52% 39% at ${at}, transparent 35%, rgb(0 0 0 / 0.16) 51%, rgb(0 0 0 / 0.5) 67%, rgb(0 0 0 / 0.84) 84%, #000 100%)`
  return { WebkitMaskImage: mask, maskImage: mask }
}

/** Four corner marks, like a camera's focus square. A dark underlay keeps them readable on bright skin. */
const MARKS = 'M1 15V1h14M49 1h14v14M63 49v14H49M15 63H1V49'

function Marks() {
  return (
    <svg className="focus__marks" viewBox="0 0 64 64" aria-hidden="true">
      <path className="focus__marks-under" d={MARKS} />
      <path className="focus__marks-line" d={MARKS} />
    </svg>
  )
}

/** Scene 4: back to Friday night, at the café. The selfie comes out blurry; she taps to focus, and the camera finds her. */
export default function Focus() {
  const reduce = !!useReducedMotion()
  const [ready, setReady] = useState(false)
  const seq = useSequence(BEATS, { running: ready })
  const sound = useSound()
  const [phase, setPhase] = useState<Phase>('blurry')
  const phaseRef = useRef<Phase>('blurry')
  const [hole, setHole] = useState<CSSProperties>()
  const [hint, setHint] = useState(false)
  // she tapped beside the photo while it waited for her: the Focus button comes at once
  const [missed, setMissed] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)

  // the picture: the blurred copy on top (soft) and the half-focused copy under it (near)
  const soft = useMotionValue(1)
  const near = useMotionValue(0)
  // a defocused lens shows a slightly bigger picture, which settles as focus lands ("focus breathing")
  const breathe = useTransform(soft, [0, 1], [1, 1.025])

  // the square: its centre as fractions of the frame, turned into px with the frame's measured size
  const frameW = useMotionValue(0)
  const frameH = useMotionValue(0)
  const fx = useMotionValue(HER.x)
  const fy = useMotionValue(HER.y)
  const x = useTransform(() => fx.get() * frameW.get())
  const y = useTransform(() => fy.get() * frameH.get())
  const sqScale = useMotionValue(1)
  const sqOpacity = useMotionValue(0)

  // decode both copies before the picture comes up, so the sharp one never flashes first
  useEffect(() => {
    let live = true
    Promise.all([preload(laugh.src), preload(laugh.blur)]).then(() => live && setReady(true))
    return () => {
      live = false
    }
  }, [])

  // keep the frame size current (rotation, in-app browser bars), so the square stays on its spot
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => {
      frameW.set(el.offsetWidth)
      frameH.set(el.offsetHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [frameW, frameH])

  // leaving the scene stops a focus pull in flight (each step checks the token)
  const run = useRef(0)
  useEffect(() => {
    const values = [soft, near, fx, fy, sqScale, sqOpacity]
    return () => {
      run.current += 1
      values.forEach((v) => v.stop())
    }
  }, [soft, near, fx, fy, sqScale, sqOpacity])

  /*
   * Under the keyboard, Enter on the photo (or on Focus) leaves the focus on
   * a photo with nothing left to press, or nowhere once Focus has gone. When
   * the scene has played out, it goes on to Next, as in the week.
   */
  const sceneRef = useRef<HTMLElement>(null)
  const hitRef = useRef<HTMLDivElement>(null)
  const keyed = useRef(false)
  const ended = seq.reached('end')
  useEffect(() => {
    if (!ended || !keyed.current) return
    const a = document.activeElement
    if (a && a !== document.body && a !== hitRef.current) return
    const id = window.setTimeout(() => sceneRef.current?.querySelector<HTMLElement>('.btn--next')?.focus(), 80)
    return () => window.clearTimeout(id)
  }, [ended])

  // a while on the prompt with no tap: a pulsing square shows her where
  const waiting = phase === 'blurry' && seq.reached('prompt')
  useEffect(() => {
    if (!waiting) return
    const id = window.setTimeout(() => setHint(true), HINT_AFTER)
    return () => window.clearTimeout(id)
  }, [waiting])

  const toPhase = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  /** keep the whole square inside the frame, with a little air at the edges */
  const inFrame = (p: Pt): Pt => {
    const w = frameW.get()
    const h = frameH.get()
    const half = SQUARE / 2 + EDGE
    if (w < half * 2 || h < half * 2) return p
    return { x: clamp(p.x, half / w, 1 - half / w), y: clamp(p.y, half / h, 1 - half / h) }
  }

  const blinkTwice = () =>
    animate(sqOpacity, [1, 0.3, 1, 0.3, 1], { duration: 0.56, ease: 'linear' })

  /** the square lands where she tapped: a little big, settles, blinks twice (no blinks while the lens isn't moving yet) */
  const land = (p: Pt, blink = true) => {
    fx.set(p.x)
    fy.set(p.y)
    if (reduce) {
      sqScale.set(1)
      animate(sqOpacity, [0, 1], { duration: 0.25 })
      return
    }
    sqScale.set(1.3)
    animate(sqScale, 1, spring.touch)
    if (!blink) {
      animate(sqOpacity, [0, 1], { duration: 0.08, ease: 'linear' })
      return
    }
    animate(sqOpacity, [0, 1, 1, 0.3, 1, 0.3, 1], {
      duration: 0.82,
      times: [0, 0.1, 0.32, 0.48, 0.64, 0.8, 1],
      ease: 'linear',
    })
  }

  /** sharp, a little soft, sharp: autofocus overshoots once and settles */
  const resolve = async () => {
    if (reduce) {
      await Promise.all([animate(soft, 0, { duration: 0.6 }), animate(near, 0, { duration: 0.6 })])
      return
    }
    await Promise.all([
      animate(near, 0, { duration: 0.4, ease: INTO_FOCUS }),
      animate(soft, [soft.get(), 0, 0.2, 0], {
        duration: 0.78,
        times: [0, 0.52, 0.72, 1],
        ease: [INTO_FOCUS, ease.out, SETTLE],
      }),
    ])
  }

  /** after a miss, the camera goes looking for her */
  const slideToHer = async () => {
    if (reduce) {
      // no travel: the square fades out on him and back in on her
      await animate(sqOpacity, 0, { duration: 0.25 })
      fx.set(HER.x)
      fy.set(HER.y)
      await animate(sqOpacity, 1, { duration: 0.25 })
      return
    }
    const travel = { type: 'spring', visualDuration: 0.6, bounce: 0.14 } as const
    animate(fx, HER.x, travel)
    animate(fy, HER.y, travel)
    // it dims a little in flight, like a camera hunting
    animate(sqOpacity, [1, 0.6, 1], { duration: 0.6, ease: 'easeInOut' })
    await sleep(560)
  }

  /*
   * A tap while he is still setting the scene (the blurry photo invites one
   * as it fades in): the square lands where she tapped, so she knows it took,
   * and the lens waits for his first line to end before it moves. Once that
   * line has had its time, even when she reads it again, a tap focuses at once.
   */
  const pending = useRef<Pt | null>(null)
  const asked = useRef(false)

  const focusOn = async (p: Pt, waited = false) => {
    if (phaseRef.current !== 'blurry' || !ready) return
    const at = inFrame(p)
    if (!asked.current && !seq.reached('prompt')) {
      pending.current = p
      haptic(6)
      land(at, false)
      return
    }
    const token = run.current
    const alive = () => run.current === token
    toPhase('pulling')
    seq.jump('pull')

    if (waited) {
      // the square has been on this spot since her tap: now it blinks, as the lens moves
      fx.set(at.x)
      fy.set(at.y)
      if (!reduce) blinkTwice()
    } else {
      haptic(6)
      land(at)
    }

    if (p.x > laugh.join) {
      // her side: focus resolves right there
      if (!reduce) await sleep(120)
      if (!alive()) return
      await resolve()
    } else {
      // him: the camera focuses where she tapped, on him, and she stays soft
      setHole(holeAt(at))
      near.set(1)
      await animate(soft, 0, reduce ? { duration: 0.6 } : { duration: 0.5, ease: INTO_FOCUS, delay: 0.12 })
      if (!alive()) return
      seq.jump('missed')
      await sleep(MISSED_HOLD)
      if (!alive()) return
      await slideToHer()
      if (!alive()) return
      if (!reduce) blinkTwice()
      await resolve()
    }
    if (!alive()) return

    // locked on her: two short ticks, like a camera's focus beep
    haptic([8, 50, 8])
    // the score finds her with the lens (after a miss too), not with the line that follows
    sound.cue('found')
    toPhase('sharp')
    // the square confirms for a moment, then gets out of the way of her face
    animate(sqOpacity, 0, { duration: 0.7, delay: 0.9, ease: ease.film })
    await sleep(320)
    if (alive()) seq.jump('found')
  }

  // his first line is done: the lens moves to where she tapped during it ("Tap to focus." would come too late)
  const prompted = seq.reached('prompt')
  useEffect(() => {
    if (!prompted) return
    asked.current = true
    const p = pending.current
    pending.current = null
    if (p) focusOn(p, true)
    // only when the prompt comes up: focusOn is a fresh closure of this same render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompted])

  const onTap = (e: MouseEvent<HTMLDivElement>) => {
    // screen readers and keyboards click without a position: treat it like the Focus button
    if (e.detail === 0) {
      focusOn(HER)
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    focusOn({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (!e.repeat) focusOn(HER)
  }

  /*
   * A tap that lands beside the photo (on the prompt itself, the room, the
   * empty bar) while the photo waits for her: she tried and it didn't take.
   * The Focus button comes at once, and the square shows her where to tap.
   * Taps on the photo never count (a tap on him is the scene's own miss,
   * and it resolves by itself), nor do taps on a control.
   */
  const onSceneClick = (e: MouseEvent<HTMLElement>) => {
    if (e.detail === 0 || phaseRef.current !== 'blurry' || !seq.at('prompt')) return
    if (seq.elapsed() < MISS_GRACE) return
    if (e.target instanceof Element && e.target.closest('button, a, [role="button"]')) return
    setMissed(true)
    setHint(true)
  }

  const blurry = phase === 'blurry'

  return (
    <section
      ref={sceneRef}
      className="scene focus"
      aria-label="Focus"
      style={SCENE_STYLE}
      onClick={onSceneClick}
      onKeyDownCapture={() => {
        keyed.current = true
      }}
      onPointerDownCapture={() => {
        keyed.current = false
      }}
    >
      <motion.div
        className="scene__picture"
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={{ duration: 0.8, ease: ease.film }}
      >
        <Frame
          photo={laugh}
          frameRef={frameRef}
          className={`focus__frame${phase === 'sharp' && !reduce ? ' is-pushing' : ''}`}
          style={PUSH_ORIGIN}
        >
          {phase !== 'sharp' ? (
            <div className="focus__soft" aria-hidden="true">
              <motion.img
                className="focus__layer"
                src={laugh.blur}
                alt=""
                draggable={false}
                style={{ ...hole, opacity: near }}
              />
              <motion.img
                className="focus__layer"
                src={laugh.blur}
                alt=""
                draggable={false}
                style={{ opacity: soft, scale: reduce ? 1 : breathe }}
              />
            </div>
          ) : null}

          <div
            ref={hitRef}
            className="focus__hit"
            role="button"
            tabIndex={blurry ? 0 : -1}
            aria-label={t.prompt}
            aria-disabled={!blurry}
            data-live={blurry || undefined}
            onClick={onTap}
            onKeyDown={onKey}
          />

          <AnimatePresence>
            {hint && waiting ? (
              <motion.div
                key="hint"
                className="focus__square focus__square--hint"
                style={{ left: `${HER.x * 100}%`, top: `${HER.y * 100}%` }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.9, ease: ease.film } }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                aria-hidden="true"
              >
                <motion.div
                  className="focus__pulse"
                  animate={{ opacity: [0.55, 1], scale: reduce ? 1 : [0.94, 1] }}
                  transition={{ duration: 1.3, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                >
                  <Marks />
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <motion.div className="focus__square" style={{ x, y, scale: sqScale, opacity: sqOpacity }} aria-hidden="true">
            <Marks />
          </motion.div>
        </Frame>
      </motion.div>

      <Subtitles seq={seq} />

      <Controls
        action={waiting ? { label: t.action, onClick: () => focusOn(HER), late: true, missed } : null}
        showNext={seq.reached('end')}
      />
    </section>
  )
}
