import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import './fireflies.css'

/*
 * Fireflies (đom đóm): a few warm motes drifting slowly up through the dark,
 * each blinking on its own rhythm. A summer night in Vietnam, not confetti.
 *
 * They fill their parent (position it and give it a size) and sit behind
 * whatever comes after them. Each mote is one small layer with two long CSS
 * animations, one of transform and one of opacity (fireflies.css), so the
 * phone's compositor flies it: nothing is drawn again per frame, and no
 * script runs while they fly. Where they are born, their paths and rhythms
 * are worked out once per mount (and again if the field is resized), from a
 * hash of their index, and handed to the CSS as custom properties. With
 * reduced motion, eight of them stay, faint and still.
 */

/** a point in the field, as fractions of its width (x) and height (y) */
export type FieldPoint = { x: number; y: number }

/** a box round the middle of the field that no firefly ever crosses (half its width and height, px): words go there */
export type ClearZone = { halfW: number; halfH: number }

/** a few, never a swarm */
const COUNT = 18
/** how many are born round `near` (a lamp), so the field is a little denser there at first */
const NEAR = 5
/** with reduced motion, this many stay (faint and still) */
const STILL = 8
/** `slow`: everything goes this much slower (a held breath, not a stop) */
const SLOW_RATE = 0.7
/** the field comes up over this long once mounted (ms) */
const FADE_MS = 2000
/** the points sampled on a life's path (fireflies.css has the same ten) */
const POINTS = 10
/** change it for another field (the same one on every visit otherwise) */
const SEED = 11

type Kind = 'sharp' | 'soft' | 'bokeh'
type Blink = 'glow' | 'pulse' | 'flicker'
type Mote = { kind: Kind; blink: Blink; still: boolean; style: CSSProperties }
type Field = { w: number; h: number }

/** tungsten only: the hot core and its glow, as "r g b" (glows: bulb yellow #ffd683, filament amber #f2a23a, #ffc070) */
const COLOURS: readonly (readonly [string, string])[] = [
  ['255 236 178', '255 214 131'],
  ['255 222 150', '242 162 58'],
  ['255 230 170', '255 192 112'],
]

/** the plastic number: an R2 sequence spreads points evenly, without the clumps of plain random ones */
const G = 1.324717957244746

/** a hash of (mote, salt) in [0, 1): the same field on every mount */
function rand(i: number, salt: number) {
  let t = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + SEED, 0x85ebca6b)) >>> 0
  t = Math.imul(t ^ (t >>> 16), 0x7feb352d)
  t = Math.imul(t ^ (t >>> 15), 0x846ca68b)
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296
}

const px = (n: number) => `${n.toFixed(1)}px`
const sec = (n: number) => `${n.toFixed(2)}s`

