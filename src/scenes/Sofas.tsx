import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, type Easing } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { copy } from '../content'
import { Controls } from '../film/Controls'
import { Frame } from '../film/Frame'
import { useSequence, type Beat } from '../film/sequence'
import { useSound } from '../film/sound'
import { Subtitles } from '../film/Subtitles'
import { haptic } from '../lib/feel'
import { kidHer, kidHim, umbrella, type Pt } from '../photos'
import './sofas.css'

const t = copy.sofas

const BEATS: Beat[] = [
  // the two photos and their captions land before the first word
  { id: 'look', ms: 1200 },
  { id: 'kids', say: t.lines[0] },
  // she can start dragging from here: the two lines carry the "before"
  { id: 'apart', say: t.lines[1] },
  { id: 'drag', prompt: t.prompt, wait: 'gesture' },
  // the frames touch: a beat, then the cut
  { id: 'contact', ms: 420 },
  // the clean frame: no text, no buttons, just the two of them (made to be screenshotted)
  { id: 'cut', ms: 1800 },
  ...t.after.map((say, k): Beat => (k === t.after.length - 1 ? { id: 'end', say, wait: 'end' } : { say })),
]

/** the match cut: the kids dissolve into the grown-ups over this long (s), the umbrella photo already there underneath */
const DISSOLVE_S = 0.45
/** the umbrella's bulb flares as the café's string comes on: never brighter than this, so both faces stay readable */
const FLARE_MAX = 0.35
/** each child is a small print on the table, tilted this much (deg): his one way, hers the other. Straight at contact */
const TILT = 1.5
/** before the gesture opens, a curious drag leans them toward each other: this much turn (deg) at most */
const LEAN_DEG = 1.4
/** the cream border of a print (px), thinning to nothing as they come together */
const BORDER = 4
/**
 * Let go past this and they finish coming together on their own: by then
 * (about 74 px of finger on a phone) their borders are all but gone.
 */
const COMMIT = 0.45
/**
 * The eye lines, measured on the photos (deg, clockwise on screen): under the
 * umbrella his head leans 22° toward her, the boy's eyes are nearly level
 * (-2.5°). As she brings them together the boy tilts his head that far,
 * around his eyes, so both eyes (not just the point between them) land on the
 * grown-up's. Hers differ by under 7°, on closed eyes: turning her would cost
 * more zoom than it gains.
 */
const ROLL = { him: 24.5, her: 0 }

