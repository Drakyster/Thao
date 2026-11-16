import {
  AnimatePresence,
  animate,
  cancelFrame,
  frame,
  motion,
  motionValue,
  useMotionValue,
  useReducedMotion,
  type Easing,
  type FrameData,
  type MotionValue,
} from 'motion/react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { copy, readingMs } from '../content'
import { Controls } from '../film/Controls'
import { useSequence, type Beat } from '../film/sequence'
import { useSound } from '../film/sound'
import { Subtitles } from '../film/Subtitles'
import { ease, haptic } from '../lib/feel'
import './week.css'

const t = copy.week
const DAYS = t.days
const N = DAYS.length

/** the days whose bulbs do something of their own */
const MON = 0
const THU = 3
const FRI = 4
const SAT = 5

/** Screen-reader name of the scene. Not in content.ts (see the scene report). */
const SCENE_LABEL = 'Monday to Saturday'

/** presses this close to a screen edge belong to the phone's back swipe */
const EDGE = 24
/** once a day's last line has been read, she gets this long to light the next bulb herself */
const GRACE = 1800
/** nothing left to light after the last line: just a breath before the whole string comes up */
const LAST_GRACE = 600
/**
 * No tap (on the picture, on the subtitle, or on the fallback) takes a line
 * away before it has been up this long: she reads in her second language.
 */
const MIN_READ = 1200
/** all six on: a breath, one wink together, then the light swells before the last line */
const ALL_MS = 1200
/** within that: when the string winks, and when its light starts to swell */
const WINK_AT = 0.25
const SWELL_AT = 0.65
/** an unlit day's name: dim, but still readable on the dark room (3.5:1 or better) */
const NAME_OFF = 0.56

/** a day's lines: `notes` when there are several, else its one `note` */
const notesOf = (d: { note: string; notes?: readonly string[] }) => (d.notes?.length ? d.notes : [d.note])

/** the beat id of the first line of day `k` that matches, if any (the bulbs only act on lines that are really there) */
function lineOf(k: number, match: RegExp) {
  const j = notesOf(DAYS[k]).findIndex((note) => match.test(note))
  return j < 0 ? null : j === 0 ? `day${k}` : `day${k}-${j}`
}

/** "I was so nervous, I dropped my meat on the floor." */
const DROP = lineOf(MON, /\bdropped\b/i)
/** "Honestly, I wish I had stayed with you instead." */
const WISH = lineOf(THU, /\bwish\b/i)
/** Thursday only burns at half power until that line */
const HALF_THU = WISH != null && WISH !== `day${THU}`

/*
 * One beat per line. The day's name is the chapter title above the
 * subtitles, so its first line starts straight in (and keeps the time the
 * name takes to read). After a day's last line she has GRACE to light the
 * next bulb, then it lights by itself.
 */
const BEATS: Beat[] = [
  { id: 'lead', say: t.lead, minMs: MIN_READ },
  { id: 'prompt', prompt: t.prompt, wait: 'gesture' },
]
/** the beat where each day starts (its bulb lights there) */
const FIRST: number[] = []
/** for each beat: the day still has another line after it */
const MORE: boolean[] = [false, false]
/** for each beat: the day it belongs to (-1 outside the days) */
const DAY_OF: number[] = [-1, -1]
DAYS.forEach((d, k) => {
  const notes = notesOf(d)
  FIRST.push(BEATS.length)
  notes.forEach((note, j) => {
    const last = j === notes.length - 1
    BEATS.push({
      id: j === 0 ? `day${k}` : `day${k}-${j}`,
      say: note,
      ms: readingMs(j === 0 ? `${d.name}. ${note}` : note) + (last ? (k < N - 1 ? GRACE : LAST_GRACE) : 0),
      minMs: MIN_READ,
    })
    MORE.push(!last)
    DAY_OF.push(k)
  })
})
// all six come up together: a wink, a swell, in silence
BEATS.push({ id: 'all', ms: ALL_MS }, { id: 'end', say: t.end, wait: 'end' })
MORE.push(false, false)
DAY_OF.push(-1, -1)
const ALL = BEATS.length - 2