function makeMotes(
  count: number,
  { w, h }: Field,
  nx: number | undefined,
  ny: number | undefined,
  clearW: number | undefined,
  clearH: number | undefined,
): Mote[] {
  const near = nx != null && ny != null ? Math.min(NEAR, count) : 0
  const motes: Mote[] = []
  let still = 0
  for (let i = 0; i < count; i++) {
    const r = (salt: number) => rand(i, salt)
    const span = (salt: number, lo: number, hi: number) => lo + (hi - lo) * r(salt)

    // a few large dim ones out of focus, a few small sharp ones, the rest in between
    const kind: Kind = i % 6 === 4 ? 'bokeh' : i % 3 === 1 ? 'sharp' : 'soft'
    const size = kind === 'bokeh' ? span(1, 16, 18) : kind === 'sharp' ? span(1, 10, 12) : span(1, 13, 16)
    const core = kind === 'bokeh' ? 4 : kind === 'sharp' ? 2 : 3
    const life = kind === 'bokeh' ? span(2, 20, 26) : kind === 'sharp' ? span(2, 12, 18) : span(2, 14, 24)
    // out of focus is close to the lens: it barely travels
    const rise = kind === 'bokeh' ? span(3, 24, 60) : span(3, 50, 130)
    const sway = kind === 'bokeh' ? span(4, 4, 10) : span(4, 8, 20)

    // where it is born (px in the field), and how it drifts sideways over a life
    let x: number
    let y: number
    let drift: number
    let lifeAt: number
    if (i < near) {
      // in a loose ring round the lamp, beside and below it (where the room is), drifting away from it;
      // they come out one after the other once the light is on
      const a = Math.PI * (0.12 + (0.98 * (i + 0.2 + 0.6 * r(5))) / near)
      const d = span(6, 30, 96)
      x = nx! * w + Math.cos(a) * d
      y = ny! * h + Math.sin(a) * d
      drift = Math.cos(a) * span(7, 24, 64)
      lifeAt = 0.2 + i * 0.36 + 0.2 * r(8)
    } else {
      // spread evenly over the whole field, a little low (they rise), each already somewhere in its life
      const k = i - near + 1
      x = (0.05 + 0.9 * ((0.5 + k / G) % 1)) * w
      y = (0.12 + 0.86 * ((0.5 + k / (G * G)) % 1)) * h
      drift = span(7, -40, 40)
      lifeAt = -life * r(8)
    }

    // its path: a slow rise, a little sideways overall, with a soft sway from side to side and a small
    // bob on the way (POINTS points sampled from that curve; the CSS goes straight from one to the next)
    const swayTurns = span(9, 1, 1.6)
    const swayFrom = span(10, 0, Math.PI * 2)
    const bob = span(11, 3, 9)
    const bobTurns = span(12, 0.7, 1.3)
    const bobFrom = span(13, 0, Math.PI * 2)
    const xs = [0]
    const ys = [0]
    for (let p = 1; p <= POINTS; p++) {
      const t = p / POINTS
      xs.push(drift * t + sway * (Math.sin(Math.PI * 2 * swayTurns * t + swayFrom) - Math.sin(swayFrom)))
      ys.push(-rise * t + bob * (Math.sin(Math.PI * 2 * bobTurns * t + bobFrom) - Math.sin(bobFrom)))
    }

    // never across the words: a life that would pass through their box is born above it (it rises away)
    // or, if it was born below their middle and there is room, low enough to end its rise under it
    if (clearW != null && clearH != null) {
      const pad = size / 2
      const cx = w / 2
      const cy = h / 2
      const across = x + Math.max(...xs) + pad > cx - clearW && x + Math.min(...xs) - pad < cx + clearW
      const up = -Math.min(...ys) + pad
      const down = Math.max(...ys) + pad
      if (across && y + down > cy - clearH && y - up < cy + clearH) {
        const lowest = cy + clearH + up
        const highest = cy - clearH - down
        if (y >= cy && lowest <= h - pad) y = lowest + (h - pad - lowest) * r(14)
        else y = highest - Math.max(0, highest - 0.08 * h) * r(14)
      }
    }

    const path: Record<string, string> = {}
    for (let p = 1; p <= POINTS; p++) {
      path[`--ff-x${p}`] = px(xs[p])
      path[`--ff-y${p}`] = px(ys[p])
    }

    const blink: Blink = kind === 'bokeh' ? 'flicker' : r(40) < 0.42 ? 'glow' : r(40) < 0.8 ? 'pulse' : 'flicker'
    const [hot, warm] = COLOURS[Math.floor(r(41) * COLOURS.length)]
    const isStill = i >= near && still < STILL && (i - near) % 3 !== 2
    if (isStill) still++

    motes.push({
      kind,
      blink,
      still: isStill,
      style: {
        left: px(x),
        top: px(y),
        '--ff-size': px(size),
        '--ff-core': px(core),
        '--ff-hot': hot,
        '--ff-warm': warm,
        '--ff-life': sec(life),
        '--ff-life-at': sec(lifeAt),
        ...path,
      } as CSSProperties,
    })
  }
  return motes
}

export function Fireflies({
  near,
  clear,
  slow = false,
  count = COUNT,
}: {
  /** where a few of them are born (a lamp), in fractions of the field */
  near?: FieldPoint
  /** a box round the middle of the field they keep out of (the words) */
  clear?: ClearZone
  /** drift and blink a little slower (each keeps its place in its life: no jump) */
  slow?: boolean
  count?: number
}) {
  const root = useRef<HTMLDivElement>(null)
  const [field, setField] = useState<Field | null>(null)

  // their places are in px of the field: measured before the first paint, and again when it is resized
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const measure = () => {
      const box = el.getBoundingClientRect()
      const w = Math.round(box.width)
      const h = Math.round(box.height)
      if (!w || !h) return
      setField((was) => (was && was.w === w && was.h === h ? was : { w, h }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  const nx = near?.x
  const ny = near?.y
  const cw = clear?.halfW
  const ch = clear?.halfH
  const motes = useMemo(() => (field ? makeMotes(count, field, nx, ny, cw, ch) : []), [count, field, nx, ny, cw, ch])

  // they come out over two seconds (a plain fade, so reduced motion gets it too)
  useLayoutEffect(() => {
    const el = root.current
    if (!el || typeof el.animate !== 'function') return
    const up = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' })
    return () => up.cancel()
  }, [])

  // slower: only the speed of each flight changes (still on the compositor)
  useEffect(() => {
    const el = root.current
    if (!el || typeof el.getAnimations !== 'function') return
    const rate = slow ? SLOW_RATE : 1
    for (const a of el.getAnimations({ subtree: true })) {
      // only the CSS flights (the fade-in above has no animationName)
      if (!('animationName' in a) || a.playbackRate === rate) continue
      if (typeof a.updatePlaybackRate === 'function') a.updatePlaybackRate(rate)
      else a.playbackRate = rate
    }
  }, [slow])

  return (
    <div ref={root} className="fireflies" aria-hidden="true">
      {motes.map((m, k) => (
        <div
          key={k}
          className={`firefly firefly--${m.kind} firefly--${m.blink}`}
          data-still={m.still ? '' : undefined}
          style={m.style}
        />
      ))}
    </div>
  )
}
