import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type MotionStyle,
} from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { copy } from '../content'
import { Controls } from '../film/Controls'
import { useSequence, type Beat } from '../film/sequence'
import { useSound } from '../film/sound'
import { useStage } from '../film/stage'
import { Subtitles } from '../film/Subtitles'
import { ease, haptic } from '../lib/feel'
import { preload, umbrella } from '../photos'
import './glued.css'

const t = copy.glued

/** "Dính như sam." gets its own beat: a breath of silence first, then it stays at least this long before she can go on */
const HUSH_MS = 800
const IDIOM_MIN_MS = 3000

const IDIOM: Beat[] = t.idiom
  ? [
      { id: 'hush', ms: HUSH_MS },
      { id: 'idiom', say: t.idiom, lang: 'vi', vow: true, minMs: IDIOM_MIN_MS },
    ]
  : []

const BEATS: Beat[] = [
  // the halves start apart and find each other inside this line (see useGlue's meet)
  { id: 'lead', say: t.lead },
  { id: 'prompt', say: t.prompt, wait: 'gesture' },
  // shown on the first snap; the second snap (or 3s) moves on
  { id: 'nope', say: t.nope, ms: 3000 },
  { id: 'told', say: t.told },
  ...t.after.map((say, k): Beat => ({ id: `after-${k}`, say })),
  ...IDIOM,
]
// the last line stays on screen until she moves on
BEATS[BEATS.length - 1] = { ...BEATS[BEATS.length - 1], wait: 'end' }
const END = BEATS[BEATS.length - 1].id as string
/** Next (and a right tap on the line) wait this long on the last line */
const END_MIN_MS = BEATS[BEATS.length - 1].minMs ?? 0

/** photo anchors for the CSS: where the heads meet (the cut) and the hottest bulb */
const ANCHORS = {
  '--join': umbrella.join,
  '--bulb-x': umbrella.bulb.x,
  '--bulb-y': umbrella.bulb.y,
} as CSSProperties

/*
 * The glue is a rubber band: however far her finger goes, each half only
 * ever gets REACH px away from the join. 60 × (1 − e^(−dx / 120)).
 */
const REACH = 60
const GIVE = 120
const band = (dx: number) => REACH * (1 - Math.exp(-dx / GIVE))
/** the finger travel that gives this offset, to pick the halves up mid-snap without a jump */
const unband = (offset: number) => -GIVE * Math.log(1 - Math.min(offset, REACH * 0.98) / REACH)

/** each half must get this far (px) for a pull to count: taps and grazes don't */
const TRY = 10
/** presses this close to a screen edge belong to the phone's back swipe */
const EDGE = 24
/** the snap back: one small overshoot, drawn as a bounce (the halves can't pass through each other) */
const SNAP = { type: 'spring', stiffness: 520, damping: 22, restDelta: 0.05 } as const
/** automatic tugs (tap, key, fallback): the second one tries harder */
const TUGS = [30, 44]

/** "about 10,000 km between us": each half starts this far from the join, about 110 px of night between them */
const APART = 55
/** they drift this close, then the glue takes them (the snap and its thock) */
const NEAR = 12
/** the drift together, in s: slow, then quicker as the glue takes hold */
const DRIFT = { duration: 0.95, ease: [0.42, 0, 0.78, 0.5] } as const
/** how long the distance holds once the photo is up (the lead line reads ~3.5 s: they meet well inside it) */
const MEET_AFTER_MS = 1100

/*
 * The leave: the café goes dark, all but the umbrella's bulb. The light that
 * stays is an ellipse on the bulb, its radius in % of the frame (--reach in
 * glued.css): from past the far corner down to the bulb itself.
 * The first stretch of that radius lies outside the frame (nothing visibly
 * darkens until ~150%), so the radius eases OUT: on screen the light then
 * closes in ease-in-out, starting at once, slowest as it settles on the bulb.
 */
const LIGHT_FROM = 210
const LIGHT_TO = 3
const IRIS = { duration: 1.2, ease: [0.5, 1, 0.89, 1] } as const
/** reduced motion: the rest of the photo just fades, quickly */
const FADE = { duration: 0.45, ease: [0.22, 0.61, 0.36, 1] } as const
/** the bulb alone, a moment, before the cut */
const LAST_LIGHT_MS = 320