/** how many bulbs the film has reached at beat i */
const litAt = (i: number) => (i >= ALL ? N : FIRST.filter((f) => f <= i).length)

/* ───────────── each bulb catches the way its day went ───────────── */

type Catch = {
  /** the glass's power, keyframe by keyframe (0 dark, 1 lit) */
  power: number[]
  times: number[]
  /** how long it takes to catch (s) */
  s: number
  ease: Easing
}

/** on, off, on, inside 180ms */
const CATCH: Catch = { power: [0, 1, 0.1, 1], times: [0, 0.2, 0.52, 1], s: 0.18, ease: 'linear' }
/** Thursday at half power: its white core barely on (the orange of a dimmed filament does the rest) */
const HALF_CORE = 0.14
const CATCHES: Catch[] = DAYS.map(() => CATCH)
// their first date: it stutters twice, nervous
CATCHES[MON] = { power: [0, 1, 0.08, 0.85, 0.12, 1], times: [0, 0.1, 0.26, 0.45, 0.6, 1], s: 0.34, ease: 'linear' }
// the goodbye: it falters twice before it holds
CATCHES[SAT] = { power: [0, 1, 0.16, 1, 0.22, 1], times: [0, 0.08, 0.3, 0.52, 0.72, 1], s: 0.9, ease: 'easeInOut' }

/** each bulb's light, as a share of a full halo: Friday, their last night, reaches further */
const HALO = DAYS.map((_, k) => (k === FRI ? 1.2 : 1))

/* ───────────── the string: geometry ───────────── */

type Pt = { x: number; y: number }

type Geo = {
  /** globe diameter, socket height and width, halo diameter (px) */
  d: number
  cap: number
  capW: number
  halo: number
  /** room for the full day names */
  full: boolean
  /** where each socket clips onto the wire */
  at: Pt[]
  /** top of each day's name */
  nameY: number[]
  /** where the empty room under the names begins (the chapter title is centred below it) */
  below: number
  /** the wire, tied off a bulb's spacing beyond each end bulb */
  wire: string
  ends: [number, number]
  /** how far in from each tie the wire comes up out of the dark (fraction of its run) */
  fade: number
  /** the warm glow behind the whole string */
  glow: { x: number; y: number; w: number; h: number }
  /** its light falling into the room below, where the day's name hangs */
  spill: { x: number; y: number; w: number; h: number }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r1 = (v: number) => Math.round(v * 10) / 10

/**
 * Six bulbs hanging from a wire strung across the picture. The wire sags
 * as a whole (tied off-screen on a phone, fading into the dark on a wide
 * screen) and dips a little more between sockets, where nothing holds it.
 */
function layout(w: number, h: number): Geo {
  const wide = w >= 600
  const row = Math.min(w - 32, 760)
  const s = row / N
  // the string is the whole picture here: on a phone the globes take most of their spacing
  const d = Math.round(wide ? clamp(s * 0.34, 32, 46) : clamp(s * 0.6, 24, 38))
  const cap = Math.round(d * 0.42)
  const capW = Math.round(d * 0.4)

  const x0 = (w - row) / 2
  const xs = DAYS.map((_, k) => x0 + s * (k + 0.5))
  const a = xs[0] - s
  const b = xs[N - 1] + s
  const mid = (a + b) / 2
  const half = (b - a) / 2
  const sag = clamp((b - a) * 0.1, 26, 64)
  // the middle globes hang above the middle of the picture, leaving the room under them to the day's name
  const top = h * 0.42 - sag - cap - d / 2
  const curve = (x: number) => top + sag * (1 - ((x - mid) / half) ** 2)
  const at = xs.map((x) => ({ x, y: curve(x) }))

  const dip = s * 0.035
  const pts = [{ x: a, y: top }, ...at, { x: b, y: top }]
  let wire = `M${r1(a)} ${r1(top)}`
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1]
    const q = pts[k]
    // a quadratic's control point sits twice as far off the chord as the curve does
    wire += ` Q${r1((p.x + q.x) / 2)} ${r1((p.y + q.y) / 2 + dip * 2)} ${r1(q.x)} ${r1(q.y)}`
  }

  const centre = at.reduce((sum, p) => sum + p.y, 0) / N + cap + d / 2
  const nameY = at.map((p) => p.y + cap + d + Math.round(d * 0.3) + 2)
  return {
    d,
    cap,
    capW,
    halo: Math.round(d * (wide ? 7 : 6.4)),
    full: s >= 84,
    at,
    nameY,
    // a name is about 20px tall
    below: Math.round(Math.max(...nameY) + 28),
    wire,
    ends: [a, b],
    fade: (s * 0.85) / (b - a),
    glow: { x: w / 2, y: centre, w: row * 1.3, h: Math.max(320, row * 0.62) },
    spill: { x: w / 2, y: centre + (h - centre) * 0.42, w: Math.min(w * 1.25, row * 1.6), h: (h - centre) * 1.5 },
  }
}