type Rect = { x: number; y: number; w: number; h: number }
type Kid = { start: Rect; end: Rect; imgEnd: Rect; glowBase: Rect }
type Geo = { cw: number; ch: number; him: Kid; her: Kid; caption: number; leanPx: number }

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k),
  h: lerp(a.h, b.h, k),
})
const inflate = (r: Rect, k: number): Rect => ({ x: r.x - r.w * k, y: r.y - r.h * k, w: r.w * (1 + 2 * k), h: r.h * (1 + 2 * k) })
const easeInOut = (v: number) => (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** a lean that gives way under her finger but never comes loose (1 at most toward, a little apart the other way) */
const leanFor = (raw: number) => (raw >= 0 ? 1 - Math.exp(-raw * 3) : -0.35 * (1 - Math.exp(raw * 3)))

/**
 * How much a photo turned by `deg` around its eyes must grow (around the eyes
 * too, so they stay put) to still cover its window: 1 when it already does.
 */
function cover(img: Rect, eyes: Pt, deg: number, win: Rect) {
  const ex = img.x + eyes.x * img.w
  const ey = img.y + eyes.y * img.h
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  let c = 1
  for (const [x, y] of [
    [win.x, win.y],
    [win.x + win.w, win.y],
    [win.x, win.y + win.h],
    [win.x + win.w, win.y + win.h],
  ]) {
    // the window's corner, in the unturned photo
    const u = (x - ex) * cos + (y - ey) * sin
    const v = (y - ey) * cos - (x - ex) * sin
    c = Math.max(c, u < 0 ? -u / (eyes.x * img.w) : u / ((1 - eyes.x) * img.w), v < 0 ? -v / (eyes.y * img.h) : v / ((1 - eyes.y) * img.h))
  }
  return c
}

/**
 * Where the child photo has to sit so the child's eyes land exactly on the
 * grown-up eyes in the umbrella photo, at the same size (the match cut).
 * Then grow it around the eyes, if needed, so it still fills its half.
 */
function matchRect(
  kid: { eyes: Pt; eyeGap: number },
  adult: { eyes: Pt; eyeGap: number },
  f: Rect,
  win: Rect,
): Rect {
  const w = (f.w * adult.eyeGap) / kid.eyeGap
  const h = (w * 4) / 3
  const ax = f.x + adult.eyes.x * f.w
  const ay = f.y + adult.eyes.y * f.h
  const r = { x: ax - kid.eyes.x * w, y: ay - kid.eyes.y * h, w, h }
  const need = [
    ax - r.x > 0 ? (ax - win.x) / (ax - r.x) : 1,
    r.x + r.w - ax > 0 ? (win.x + win.w - ax) / (r.x + r.w - ax) : 1,
    ay - r.y > 0 ? (ay - win.y) / (ay - r.y) : 1,
    r.y + r.h - ay > 0 ? (win.y + win.h - ay) / (r.y + r.h - ay) : 1,
  ]
  const s = Math.max(1, ...need) * 1.002
  return { x: ax - (ax - r.x) * s, y: ay - (ay - r.y) * s, w: r.w * s, h: r.h * s }
}

function measure(area: HTMLElement, frame: HTMLElement): Geo {
  const a = area.getBoundingClientRect()
  const fr = frame.getBoundingClientRect()
  const f: Rect = { x: fr.left - a.left, y: fr.top - a.top, w: fr.width, h: fr.height }

  // two small prints side by side, centred where the big one will be
  // (on wide screens they get more room than the frame itself; on a phone, room for their borders)
  const roomy = a.width > f.w * 1.6
  const kw = f.w * (roomy ? 0.56 : 0.44)
  const kh = (kw * 4) / 3
  const gap = f.w * (roomy ? 0.1 : 0.05)
  const caption = Math.max(40, kw * 0.26)
  const top = f.y + (f.h - kh - caption) / 2
  const left = f.x + (f.w - 2 * kw - gap) / 2

  const himStart = { x: left, y: top, w: kw, h: kh }
  const herStart = { x: left + kw + gap, y: top, w: kw, h: kh }
  // after the cut: he is on the left of the head line, she is on the right
  const himEnd = { x: f.x, y: f.y, w: f.w * umbrella.join, h: f.h }
  const herEnd = { x: f.x + f.w * umbrella.join, y: f.y, w: f.w * (1 - umbrella.join), h: f.h }

  return {
    cw: a.width,
    ch: a.height,
    caption,
    leanPx: gap * 0.2,
    him: { start: himStart, end: himEnd, imgEnd: matchRect(kidHim, umbrella.him, f, himEnd), glowBase: inflate(himStart, 0.2) },
    her: { start: herStart, end: herEnd, imgEnd: matchRect(kidHer, umbrella.her, f, herEnd), glowBase: inflate(herStart, 0.2) },
  }
}

/** the DOM pieces of one child's frame, written to directly while she drags */
type PartRefs = {
  layer: RefObject<HTMLDivElement | null>
  img: RefObject<HTMLImageElement | null>
  glow: RefObject<HTMLImageElement | null>
  print: RefObject<HTMLDivElement | null>
  cap: RefObject<HTMLParagraphElement | null>
}

function usePartRefs(): PartRefs {
  return {
    layer: useRef<HTMLDivElement>(null),
    img: useRef<HTMLImageElement>(null),
    glow: useRef<HTMLImageElement>(null),
    print: useRef<HTMLDivElement>(null),
    cap: useRef<HTMLParagraphElement>(null),
  }
}

/** Scene 2: two kids on two leather sofas. She drags them together: match cut. */
export default function Sofas() {
  const reduce = useReducedMotion()
  const seq = useSequence(BEATS)
  const sound = useSound()
  // the gesture opens on the second line, once the "before" has been said
  const ready = seq.reached('apart')
  const p = useMotionValue(0)
  // the two prints leaning toward each other (a curious drag before the gesture opens, the nudges); never part of the merge
  const lean = useMotionValue(0)
  const [phase, setPhase] = useState<'apart' | 'merging' | 'merged'>('apart')
  // she tried the gesture after the prompt and it didn't take: the fallback can come at once
  const [missed, setMissed] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const flash = useRef<HTMLDivElement>(null)
  const hint = useRef<HTMLDivElement>(null)
  const geo = useRef<Geo | null>(null)
  const him = usePartRefs()
  const her = usePartRefs()
  const drag = useRef<{
    id: number
    x: number
    y: number
    p0: number
    l0: number
    dir: 1 | -1
    t: number
    moved: number
    movedY: number
    /** false while the first line plays: the drag only leans them, then lets go */
    open: boolean
  } | null>(null)
  // every finger on the photos (pointerId → x): two can pinch them together, a third changes nothing
  const fingers = useRef(new Map<number, number>())
  // a pinch: her left and right fingers, and how far apart they were when it began
  const pinch = useRef<{ a: number; b: number; d0: number; p0: number } | null>(null)
  const anim = useRef<ReturnType<typeof animate> | null>(null)
  const leanAnim = useRef<ReturnType<typeof animate> | null>(null)
  const merged = useRef(false)
  const bringing = useRef(false)

  /** write the geometry for the current progress and lean straight to the DOM (no React render per frame) */
  const paint = useCallback(() => {
    const g = geo.current
    if (!g) return
    const k = easeInOut(clamp01(p.get()))
    const l = lean.get()
    for (const [kid, refs, side, photo, roll] of [
      [g.him, him, 1, kidHim, ROLL.him],
      [g.her, her, -1, kidHer, ROLL.her],
    ] as const) {
      const parts = {
        layer: refs.layer.current,
        img: refs.img.current,
        glow: refs.glow.current,
        print: refs.print.current,
        cap: refs.cap.current,
      }
      const shift = l * g.leanPx * side
      const win = lerpRect(kid.start, kid.end, k)
      win.x += shift
      const img = lerpRect(kid.start, kid.imgEnd, k)
      img.x += shift
      // his print turns one way and hers the other; both straighten as they come together (0 at contact)
      const tilt = Math.round((-side * TILT * (1 - k) + side * LEAN_DEG * l) * 1000) / 1000
      const turn = tilt ? `rotate(${tilt}deg)` : ''
      const r = Math.round(lerp(3, 0, k) * 10) / 10
      if (parts.layer) {
        parts.layer.style.clipPath = `inset(${win.y}px ${g.cw - win.x - win.w}px ${g.ch - win.y - win.h}px ${win.x}px round ${r}px)`
        parts.layer.style.transformOrigin = `${win.x + win.w / 2}px ${win.y + win.h / 2}px`
        parts.layer.style.transform = turn
      }
      if (parts.print) {
        // the border thins away and the print settles flat (its shadow closes in) before the two edges could meet
        const border = BORDER * clamp01(1 - k / 0.5)
        const lift = clamp01(1 - k / 0.6)
        parts.print.style.visibility = lift > 0 ? '' : 'hidden'
        if (lift > 0) {
          parts.print.style.setProperty('--border', `${border.toFixed(2)}px`)
          parts.print.style.setProperty('--lift', lift.toFixed(3))
          parts.print.style.width = `${win.w}px`
          parts.print.style.height = `${win.h}px`
          parts.print.style.borderRadius = `${r}px`
          parts.print.style.transform = `translate3d(${win.x}px, ${win.y}px, 0) ${turn}`
        }
      }
      if (parts.img) {
        // the boy turns his head as far as the grown-up's, around his eyes, zooming just enough to keep his half covered
        const roll2 = roll * k * k * (3 - 2 * k)
        const s = img.w / kid.imgEnd.w
        let tf = `translate3d(${img.x}px, ${img.y}px, 0) scale(${s})`
        if (roll2) {
          const c = cover(img, photo.eyes, roll2, win)
          const ex = photo.eyes.x * kid.imgEnd.w
          const ey = photo.eyes.y * kid.imgEnd.h
          tf += ` translate(${ex}px, ${ey}px) rotate(${roll2}deg) scale(${c}) translate(${-ex}px, ${-ey}px)`
        }
        parts.img.style.width = `${kid.imgEnd.w}px`
        parts.img.style.height = `${kid.imgEnd.h}px`
        parts.img.style.transform = tf
      }
      if (parts.glow) {
        const gr = inflate(win, 0.2)
        const base = kid.glowBase
        parts.glow.style.width = `${base.w}px`
        parts.glow.style.height = `${base.h}px`
        parts.glow.style.transform = `translate3d(${gr.x}px, ${gr.y}px, 0) scale(${gr.w / base.w}, ${gr.h / base.h})`
        parts.glow.style.opacity = String(lerp(0.42, 0.22, k))
      }
      if (parts.cap) {
        // under the print's border, on the table
        parts.cap.style.transform = `translate3d(${kid.start.x}px, ${kid.start.y + kid.start.h + 14}px, 0)`
        parts.cap.style.width = `${kid.start.w}px`
        parts.cap.style.opacity = String(Math.max(0, 1 - p.get() * 4))
      }
    }
    if (hint.current) {
      const a = g.him.start
      const b = g.her.start
      hint.current.style.transform = `translate3d(${(a.x + a.w + b.x) / 2}px, ${a.y + a.h / 2}px, 0)`
      // the dashes step aside as soon as she pulls (they would land on the boy's face), and come back if the prints spring apart
      hint.current.style.opacity = String(clamp01(1 - p.get() * 6))
    }
    // the part refs and motion values are stable for the life of the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useMotionValueEvent(p, 'change', paint)
  useMotionValueEvent(lean, 'change', paint)

  /**
   * Centre the flare on the umbrella's own bulb, wherever the frame sits on
   * this screen (a phone, a laptop), and size it to the frame.
   */
  const placeFlare = useCallback(() => {
    const el = flash.current
    const fr = frame.current
    if (!el || !fr) return
    const a = el.getBoundingClientRect()
    const f = fr.getBoundingClientRect()
    if (!f.width || !f.height) return
    el.style.setProperty('--flare-x', `${(f.left - a.left + umbrella.bulb.x * f.width).toFixed(1)}px`)
    el.style.setProperty('--flare-y', `${(f.top - a.top + umbrella.bulb.y * f.height).toFixed(1)}px`)
    el.style.setProperty('--flare-rx', `${(f.width * 0.7).toFixed(1)}px`)
    el.style.setProperty('--flare-ry', `${(f.height * 0.68).toFixed(1)}px`)
  }, [])

  useLayoutEffect(() => {
    const run = () => {
      if (!area.current || !frame.current) return
      geo.current = measure(area.current, frame.current)
      paint()
      placeFlare()
    }
    run()
    const ro = new ResizeObserver(run)
    if (area.current) ro.observe(area.current)
    return () => ro.disconnect()
  }, [paint, placeFlare])

  // the umbrella photo waits under the kids, invisible: have it decoded before the cut, so they never dissolve into an empty frame
  // (the photo itself, not the frame's glow before it)
  useEffect(() => {
    frame.current
      ?.querySelector<HTMLImageElement>('.frame__img')
      ?.decode()
      .catch(() => undefined)
  }, [])

  useEffect(
    () => () => {
      anim.current?.stop()
      leanAnim.current?.stop()
    },
    [],
  )

  /** let the lean go: a little spring, unless she prefers less motion */
  const settleLean = useCallback(() => {
    leanAnim.current?.stop()
    if (lean.get() === 0) return
    leanAnim.current = animate(lean, 0, reduce ? { duration: 0.25, ease: 'easeOut' } : { type: 'spring', stiffness: 420, damping: 20 })
  }, [lean, reduce])

  const complete = useCallback(() => {
    if (merged.current) return
    merged.current = true
    anim.current?.stop()
    anim.current = animate(p, 1, { duration: 0.35, ease: [0.23, 1, 0.32, 1] })
    leanAnim.current?.stop()
    lean.set(0)
    haptic(12)
    setPhase('merged')
    seq.jump('contact')
  }, [lean, p, seq])

  /** carry them the rest of the way together, then the cut */
  const carry = useCallback(
    (how: { duration: number; ease: Easing }) => {
      if (merged.current || bringing.current) return
      bringing.current = true
      setPhase('merging')
      settleLean()
      anim.current?.stop()
      anim.current = animate(p, 1, { ...how, onComplete: complete })
    },
    [complete, p, settleLean],
  )

  /** fallback, keyboard and a tap: bring them together for her, an unhurried glide from apart */
  const bring = useCallback(() => carry({ duration: reduce ? 0.6 : 1.6, ease: [0.65, 0, 0.35, 1] }), [carry, reduce])

  // the cut: the kids dissolve into the two of them (the umbrella photo is already there, underneath),
  // and the bulb under the umbrella flares as the café's string comes on (the lighting plot, film.css)
  const isCut = seq.reached('cut')
  const flared = useRef(false)
  useEffect(() => {
    if (!isCut || flared.current || !flash.current) return
    flared.current = true
    // the score marks the cut with the light, once, however she brought them together
    sound.cue('match')
    placeFlare()
    if (reduce) {
      animate(flash.current, { opacity: [0, FLARE_MAX * 0.7, 0] }, { duration: 0.7, times: [0, 0.3, 1], ease: 'easeInOut' })
    } else {
      // a quick bloom out of the bulb, then a long fall-off, all while the faces resolve
      animate(
        flash.current,
        { opacity: [0, FLARE_MAX, 0], scale: [0.8, 1, 1.05] },
        { duration: 0.85, times: [0, 0.18, 1], ease: ['easeOut', 'easeOut'] },
      )
    }
  }, [isCut, placeFlare, reduce, sound])
  const view = isCut ? 'cut' : phase

  // a nudge every few seconds: the two prints lean toward each other
  useEffect(() => {
    if (phase !== 'apart' || reduce || !ready) return
    const id = window.setInterval(() => {
      if (drag.current || merged.current || bringing.current) return
      leanAnim.current?.stop()
      leanAnim.current = animate(lean, [lean.get(), 0.45, 0], { duration: 1.3, ease: 'easeInOut' })
    }, 3400)
    return () => window.clearInterval(id)
  }, [lean, phase, reduce, ready])

  /** her fingers say how far along they are: all the way is contact */
  const follow = (v: number) => {
    p.set(clamp01(v))
    if (p.get() < 0.995) return
    drag.current = null
    pinch.current = null
    fingers.current.clear()
    complete()
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (merged.current || bringing.current || e.button !== 0) return
    if (e.clientX < 24 || e.clientX > window.innerWidth - 24) return // leave the edges to the phone's back gesture
    if (fingers.current.size >= 2) return
    e.currentTarget.setPointerCapture(e.pointerId)
    fingers.current.set(e.pointerId, e.clientX)
    if (drag.current) {
      // a second finger once the gesture is open: a pinch, the gap between her fingers closing brings them together
      // (only with two different fingers down: a repeated pointerdown for the same finger changes nothing)
      if (drag.current.open && !pinch.current && fingers.current.size === 2) {
        const [[left, xl], [right, xr]] = [...fingers.current].sort((m, n) => m[1] - n[1])
        pinch.current = { a: left, b: right, d0: xr - xl, p0: p.get() }
      }
      return
    }
    const a = e.currentTarget.getBoundingClientRect()
    if (ready) {
      // the gesture is open: her finger drives the merge itself
      anim.current?.stop()
      settleLean()
    } else {
      leanAnim.current?.stop()
    }
    // starting on his side pulls right, on her side pulls left; both mean "together"
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      p0: p.get(),
      l0: lean.get(),
      dir: e.clientX < a.left + a.width / 2 ? 1 : -1,
      t: performance.now(),
      moved: 0,
      movedY: 0,
      open: ready,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const g = geo.current
    if (!d || !g || !fingers.current.has(e.pointerId)) return
    fingers.current.set(e.pointerId, e.clientX)
    // this much finger brings them all the way together
    const reach = Math.min(g.cw, 560) * 0.42
    const pn = pinch.current
    if (pn) {
      // the gap between her two fingers closing (even past each other) brings them together
      const xa = fingers.current.get(pn.a)
      const xb = fingers.current.get(pn.b)
      if (xa != null && xb != null) follow(pn.p0 + (pn.d0 - (xb - xa)) / reach)
      return
    }
    if (d.id !== e.pointerId) return
    d.moved = Math.max(d.moved, Math.abs(e.clientX - d.x))
    d.movedY = Math.max(d.movedY, Math.abs(e.clientY - d.y))
    if (!d.open && ready) {
      // the gesture opened under her finger: from here on it drives the merge, starting where it is
      d.open = true
      d.x = e.clientX
      d.p0 = p.get()
      settleLean()
    }
    const v = ((e.clientX - d.x) * d.dir) / reach
    if (!d.open) {
      // the first line is still playing: they lean in under her finger, nothing more
      lean.set(Math.min(1, Math.max(-0.35, d.l0 + leanFor(v))))
      return
    }
    follow(d.p0 + v)
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!fingers.current.delete(e.pointerId)) return
    const d = drag.current
    if (!d) return
    const pn = pinch.current
    if (pn) {
      // one finger of a pinch lifted: the other carries on alone, from where they are (never a tap)
      pinch.current = null
      const id = e.pointerId === pn.a ? pn.b : pn.a
      const x = fingers.current.get(id)
      if (x != null) {
        drag.current = { ...d, id, x, p0: p.get(), dir: id === pn.a ? 1 : -1, moved: Infinity }
        return
      }
    } else if (d.id !== e.pointerId) return // a second finger that never pinched (the gesture wasn't open yet)
    drag.current = null
    fingers.current.clear()
    const tapped = e.type === 'pointerup' && d.moved < 8 && d.movedY < 12 && performance.now() - d.t < 400
    if (!d.open) {
      // before the gesture opens, a tap gets a small lean too: a curious finger never meets a dead screen
      if (tapped && !reduce) {
        leanAnim.current?.stop()
        leanAnim.current = animate(lean, [lean.get(), 0.5, 0], { duration: 0.7, ease: 'easeInOut' })
      } else settleLean()
      return
    }
    // a plain tap on the photos also brings them together (she should never be stuck)
    if (tapped) {
      bring()
      return
    }
    if (p.get() > COMMIT) {
      // they carry on at about her pace and settle into each other (paint() eases the landing, so it ends on contact)
      carry({ duration: 0.15 + 0.6 * (1 - p.get()), ease: 'linear' })
      return
    }
    anim.current = animate(p, 0, { type: 'spring', stiffness: 260, damping: 28 })
    // she let go before they touched: once she has been asked, the fallback needn't wait any longer
    if (seq.reached('drag')) setMissed(true)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (ready && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      bring()
    }
  }

  const hideChrome = seq.at('cut')

  return (
    <section className="scene sofas" aria-label="Two kids, two sofas">
      <div
        ref={area}
        className="scene__picture sofas__stage"
        data-phase={view}
        role={phase === 'apart' && ready ? 'button' : undefined}
        tabIndex={phase === 'apart' && ready ? 0 : -1}
        aria-label={phase === 'apart' && ready ? t.prompt : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {/* the umbrella photo: invisible until the cut, but always laid out so the kids know where to land */}
        <Frame photo={umbrella} frameRef={frame} push={view === 'cut'} className="sofas__final" />

        {/* at the cut the kids stay a moment longer and dissolve into the grown-ups, eyes on eyes */}
        <AnimatePresence>
          {view !== 'cut' ? (
            <motion.div
              key="kids"
              className="sofas__kids"
              exit={{ opacity: 0, transition: { duration: DISSOLVE_S, ease: 'easeInOut' } }}
            >
              {(
                [
                  [kidHim, him, t.hisCaption],
                  [kidHer, her, t.herCaption],
                ] as const
              ).map(([photo, refs, caption]) => (
                <div key={photo.src} className="sofas__kid">
                  <img ref={refs.glow} className="sofas__glow" src={photo.glow} alt="" aria-hidden="true" />
                  <div ref={refs.print} className="sofas__print" aria-hidden="true" />
                  <div ref={refs.layer} className="sofas__layer">
                    <img ref={refs.img} className="sofas__img" src={photo.src} alt={photo.alt} draggable={false} />
                  </div>
                  <p ref={refs.cap} className="sofas__caption caption">
                    {caption}
                  </p>
                </div>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* two small marks pointing at each other in the gap: "together" */}
        <div ref={hint} className="sofas__hint-pos" aria-hidden="true">
          <motion.div
            className="sofas__hint"
            initial={false}
            animate={{ opacity: phase === 'apart' && seq.reached('drag') ? 1 : 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="sofas__mark" />
            <span className="sofas__mark sofas__mark--r" />
          </motion.div>
        </div>
      </div>

      <Subtitles seq={seq} hidden={hideChrome} />

      <Controls
        hidden={hideChrome}
        // never before the prompt, and late: she tries the gesture first (at once if she tried and it didn't take)
        action={phase === 'apart' && seq.reached('drag') ? { label: t.action, onClick: bring, late: true, missed } : null}
        showNext={seq.reached('end')}
      />

      <div ref={flash} className="flash" aria-hidden="true" />
    </section>
  )
}