/*
 * While the light closes, the print's edges go soft (--edge, 0 to 1, in
 * glued.css): a half-dark photo with hard edges reads as a dark box. Fully
 * soft once the light is down to EDGE_SOFT, and none again once it no longer
 * reaches any edge (the top is nearest, 8% above the bulb): the reduced-motion
 * fade, which starts with the light already there, never gets a feather.
 */
const EDGE_SOFT = 120
const { bulb } = umbrella
const EDGE_CLEAR = 100 * Math.min(bulb.x, 1 - bulb.x, bulb.y, 1 - bulb.y)

const sleep = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms))

/**
 * Everything the two halves do: the distance they start at and their meeting
 * on the lead line, her sideways drag, the snap back with its thock (haptic,
 * 2px shake, bulb flicker), the automatic tugs, and the idle twitch that
 * hints the photo can be pulled.
 */
function useGlue({ reduce, onSnap, onMiss }: { reduce: boolean; onSnap: () => void; onMiss: () => void }) {
  /** how far each half sits from the join, in px (the spring dips below 0 on the overshoot) */
  const pull = useMotionValue(reduce ? 0 : APART)
  /** the frame's sideways shake on impact */
  const shake = useMotionValue(0)
  /** the bulb: 1 = steady, lower = dipping */
  const power = useMotionValue(1)
  /** the idle hint's hairline of light at the seam */
  const hair = useMotionValue(0)

  const gap = useTransform(pull, (v) => Math.abs(v))
  const hisX = useTransform(gap, (g) => -g)
  const seam = useTransform([gap, hair], ([g, h]: number[]) => Math.max(Math.min(1, g / 36), h))
  const halo = useTransform(gap, [4, 50], [0, 1])
  const glow = useTransform(power, [0, 1], [0.15, 1])
  const dim = useTransform(power, [0, 1], [1, 0])

  /** she has really pulled, or a tug has (hides the "Drag sideways." hint) */
  const [touched, setTouched] = useState(false)

  const alive = useRef(true)
  const drag = useRef<{
    id: number
    x0: number
    y0: number
    base: number
    max: number
    moved: boolean
    counted: boolean
  } | null>(null)
  /** when the last real drag ended: the click that follows it is not a tap */
  const draggedAt = useRef(-Infinity)
  /** an automatic tug is playing */
  const busy = useRef(false)
  /** the snap under way: her pull (it moves the story on) or the halves meeting on the lead line (it doesn't) */
  const snapping = useRef<'pull' | 'meet' | null>(null)
  /** the lead line: apart, drifting together, then glued (nothing pulls them before they have met) */
  const phase = useRef<'apart' | 'drifting' | 'met'>(reduce ? 'met' : 'apart')
  /** the scene is leaving: the halves rest and nothing pulls them any more */
  const frozen = useRef(false)
  const onSnapRef = useRef(onSnap)
  const onMissRef = useRef(onMiss)
  useEffect(() => {
    onSnapRef.current = onSnap
    onMissRef.current = onMiss
  }, [onSnap, onMiss])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      for (const v of [pull, shake, power, hair]) v.stop()
    }
  }, [pull, shake, power, hair])

  // the halves meet again: a thock, the frame shakes, the bulb flickers
  useMotionValueEvent(pull, 'change', (v) => {
    const kind = snapping.current
    if (!kind || v > 0.5) return
    snapping.current = null
    haptic(12)
    if (reduce) {
      // no shake, no flicker: the light just dips once
      animate(power, [1, 0.55, 1], { duration: 0.5, ease: 'easeInOut' })
    } else {
      animate(shake, [0, -2, 2, -1.5, 1, 0], { duration: 0.28, ease: 'linear' })
      // a filament bumped: a sharp drop, a catch, a smaller stutter
      animate(power, [1, 0.08, 0.95, 0.45, 1], { duration: 0.3, times: [0, 0.16, 0.42, 0.6, 1], ease: 'linear' })
    }
    if (kind === 'pull') onSnapRef.current()
  })

  /** let go: a real pull snaps back (with the thock), a graze just settles */
  const letGo = useCallback(
    (tried: boolean) => {
      if (!tried || frozen.current) {
        animate(pull, 0, { duration: 0.3, ease: ease.out })
        return
      }
      snapping.current = 'pull'
      animate(pull, 0, reduce ? { duration: 0.16, ease: ease.out } : SNAP)
    },
    [pull, reduce],
  )

  /**
   * The lead line: from the distance, the halves drift together and the glue
   * takes them with a click. `hurry` (the line was tapped away) clicks them
   * together at once, so she is never asked to pull apart what is still apart.
   */
  const meet = useCallback(
    (hurry: boolean) => {
      if (phase.current === 'met' || frozen.current) return
      const click = () => {
        phase.current = 'met'
        snapping.current = 'meet'
        animate(pull, 0, SNAP)
      }
      if (hurry) {
        click()
        return
      }
      if (phase.current === 'drifting') return
      phase.current = 'drifting'
      animate(pull, NEAR, DRIFT).then(() => {
        if (alive.current && phase.current === 'drifting') click()
      })
    },
    [pull],
  )

  /** the halves can be pulled (they have met, and the scene isn't leaving) */
  const free = () => phase.current === 'met' && !frozen.current

  /**
   * Pulls for her (a tap, a key, or the fallback button): strain against the
   * glue, let go. Returns false when it can't start (already pulling).
   */
  const tug = useCallback(
    (tries: number) => {
      if (busy.current || drag.current || phase.current !== 'met' || frozen.current) return false
      busy.current = true
      setTouched(true)
      animate(hair, 0, { duration: 0.15 })
      const run = async () => {
        for (let k = 0; k < tries; k++) {
          if (k > 0) await sleep(reduce ? 650 : 1000)
          if (!alive.current || frozen.current) break
          const to = TUGS[Math.min(k, TUGS.length - 1)]
          await animate(pull, to, reduce ? { duration: 0.22, ease: ease.out } : { duration: 0.5, ease: [0.2, 0.75, 0.35, 1] })
          if (!alive.current || frozen.current) break
          if (!reduce) await sleep(90) // a beat of tension at full stretch
          if (frozen.current) break
          letGo(true)
          await sleep(reduce ? 220 : 440) // until they have met and bounced
        }
        busy.current = false
      }
      void run()
      return true
    },
    [hair, letGo, pull, reduce],
  )

  /** the idle hint: the seam gives a little and a hairline of light shows through */
  const twitch = useCallback(() => {
    if (drag.current || busy.current || snapping.current || phase.current !== 'met' || frozen.current) return
    animate(hair, [0, 0.8, 0], { duration: 1.1, times: [0, 0.22, 1], ease: 'easeOut' })
    if (!reduce) animate(pull, [0, 3, 0], { duration: 0.6, times: [0, 0.28, 1], ease: ['easeOut', 'easeInOut'] })
  }, [hair, pull, reduce])

  /** the scene is leaving: let go of everything, quietly (no thock), and stop listening */
  const rest = useCallback(() => {
    frozen.current = true
    drag.current = null
    snapping.current = null
    animate(hair, 0, { duration: 0.2 })
    if (Math.abs(pull.get()) > 0.5) animate(pull, 0, { duration: 0.3, ease: ease.out })
  }, [hair, pull])

  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (d.moved) draggedAt.current = performance.now()
    const tried = d.max >= TRY
    letGo(tried)
    // she tried, and it didn't take (too short, or up and down instead of sideways)
    if (d.moved && !tried) onMissRef.current()
  }

  const bind = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!free() || busy.current || drag.current) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer is already gone */
      }
      // caught mid-snap: no thock until she lets go again, and no jump if caught mid-bounce
      snapping.current = null
      pull.stop()
      const now = Math.abs(pull.get())
      pull.set(now)
      // her pull lights the seam now, not the idle hint
      animate(hair, 0, { duration: 0.15 })
      drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: unband(now), max: now, moved: false, counted: false }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d || e.pointerId !== d.id) return
      // only sideways travel opens the seam, in either direction
      const dx = Math.abs(e.clientX - d.x0)
      const offset = band(d.base + dx)
      pull.set(offset)
      d.max = Math.max(d.max, offset)
      // any real travel (even up or down) means the click that follows is not a tap
      if (!d.moved && Math.hypot(dx, e.clientY - d.y0) > 6) d.moved = true
      // a real pull: "Drag sideways." has done its job (a miss leaves it up)
      if (!d.counted && offset >= TRY) {
        d.counted = true
        setTouched(true)
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    // a tap (or a screen reader's activation) pulls once, for her
    onClick: () => {
      if (performance.now() - draggedAt.current > 400) tug(1)
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.repeat || !['Enter', ' ', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
      e.preventDefault()
      tug(1)
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  }

  return { gap, hisX, seam, halo, glow, dim, shake, bind, tug, twitch, meet, rest, touched }
}

/**
 * Scene 6: the photo from the café, cut where their heads meet. It opens
 * 10,000 km apart and clicks together; she tries to pull them apart, and
 * they don't come apart. When she goes on, the café goes dark except the
 * umbrella's bulb, and SameLight opens on that bulb, gone cold.
 */
export default function Glued() {
  const reduce = !!useReducedMotion()
  const stage = useStage()
  const seq = useSequence(BEATS)
  const [ready, setReady] = useState(false)
  /** the fallback button has been used: it steps aside while the tugs play */
  const [played, setPlayed] = useState(false)
  /** she tried a pull and it didn't take: the fallback comes at once */
  const [missed, setMissed] = useState(false)

  // snaps move the story on: the first gets "Nope.", the second "Still glued."
  const seqRef = useRef(seq)
  useEffect(() => {
    seqRef.current = seq
  })
  const onSnap = useCallback(() => {
    const s = seqRef.current
    if (s.at('prompt')) s.jump('nope')
    else if (s.at('nope')) s.jump('told')
  }, [])
  const onMiss = useCallback(() => {
    if (seqRef.current.at('prompt')) setMissed(true)
  }, [])

  const glue = useGlue({ reduce, onSnap, onMiss })

  // decode the photo before it fades up, so nothing pops in half-loaded
  useEffect(() => {
    let on = true
    const show = () => {
      if (on) setReady(true)
    }
    preload(umbrella.src).then(show)
    const id = window.setTimeout(show, 1200) // never wait on a slow decoder
    return () => {
      on = false
      window.clearTimeout(id)
    }
  }, [])

  // "Now there are about 10,000 km between us.": the distance holds a moment,
  // then they find each other, all inside the line (tapping it away hurries them)
  const onLead = seq.at('lead')
  const { meet } = glue
  useEffect(() => {
    if (!ready) return
    if (!onLead) {
      meet(true)
      return
    }
    const id = window.setTimeout(() => meet(false), MEET_AFTER_MS)
    return () => window.clearTimeout(id)
  }, [ready, onLead, meet])

  // while she is being asked, the seam gives a little every 3s
  const asking = seq.at('prompt')
  const { twitch } = glue
  useEffect(() => {
    if (!asking) return
    let id = window.setTimeout(function again() {
      twitch()
      id = window.setTimeout(again, 3000)
    }, 1400)
    return () => window.clearTimeout(id)
  }, [asking, twitch])

  // the last line has its moment before Next (or a tap on it) can take her on
  const atEnd = seq.at(END)
  const [settled, setSettled] = useState(END_MIN_MS === 0)
  useEffect(() => {
    if (!atEnd || END_MIN_MS === 0) return
    const id = window.setTimeout(() => setSettled(true), END_MIN_MS)
    return () => {
      window.clearTimeout(id)
      setSettled(false)
    }
  }, [atEnd])

  /*
   * The leave: the café's lights go out (is-leaving, see the lighting plot in
   * film.css) and the photo goes dark down to its bulb, then the cut. Only once.
   */
  const [leaving, setLeaving] = useState(false)
  const left = useRef(false)
  /** the light that stays, as a radius in % of the frame (--reach) */
  const reach = useMotionValue(LIGHT_FROM)
  /** reduced motion: how much of the rest of the photo is left (--fade) */
  const fade = useMotionValue(0)
  const print = { '--reach': reach, '--fade': fade } as MotionStyle
  /** how soft the print's edges are (--edge): set on the frame, for the print's soft wrapper (the grade rides on the halves inside it) */
  const edge = useTransform(reach, [LIGHT_FROM, EDGE_SOFT, EDGE_CLEAR, LIGHT_TO], [0, 1, 1, 0])

  const here = useRef(stage.id)
  const stageRef = useRef(stage)
  useEffect(() => {
    stageRef.current = stage
  })

  const sound = useSound()
  const root = useRef<HTMLElement>(null)

  const { rest } = glue
  const leave = useCallback(() => {
    if (left.current) return
    left.current = true
    // Next goes with the lights: a keyboard press keeps its place on the scene, not on <body> until the cut
    const scene = root.current
    if (scene?.querySelector('.bar')?.contains(document.activeElement)) {
      scene.closest<HTMLElement>('.scene-wrap')?.focus({ preventScroll: true })
    }
    rest()
    if (reduce) {
      reach.set(LIGHT_TO)
      fade.set(1)
      animate(fade, 0, FADE)
    } else {
      animate(reach, LIGHT_TO, IRIS)
    }
    setLeaving(true)
    sound.cue('leave')
  }, [fade, reach, reduce, rest, sound])

  useEffect(() => {
    if (!leaving) return
    const id = window.setTimeout(
      () => {
        // she may have gone Back meanwhile: then this scene no longer leads anywhere
        const s = stageRef.current
        if (s.id === here.current) s.next()
      },
      (reduce ? FADE.duration : IRIS.duration) * 1000 + LAST_LIGHT_MS,
    )
    return () => window.clearTimeout(id)
  }, [leaving, reduce])

  /** a tap on the last line goes on like Next, once the line has had its moment */
  const goOn = () => {
    if (settled) leave()
  }

  /** the shared slow push-in, run inside each half so both stay in register */
  const push = `glued__photo${reduce ? '' : ' is-pushing'}`

  return (
    <section ref={root} className={`scene glued${leaving ? ' is-leaving' : ''}`} aria-label="Glued" style={ANCHORS}>
      <div className="scene__picture">
        <motion.div
          className="frame glued__frame"
          initial={false}
          animate={{ opacity: ready ? 1 : 0 }}
          transition={{ duration: 0.6, ease: ease.film }}
          style={{ x: glue.shake, '--edge': edge } as MotionStyle}
        >
          <img className="frame__glow" src={umbrella.glow} alt="" aria-hidden="true" />

          {/* the print's soft edges while the light closes: their own layer, so the light can move without redrawing them */}
          <div className="glued__soft">
            {/* the print: everything that goes dark when she leaves, all but the bulb */}
            <motion.div className="glued__print" style={print}>
              {/* what shows through the gap */}
              <div className="glued__night" />

              {/*
               * Each half clips itself at the frame's edges and at the join, and the
               * clip travels with it: pulled apart, the halves slide out whole into
               * the night instead of being cropped by the frame.
               */}
              <motion.div className="glued__half glued__half--his" style={{ x: glue.hisX }}>
                <div className={push}>
                  <img className="frame__img" src={umbrella.src} alt={umbrella.alt} draggable={false} decoding="async" />
                </div>
              </motion.div>
              <motion.div className="glued__half glued__half--her" style={{ x: glue.gap }}>
                <div className={push}>
                  <img className="frame__img" src={umbrella.src} alt="" aria-hidden="true" draggable={false} decoding="async" />
                  {/* the bulb is on her side of the cut, so it travels (and pushes in) with her half */}
                  <motion.span className="glued__bulb" style={{ opacity: glue.glow }} aria-hidden="true" />
                  <motion.span className="glued__bulb glued__bulb--dim" style={{ opacity: glue.dim }} aria-hidden="true" />
                </div>
              </motion.div>

              <motion.span className="glued__halo" style={{ opacity: glue.halo }} aria-hidden="true" />
              <motion.span className="glued__seam" style={{ opacity: glue.seam }} aria-hidden="true" />
            </motion.div>
          </div>

          {/* the light that stays: a round bulb where SameLight's cold lamp will hang (outside the print, so the dark never takes it) */}
          <span className="glued__last" aria-hidden="true" />

          <AnimatePresence>
            {asking && !glue.touched ? (
              <motion.div
                key="hint"
                className="glued__hint"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.6, delay: 0.6 } }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                <p>{t.hint}</p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* the drag surface (sideways only); a tap, Enter, Space or an arrow key pulls once */}
          <div className="glued__grip" role="button" tabIndex={0} aria-label={t.action} {...glue.bind} />
        </motion.div>
      </div>

      <Subtitles seq={seq} onEnd={goOn} />

      <Controls
        action={
          // only while she is asked: after her first pull the scene moves on by itself
          asking && !played
            ? {
                label: t.action,
                late: true,
                missed,
                onClick: () => {
                  if (glue.tug(2)) setPlayed(true)
                },
              }
            : null
        }
        showNext={seq.reached(END) && settled && !leaving}
        onNext={leave}
      />
    </section>
  )
}