/** the picture's size, measured before the first paint and kept current */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      setSize((old) => (old && old.w === w && old.h === h ? old : { w, h }))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/* ───────────── the string: physics ───────────── */

/** one swing every 0.85s, and it settles within about two seconds */
const OMEGA = (2 * Math.PI) / 0.85
const STIFF = OMEGA * OMEGA
const DAMP = 2 * 0.16 * OMEGA
/** the push a bulb gets when it lights (deg/s): about 7° at the top of its first swing */
const SWING = 9.5 * OMEGA

/**
 * Each bulb is a little pendulum hanging from its socket. Kicks are angular
 * velocities (deg/s), optionally delayed so a push can travel down the wire.
 * The loop only runs while something is still moving.
 */
function usePendulums(rot: MotionValue<number>[]) {
  const sim = useRef({
    a: rot.map(() => 0),
    v: rot.map(() => 0),
    kicks: [] as { k: number; v: number; wait: number }[],
    running: false,
  })

  const tick = useMemo(
    () =>
      function step({ delta }: FrameData) {
        const s = sim.current
        const ms = Math.min(delta, 40)
        const dt = ms / 1000
        s.kicks = s.kicks.filter((q) => {
          q.wait -= ms
          if (q.wait > 0) return true
          s.v[q.k] += q.v
          return false
        })
        let moving = s.kicks.length > 0
        for (let k = 0; k < rot.length; k++) {
          // semi-implicit Euler: stable at any frame rate we will see
          s.v[k] += (-STIFF * s.a[k] - DAMP * s.v[k]) * dt
          s.a[k] += s.v[k] * dt
          if (Math.abs(s.a[k]) < 0.02 && Math.abs(s.v[k]) < 0.3) {
            s.a[k] = 0
            s.v[k] = 0
          } else {
            moving = true
          }
          rot[k].set(s.a[k])
        }
        if (!moving) {
          s.running = false
          cancelFrame(step)
        }
      },
    [rot],
  )

  const kick = useCallback(
    (k: number, v: number, wait = 0) => {
      if (k < 0 || k >= rot.length || v === 0) return
      const s = sim.current
      s.kicks.push({ k, v, wait })
      if (!s.running) {
        s.running = true
        frame.update(tick, true)
      }
    },
    [rot.length, tick],
  )

  useEffect(
    () => () => {
      sim.current.running = false
      cancelFrame(tick)
    },
    [tick],
  )

  return kick
}

/* ───────────── the scene ───────────── */

type Lamp = {
  /** swing on the wire (deg) */
  rot: MotionValue<number>
  /** a jolt down the wire (px) */
  drop: MotionValue<number>
  /** the hot glass: 0 dark, 1 lit */
  power: MotionValue<number>
  /** a filament at half power burns orange (Thursday, until "I wish...") */
  dim: MotionValue<number>
  /** the light around it */
  halo: MotionValue<number>
  haloScale: MotionValue<number>
  /** the day's name under it */
  name: MotionValue<number>
}

/** how warm the whole stage gets with this many bulbs on (before the last bloom) */
const warmth = (lit: number) => Math.pow(lit / N, 1.4) * 0.85

/** Scene 3: Monday to Saturday. She lights their week, one bulb per day. */
export default function Week() {
  const reduce = !!useReducedMotion()
  const seq = useSequence(BEATS)
  const sound = useSound()
  const [area, size] = useSize<HTMLDivElement>()
  const geo = useMemo(() => (size && size.w > 0 && size.h > 0 ? layout(size.w, size.h) : null), [size])
  // React's ids have changed format before: keep only characters any url(#...) accepts
  const fadeId = `week-wire${useId().replace(/[^\w-]/g, '')}`

  const lamps = useMemo<Lamp[]>(
    () =>
      DAYS.map(() => ({
        rot: motionValue(0),
        drop: motionValue(0),
        power: motionValue(0),
        dim: motionValue(0),
        halo: motionValue(0),
        haloScale: motionValue(0.6),
        name: motionValue(NAME_OFF),
      })),
    [],
  )
  const rots = useMemo(() => lamps.map((l) => l.rot), [lamps])
  const kick = usePendulums(rots)

  const shown = useMotionValue(0)
  const glow = useMotionValue(0)
  const glowScale = useMotionValue(1)
  const bloom = useMotionValue(0)

  // every bulb the film has reached stays lit, even when she reads a line again
  const reached = litAt(seq.i)
  const [lit, setLit] = useState(0)
  if (reached > lit) setLit(reached)
  const together = seq.reached('all')
  const ended = seq.reached('end')
  /** the day this line tells (-1 before Monday, and once the week is told) */
  const day = DAY_OF[seq.i] ?? -1
  const prompted = seq.reached('prompt')

  /** where her finger was, so the bulb swings away from it */
  const touchX = useRef<number | null>(null)
  /** her last touch or key anywhere in the scene: only a bulb she lit herself buzzes the phone */
  const handAt = useRef(-Infinity)
  /** her last input was a key: when a control she is on goes away, the focus is handed on */
  const keyed = useRef(false)
  /** Thursday has had its line, and burns at full power from then on */
  const thuWarm = useRef(false)
  const geoRef = useRef(geo)
  useEffect(() => {
    geoRef.current = geo
  }, [geo])

  // the string comes up out of the dark with the scene
  useEffect(() => {
    const a = animate(shown, 1, { duration: 0.9, delay: 0.1, ease: ease.film })
    return () => a.stop()
  }, [shown])

  // a day's cue waits for its filament to catch: one still waiting when the scene goes is dropped
  const cueTimers = useRef<number[]>([])
  useEffect(() => {
    const timers = cueTimers.current
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [])

  const lightUp = useCallback(
    (k: number) => {
      const l = lamps[k]
      // Thursday: he had to go and meet his friends, so it only burns at half power (orange, not white)
      const half = k === THU && HALF_THU && !thuWarm.current
      const halo = half ? 0.42 : 1
      const spread = HALO[k] * (half ? 0.8 : 1)
      if (performance.now() - handAt.current < 450) haptic(8)
      if (reduce) {
        animate(half ? l.dim : l.power, 1, { duration: 0.35, ease: ease.out })
        if (half) animate(l.power, HALF_CORE, { duration: 0.35, ease: ease.out })
        l.haloScale.set(spread)
        animate(l.halo, halo, { duration: 0.6, ease: ease.film })
        animate(l.name, 1, { duration: 0.4, ease: ease.out })
        // no stutter here: it comes on at once
        sound.cue('bulb', k)
        return
      }
      // the filament catches, the way its day went
      const c = CATCHES[k]
      if (half) {
        animate(l.dim, c.power, { duration: c.s, times: c.times, ease: c.ease })
        animate(l.power, c.power.map((p) => p * HALF_CORE), { duration: c.s, times: c.times, ease: c.ease })
      } else {
        animate(l.power, c.power, { duration: c.s, times: c.times, ease: c.ease })
      }
      // then its light blooms out around it
      const lag = c.s * 0.78
      l.haloScale.set(spread * 0.5)
      animate(l.haloScale, spread, { duration: 0.9, delay: lag, ease: ease.out })
      animate(l.halo, halo, { duration: 0.5, delay: lag, ease: ease.out })
      animate(l.name, 1, { duration: 0.4, delay: Math.min(lag, 0.3), ease: ease.out })
      // the score marks the day as its light blooms: the filament has caught for good by then
      // (after Monday's stutter and Saturday's falter; Thursday at half power)
      cueTimers.current.push(window.setTimeout(() => sound.cue('bulb', k), lag * 1000))
      // her touch sets it swinging (away from her finger), and the wire passes a little on
      const g = geoRef.current
      const x = touchX.current
      const away = g && x != null ? Math.sign(g.at[k].x - x) : 0
      const dir = away || (k % 2 ? 1 : -1)
      // a positive rotation swings the globe left
      kick(k, -dir * SWING)
      kick(k - 1, -dir * SWING * 0.28, 70)
      kick(k + 1, -dir * SWING * 0.28, 70)
    },
    [kick, lamps, reduce, sound],
  )

  // a bulb lights the moment the film reaches its day (her tap, the subtitle, the button, or time)
  const done = useRef(0)
  useLayoutEffect(() => {
    for (let k = done.current; k < lit; k++) lightUp(k)
    done.current = Math.max(done.current, lit)
    touchX.current = null
  }, [lit, lightUp])

  // "I dropped my meat on the floor": Monday's bulb drops on its wire, then springs back
  const dropping = DROP != null && seq.at(DROP)
  useEffect(() => {
    if (!dropping || reduce) return
    const l = lamps[MON]
    const fall = animate(l.drop, [0, 5, -1.4, 0.5, 0], {
      duration: 0.75,
      delay: 0.9,
      times: [0, 0.17, 0.43, 0.72, 1],
      ease: ['easeIn', 'easeOut', 'easeInOut', 'easeOut'],
    })
    // the jolt sets it swinging a little
    kick(MON, SWING * 0.22, 1030)
    return () => {
      fall.stop()
      if (l.drop.get() !== 0) animate(l.drop, 0, { duration: 0.2, ease: ease.out })
    }
  }, [dropping, reduce, lamps, kick])

  // "I wish I had stayed with you instead.": only now does Thursday warm all the way
  const wished = WISH != null && seq.reached(WISH)
  useEffect(() => {
    if (!wished || thuWarm.current) return
    thuWarm.current = true
    if (!HALF_THU || done.current <= THU) return
    const l = lamps[THU]
    const slow = { duration: reduce ? 1.2 : 1.8, delay: 0.35, ease: ease.film }
    animate(l.power, 1, slow)
    animate(l.dim, 0, { duration: reduce ? 1.2 : 1.8, delay: 0.35, ease: 'easeIn' })
    animate(l.halo, 1, slow)
    animate(l.haloScale, HALO[THU], slow)
  }, [wished, reduce, lamps])

  // the stage warms a little with every bulb
  useEffect(() => {
    if (together) return
    const a = animate(glow, warmth(lit), { duration: 0.9, ease: ease.film })
    return () => a.stop()
  }, [lit, together, glow])

  // all six on: a breath, then they wink once together, and their light swells as one
  useEffect(() => {
    if (!together) return
    const run: ReturnType<typeof animate>[] = []
    const g = glow.get()
    if (reduce) {
      // the wink, softly: the string dims once and comes back
      const dim = { duration: 0.8, delay: WINK_AT, ease: 'easeInOut' as const }
      for (const l of lamps) {
        run.push(animate(l.power, [l.power.get(), 0.35, 1], dim))
        run.push(animate(l.halo, [l.halo.get(), 0.4, 1], dim))
      }
      run.push(animate(glow, [g, g * 0.6, 1], { duration: 1.8, delay: WINK_AT, times: [0, 0.25, 1], ease: ease.film }))
      run.push(animate(bloom, [0, 1, 0.58], { duration: 1.9, delay: SWELL_AT, times: [0, 0.32, 1], ease: ease.film }))
      return () => run.forEach((a) => a.stop())
    }
    // the wink: off together, a beat in the dark, on together
    const wink = { duration: 0.36, delay: WINK_AT, times: [0, 0.22, 0.52, 1], ease: 'linear' as const }
    lamps.forEach((l, k) => {
      run.push(animate(l.power, [l.power.get(), 0.03, 0.03, 1], wink))
      run.push(animate(l.halo, [l.halo.get(), 0.12, 0.12, 1], wink))
      // then every halo breathes out at the same moment, whatever it was doing
      const s = HALO[k]
      run.push(animate(l.haloScale, [l.haloScale.get(), 1.2 * s, 1.1 * s], { duration: 1.7, delay: SWELL_AT, times: [0, 0.38, 1], ease: 'easeInOut' }))
    })
    // the warmth of the string goes out with them (in step with the wink), comes back, and swells
    const span = SWELL_AT + 1.4 - WINK_AT
    run.push(
      animate(glow, [g, g * 0.4, g * 0.4, g, 1], {
        duration: span,
        delay: WINK_AT,
        times: [0, 0.08 / span, 0.19 / span, 0.36 / span, 1],
        ease: ['linear', 'linear', 'linear', ease.film],
      }),
    )
    run.push(animate(glowScale, 1.1, { duration: 1.8, delay: SWELL_AT, ease: ease.film }))
    run.push(animate(bloom, [0, 1, 0.58], { duration: 1.9, delay: SWELL_AT, times: [0, 0.32, 1], ease: ease.film }))
    return () => run.forEach((a) => a.stop())
  }, [together, reduce, lamps, glow, glowScale, bloom])

  /** a touch on the string once it's all lit: it sways, the push travelling along the wire */
  const sway = (x: number | null) => {
    const g = geo
    if (reduce || !g) return
    const s = g.at[1].x - g.at[0].x
    g.at.forEach((p, k) => {
      const dx = x == null ? (k - (N - 1) / 2) * s : p.x - x
      const dist = Math.abs(dx)
      const dir = Math.sign(dx) || (k % 2 ? 1 : -1)
      kick(k, -dir * SWING * 0.6 * Math.exp(-dist / (2.4 * s)), dist * 0.9)
    })
  }

  /** a bulb answers her touch with a small swing */
  const nudge = (k: number, x: number | null) => {
    const g = geo
    if (reduce || !g || k < 0) return
    const dir = (x == null ? 0 : Math.sign(g.at[k].x - x)) || (k % 2 ? 1 : -1)
    kick(k, -dir * SWING * 0.45)
  }

  /** the bulb nearest her finger (Monday's without one) */
  const nearest = (x: number | null) => {
    const g = geo
    if (!g || x == null) return MON
    return g.at.reduce((best, p, k) => (Math.abs(p.x - x) < Math.abs(g.at[best].x - x) ? k : best), 0)
  }

  /** the next bulb lights (or, once all six are on, the week is told) */
  const nextDay = (x: number | null) => {
    const next = Math.max(lit, reached)
    if (next < N) {
      touchX.current = x
      seq.jump(`day${next}`)
      return
    }
    if (!together) seq.jump('all')
    else seq.jump('end')
  }

  /**
   * Her tap, Enter or Space on the picture, or the fallback: the rest of this
   * day's lines first, then the next day. Never past a line she hasn't had
   * time to read.
   */
  const advance = (x: number | null) => {
    const i = seq.i
    // the week is told: the string just sways under her finger
    if (ended) {
      sway(x)
      return
    }
    if (BEATS[i].wait !== 'gesture' && seq.elapsed() < MIN_READ) {
      nudge(DAY_OF[i] >= 0 ? DAY_OF[i] : nearest(x), x)
      return
    }
    // the rest of this day's lines, or lines she is reading again (their bulbs are already on)
    if (MORE[i] || (DAY_OF[i] >= 0 && DAY_OF[i] < lit - 1)) {
      seq.next()
      nudge(DAY_OF[i], x)
      return
    }
    nextDay(x)
  }

  // she tried and it didn't take (the words of the prompt, the very edge): the fallback can come now
  const [missed, setMissed] = useState(false)
  const miss = () => {
    if (prompted && lit < N) setMissed(true)
  }

  /** the last press or release on the picture (even one left to the phone's edge swipe) */
  const pressedAt = useRef(-Infinity)
  /** the last press that counted */
  const lastPress = useRef(-Infinity)

  // the light answers on touch-down, not on release: a switch, not a button
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pressedAt.current = performance.now()
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) {
      miss()
      return
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the pointer is already gone */
    }
    // two fingers landing together count once
    if (pressedAt.current - lastPress.current < 90) return
    lastPress.current = pressedAt.current
    advance(e.clientX - e.currentTarget.getBoundingClientRect().left)
  }

  // the click that follows a press (even a long one) is not a second tap
  const onPointerUp = () => {
    pressedAt.current = performance.now()
  }

  // screen readers activate with a click and no press: the same as a tap
  const onClick = () => {
    if (performance.now() - pressedAt.current > 1000) advance(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (!e.repeat) advance(null)
  }

  // once the prompt has asked for a tap, a press on nothing at all (its words, the empty bar) is a try that didn't take
  const onScenePointerDown = (e: PointerEvent<HTMLElement>) => {
    const el = e.target instanceof Element ? e.target : null
    if (el && !el.closest('.week__stage, button, a')) miss()
  }

  const live = !ended
  /** the bulb that waits for her, its filament faintly warm */
  const waiting = lit < N ? lit : -1
  /** what a tap does now: the day's next line, or the next day */
  const label = MORE[seq.i] ? t.actionMore : t.action
  /** the fallback: the same as her tap, once the prompt has asked for one */
  const offer = prompted && lit < N ? label : null

  const scene = useRef<HTMLElement>(null)

  // the fallback changes its name ("Next" / "Next day") or goes away under the keyboard: the focus follows
  useEffect(() => {
    const root = scene.current
    const a = document.activeElement
    if (!root || !(a instanceof HTMLElement) || !root.contains(a) || !a.matches('.bar .btn--ghost')) return
    if (a.textContent === offer) return
    const fresh = offer ? Array.from(root.querySelectorAll<HTMLElement>('.bar .btn--ghost')).find((b) => b.textContent === offer) : undefined
    ;(fresh ?? area.current)?.focus()
  }, [offer, area])

  // played out while the keyboard was on the string (or its fallback just went): hand the focus to Next
  useEffect(() => {
    if (!ended) return
    const a = document.activeElement
    const lost = keyed.current && (!a || a === document.body)
    if (a !== area.current && !lost) return
    const id = window.setTimeout(() => scene.current?.querySelector<HTMLElement>('.btn--next')?.focus(), 80)
    return () => window.clearTimeout(id)
  }, [ended, area])

  const vars = geo
    ? ({
        '--d': `${geo.d}px`,
        '--cap': `${geo.cap}px`,
        '--cap-w': `${geo.capW}px`,
        '--halo': `${geo.halo}px`,
      } as CSSProperties)
    : undefined

  return (
    <section
      ref={scene}
      className="scene week"
      aria-label={SCENE_LABEL}
      onPointerDownCapture={() => {
        handAt.current = performance.now()
        keyed.current = false
      }}
      onKeyDownCapture={() => {
        handAt.current = performance.now()
        keyed.current = true
      }}
      onClickCapture={() => {
        handAt.current = performance.now()
      }}
      onPointerDown={onScenePointerDown}
    >
      <div
        ref={area}
        className={`scene__picture week__stage${live ? '' : ' is-done'}`}
        data-lit={lit}
        role={live ? 'button' : undefined}
        tabIndex={live ? 0 : -1}
        aria-label={live ? label : undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {geo ? (
          <motion.div className="week__string" style={{ ...vars, opacity: shown }} aria-hidden="true">
            {/* its light falling into the room below: it grows with every bulb */}
            <motion.div
              className="week__spill"
              style={{
                left: geo.spill.x - geo.spill.w / 2,
                top: geo.spill.y - geo.spill.h / 2,
                width: geo.spill.w,
                height: geo.spill.h,
                opacity: glow,
              }}
            />
            {/* the warmth of the whole string, and its one swell at the end */}
            <motion.div
              className="week__glow"
              style={{
                left: geo.glow.x - geo.glow.w / 2,
                top: geo.glow.y - geo.glow.h / 2,
                width: geo.glow.w,
                height: geo.glow.h,
                opacity: glow,
                scale: glowScale,
              }}
            />
            <motion.div
              className="week__bloom"
              style={{
                left: geo.glow.x - geo.glow.w * 0.4,
                top: geo.glow.y - geo.glow.h * 0.3,
                width: geo.glow.w * 0.8,
                height: geo.glow.h * 0.6,
                opacity: bloom,
              }}
            />

            {/* each bulb's light, under the wire so the wire reads against it */}
            {lamps.map((l, k) => (
              <motion.div
                key={k}
                className="week__pivot"
                style={{ left: geo.at[k].x, top: geo.at[k].y, rotate: l.rot, y: l.drop }}
              >
                <motion.div className="week__halo" style={{ opacity: l.halo, scale: l.haloScale }} />
              </motion.div>
            ))}

            <svg className="week__wire" width="100%" height="100%">
              <defs>
                <linearGradient id={fadeId} gradientUnits="userSpaceOnUse" x1={geo.ends[0]} x2={geo.ends[1]} y1="0" y2="0">
                  <stop offset="0" stopOpacity="0" />
                  <stop offset={geo.fade} />
                  <stop offset={1 - geo.fade} />
                  <stop offset="1" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={geo.wire} stroke={`url(#${fadeId})`} />
            </svg>

            {lamps.map((l, k) => (
              <motion.div
                key={k}
                className={`week__pivot week__bulb${k === waiting ? ' is-next' : ''}`}
                style={{ left: geo.at[k].x, top: geo.at[k].y, rotate: l.rot, y: l.drop }}
              >
                <div className="week__cap">
                  <motion.div className="week__cap-lit" style={{ opacity: l.power }} />
                </div>
                <div className="week__globe">
                  <div className="week__glass" />
                  <svg className="week__filament" viewBox="0 0 20 20">
                    <path d="M9 0.5 8.1 10.6M11 0.5 11.9 10.6M8.1 10.6l.63-1.1.63 1.1.63-1.1.63 1.1.63-1.1.63 1.1" />
                  </svg>
                  <div className="week__ember" />
                  <motion.div className="week__dim" style={{ opacity: l.dim }} />
                  <motion.div className="week__lit" style={{ opacity: l.power }} />
                  <div className="week__spec" />
                </div>
                {k === 0 && lit === 0 && !reduce ? <span className="week__breath" /> : null}
              </motion.div>
            ))}

            {lamps.map((l, k) => (
              <motion.span
                key={k}
                className="week__day caption"
                style={{ left: geo.at[k].x, top: geo.nameY[k], opacity: l.name }}
              >
                {geo.full ? DAYS[k].name : DAYS[k].short}
              </motion.span>
            ))}
          </motion.div>
        ) : null}

        {/* the day being told, large in the room under the string: one chapter fades out, the next comes up (two words never overlap) */}
        {geo ? (
          <div className="week__chapter" style={{ top: geo.below }} aria-hidden="true">
            <AnimatePresence mode="wait">
              {day >= 0 ? (
                <motion.p
                  key={day}
                  className="week__title"
                  initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    // it comes up with its bulb, once the filament has caught
                    transition: { duration: reduce ? 0.5 : 0.9, delay: reduce ? 0 : CATCHES[day].s * 0.7, ease: ease.film },
                  }}
                  exit={{ opacity: 0, transition: { duration: 0.22, ease: 'easeIn' } }}
                >
                  {DAYS[day].name}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </div>

      {/* the chapter title, for a screen reader: the day, just before its line */}
      <p className="sr-only" aria-live="polite">
        {day >= 0 ? DAYS[day].name : ''}
      </p>

      <Subtitles seq={seq} />

      <Controls action={offer ? { id: 'week-fallback', label: offer, onClick: () => advance(null), late: true, missed } : null} showNext={ended} />
    </section>
  )
}
