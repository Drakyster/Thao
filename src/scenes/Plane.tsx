import { animate, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { copy } from '../content'
import { Controls, LATE_MS } from '../film/Controls'
import { useSequence, type Beat } from '../film/sequence'
import { useSound, type Cue } from '../film/sound'
import { Subtitles } from '../film/Subtitles'
import { ease, haptic } from '../lib/feel'
import './plane.css'

const t = copy.plane

/** Screen-reader name of the scene. Not in content.ts (see the scene report). */
const SCENE_LABEL = 'The flight back'

/** one of her real messages, if he put one in content.ts: it shows on the clear glass after his last line */
const HER_MESSAGE = t.herMessage.trim()

/* ───────────── the lines ───────────── */

/** the line where he says he cried: a drop runs down the glass while it plays */
const CRIED = Math.max(
  0,
  t.lines.findIndex((line) => /\bcr(y|ied|ying)\b/i.test(line)),
)

/** what he tells her before he asks: the airport, leaving her there, the plane */
const STORY: Beat[] = [
  { id: 'lead', say: t.lead },
  ...t.lines.map((say, k): Beat => (k === CRIED ? { id: 'cried', say } : { say })),
]
/** where "I cried" is in his story: the fog never lifts before it, so "Thanks" never comes first */
const CRIED_AT = STORY.findIndex((b) => b.id === 'cried')
const PROMPT: Beat = { id: 'prompt', prompt: t.prompt, wait: 'gesture' }
/** said the moment the fog lifts */
const THANKS: Beat = { id: 'after', say: t.after }
/** over the clear night */
const AFTER: Beat[] = t.afterLines.map((say): Beat => ({ say }))
/** the last line's id, unless it already has one */
const END = 'end'

/* ───────────── the window ───────────── */

/*
 * Sizes are shares of the shared frame's width. The pane is 0.7 wide for 1
 * high, with cabin-window corners (46% / 36%), set in a thick bezel whose
 * corners are worked out here so they stay concentric with the pane's.
 */
const PANE = 0.64
const PANE_RATIO = 0.7
const CORNER = { x: 0.46, y: 0.36 }
const BEZEL = 0.085
const PANE_H = PANE / PANE_RATIO
const WIN_W = PANE + 2 * BEZEL
const WIN_H = PANE_H + 2 * BEZEL
const pct = (v: number) => `${(v * 100).toFixed(3)}%`

const WINDOW_STYLE = {
  '--win-w': pct(WIN_W),
  '--win-ratio': `${WIN_W.toFixed(4)} / ${WIN_H.toFixed(4)}`,
  '--pane-x': pct(BEZEL / WIN_W),
  '--pane-y': pct(BEZEL / WIN_H),
  '--win-rx': pct((CORNER.x * PANE + BEZEL) / WIN_W),
  '--win-ry': pct((CORNER.y * PANE_H + BEZEL) / WIN_H),
  '--pane-rx': pct(CORNER.x),
  '--pane-ry': pct(CORNER.y),
} as CSSProperties

/** where the sky meets the ground, as a share of the pane's height (also in plane.css) */
const HORIZON = 0.58
/** the city lights come in a few groups that drift down and fade in turn */
const CITY_GROUPS = 5
const CITY_CYCLE_S = 16

/* ───────────── the wipe ───────────── */

/** presses this close to a screen edge belong to the phone's back swipe */
const EDGE = 24
/** the finger's brush, as a share of the pane's width (radius): a fingertip pushing fog aside, four or five strokes clear it */
const BRUSH = 0.15
/** each dab of the brush lifts this much of what is left under it */
const DAB = 0.5
/** cleared share of the glass that lifts the rest of the fog */
const CLEAR_AT = 0.4
/** never stuck scrubbing one spot: after this much wiping (in pane heights), a little less will do */
const LONG_WIPE = 6
const CLEAR_AT_LONG = 0.3
/** without a counting copy (out of canvas memory): this much wiping, in pane heights, clears it */
const WIPE_ENOUGH = 2.2
/** how often the cleared share is counted while she wipes */
const COUNT_MS = 150
/** a light tick of haptics every this many px of wiping */
const TICK_PX = 120
/** after the fog lifts, a breath before he says thanks (with the prompt's 0.14 s exit, "Thanks" comes in within 0.4 s) */
const THANKS_AFTER_MS = 180
/** when she clears the window early, the line on screen stays up at least this long before "Thanks" */
const HEARD_MS = 2000
/** ...unless it has only just been cued (the line before it is still fading out): then it waits until after */
const FRESH_MS = 300
/** she wiped some, let go, and nothing more for this long: the fallback comes now */
const MISS_MS = 2000
/** her message fades in on the clear glass this long after his last line */
const MESSAGE_DELAY_S = 1.4
/** "Wipe it": four sweeps of a palm, top to bottom (x1, y1, x2, y2, bow), in pane shares */
const SWEEPS: [number, number, number, number, number][] = [
  [-0.14, 0.15, 1.14, 0.25, 0.07],
  [1.14, 0.36, -0.14, 0.46, 0.06],
  [-0.14, 0.58, 1.14, 0.67, 0.06],
  [1.14, 0.79, -0.14, 0.89, 0.05],
]
const SWEEP_S = 0.34
/** the palm's radius, as a share of the pane's width */
const PALM = 0.17
/**
 * Until he has said he cried and the drop has run, her finger only breathes
 * on the glass: what it clears stays while she wipes, then fogs back over, all
 * of it at once, like breath on cold glass. The story waits for his line; the
 * glass still answers.
 */
const MIST_HOLD_MS = 350
const MIST_FADE_MS = 1150

/** the drop that runs down while he says he cried: [seconds, height share] (it slides, catches, slides, slowly) */
const TEAR: [number, number][] = [
  [0, 0.16],
  [0.75, 0.16],
  [1.55, 0.245],
  [2.1, 0.252],
  [3.45, 0.44],
  [4.05, 0.448],
  [5.75, 0.69],
]
const TEAR_X = 0.635
/** drop radius at a 250px-wide pane */
const TEAR_R = 6
/** the drop starts down this long after he says he cried */
const CRY_DELAY_MS = 450
/** ...and has stopped this long after */
const CRY_END_MS = CRY_DELAY_MS + TEAR[TEAR.length - 1][0] * 1000
/** "I cried" stays up while the drop runs, and a breath after it stops (a tap still goes on sooner) */
const CRIED_MS = CRY_END_MS + 300
/** his story with "I cried" held for the drop */
const STORY_HELD: Beat[] = STORY.map((b): Beat => (b.id === 'cried' ? { ...b, ms: CRIED_MS } : b))

/**
 * She cleared the window before he asked (only possible once he has said he
 * cried and the drop has run): "Thanks" goes in before line `at` of his story,
 * right after the one on screen when the fog lifted.
 */
type Early = { at: number }

/**
 * The scene's lines, in order. Normally his story, the prompt, then "Thanks"
 * once she has wiped the window, and the rest over the clear night. If she
 * clears it before he asks, he thanks her there and then and goes on with
 * what she hasn't heard yet. "I cried" holds while the drop runs down the
 * fogged glass (not once the fog is gone, nor with reduced motion: nothing runs).
 */
function beatsFor(early: Early | null, reduce: boolean): Beat[] {
  const story = reduce ? STORY : STORY_HELD
  const list =
    early == null
      ? [...story, PROMPT, THANKS, ...AFTER]
      : [...story.slice(0, early.at), THANKS, ...STORY.slice(early.at), ...AFTER]
  // the last line stays up: it ends the scene
  const last = list.length - 1
  list[last] = { ...list[last], id: list[last].id ?? END, wait: 'end' }
  return list
}

const TAU = Math.PI * 2
const MAX_DPR = 2
/** px of a 250px-wide pane: drawings scale with the pane */
const UNIT = 250

type Pt = { x: number; y: number }
/** a brush on the move: where it is, and how far it has gone since its last dab */
type Pen = { at: Pt; carry: number }
type RGB = readonly [number, number, number]
type Playback = ReturnType<typeof animate>

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const smooth = (k: number) => k * k * (3 - 2 * k)
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const dpr = () => Math.min(MAX_DPR, window.devicePixelRatio || 1)

/** Mulberry32: the same fog, drops and city every time she plays it. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let z = a
    z = Math.imul(z ^ (z >>> 15), z | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}

/* ───────────── colour, from tokens.css ───────────── */

/** a colour token as numbers, so the canvas can fade it */
function token(name: string, fallback: RGB): RGB {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = /^#([0-9a-f]{6})$/i.exec(v)
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${clamp(a, 0, 1).toFixed(3)})`
const mix = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]

/*
 * The glass's own colours. The only light in the cabin is the warm reading
 * light, so the condensation is a warm grey, never blue: all the cool is
 * outside, in the night. Painted in, so there is no filter pass while she wipes.
 */
/** the veil of fog, thinner and a touch darker up top, heavier and lighter low down */
const FOG_TOP: RGB = [171, 160, 150]
const FOG: RGB = [176, 164, 152]
const FOG_LOW: RGB = [184, 171, 158]
/** thicker banks of fog, and the rim, which fogs up first */
const FOG_BANK: RGB = [182, 169, 156]
/** fine droplets catching the light, and the water a finger pushes aside */
const MIST: RGB = [230, 219, 204]
/** a drop's body: clear water, a touch lighter than the glass behind it */
const WATER: RGB = [190, 179, 166]
/** a drop's rim, where it bends the light away */
const SHADE: RGB = [12, 7, 4]
/** the reading light, focused low in a drop */
const CAUGHT: RGB = [246, 229, 204]

type Palette = { city: RGB[]; star: RGB; glint: RGB; haze: RGB }

function palette(): Palette {
  const white = token('--white', [249, 244, 220])
  const sub = token('--sub', [247, 224, 138])
  const tungsten = token('--tungsten', [234, 154, 26])
  const apricot = token('--apricot', [224, 153, 119])
  const tower = token('--tower', [97, 101, 178])
  return {
    // warm white first (picked most), then sodium amber, then the odd cold LED
    city: [white, mix(white, sub, 0.55), sub, mix(sub, tungsten, 0.55), mix(tungsten, apricot, 0.35), mix(white, tower, 0.22)],
    star: mix(white, tower, 0.3),
    glint: white,
    haze: mix(apricot, tungsten, 0.25),
  }
}

/* ───────────── drawing helpers ───────────── */

/** a canvas sized to its element at the screen's density (max 2x), drawn in CSS px */
function fit(canvas: HTMLCanvasElement, w: number, h: number) {
  const d = dpr()
  canvas.width = Math.max(1, Math.round(w * d))
  canvas.height = Math.max(1, Math.round(h * d))
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0)
  return ctx
}

/** the pane's outline (CSS border-radius x% / y%) as a canvas path */
function panePath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const rx = w * CORNER.x
  const ry = h * CORNER.y
  ctx.beginPath()
  ctx.moveTo(rx, 0)
  ctx.lineTo(w - rx, 0)
  ctx.ellipse(w - rx, ry, rx, ry, 0, -Math.PI / 2, 0)
  ctx.lineTo(w, h - ry)
  ctx.ellipse(w - rx, h - ry, rx, ry, 0, 0, Math.PI / 2)
  ctx.lineTo(rx, h)
  ctx.ellipse(rx, h - ry, rx, ry, 0, Math.PI / 2, Math.PI)
  ctx.lineTo(0, ry)
  ctx.ellipse(rx, ry, rx, ry, 0, Math.PI, Math.PI * 1.5)
  ctx.closePath()
}

/** is (x, y) inside the pane, at least m px from its edge? */
function inPane(x: number, y: number, w: number, h: number, m: number) {
  const rx = w * CORNER.x
  const ry = h * CORNER.y
  if (x < m || x > w - m || y < m || y > h - m) return false
  const cx = clamp(x, rx, w - rx)
  const cy = clamp(y, ry, h - ry)
  if (cx === x || cy === y) return true
  const ex = (x - cx) / Math.max(1, rx - m)
  const ey = (y - cy) / Math.max(1, ry - m)
  return ex * ex + ey * ey <= 1
}

/** a round sprite from a radial profile: [radius share, alpha] stops, in one colour */
function sprite(stops: [number, number][], rgb = '0, 0, 0') {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')
  if (!g) return c
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(${rgb}, ${a})`)
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  return c
}

/** the finger: fully clear in the middle, a short soft edge (a finger pushes fog aside, it doesn't feather it) */
const makeBrush = () =>
  sprite([
    [0, 1],
    [0.66, 1],
    [0.8, 0.62],
    [0.92, 0.18],
    [1, 0],
  ])

/** the water a finger pushes aside: a faint lighter ring just outside the brush (drawn on the fog only) */
const makeRim = () =>
  sprite(
    [
      [0, 0],
      [0.6, 0],
      [0.74, 1],
      [0.84, 0.45],
      [1, 0],
    ],
    MIST.join(', '),
  )

/** the brush's radius inside the rim sprite (the ring peaks just outside it) */
const RIM_SCALE = 1.32

/** a drop's outline: a flatter top and a fuller bottom, the way water hangs on an upright pane */
function dropPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.ellipse(x, y, r, r * 0.96, 0, Math.PI, TAU)
  ctx.ellipse(x, y, r, r * 1.18, 0, 0, Math.PI)
  ctx.closePath()
}

/**
 * A water drop on the glass. Water is clear (the drop has gathered the fog
 * that was under it) and works as a small lens: its rim bends the light away
 * and reads darker, most of all at the top; the cabin light above is focused
 * into a bright crescent at the bottom; and the reading light shows as one
 * small sharp glint, up and to the left. `open` clears the fog under it.
 */
function drawDrop(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, open: boolean, pal: Palette) {
  const ry = r * 1.18
  if (open) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)'
    dropPath(ctx, x, y, r)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  if (r < 1.3) {
    // too small for detail: a darker bead and a dim glint
    ctx.fillStyle = rgba(SHADE, 0.28)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
    ctx.fillStyle = rgba(pal.glint, 0.45)
    ctx.beginPath()
    ctx.arc(x - r * 0.3, y - r * 0.35, Math.max(0.3, r * 0.34), 0, TAU)
    ctx.fill()
    return
  }

  // body: clear water, a touch lighter than the bare glass behind it
  ctx.fillStyle = rgba(WATER, 0.08)
  dropPath(ctx, x, y, r)
  ctx.fill()

  // rim: darkest at the top, gone by the bottom
  const lw = Math.max(0.55, r * 0.2)
  const rim = ctx.createLinearGradient(0, y - r, 0, y + ry)
  rim.addColorStop(0, rgba(SHADE, 0.62))
  rim.addColorStop(0.55, rgba(SHADE, 0.3))
  rim.addColorStop(1, rgba(SHADE, 0.08))
  ctx.lineWidth = lw
  ctx.strokeStyle = rim
  dropPath(ctx, x, y, r - lw / 2)
  ctx.stroke()

  // the crescent: the reading light from above, focused low in the drop
  const cres = ctx.createRadialGradient(x, y + ry * 0.6, 0, x, y + ry * 0.6, r * 0.9)
  cres.addColorStop(0, rgba(CAUGHT, 0.34))
  cres.addColorStop(1, rgba(CAUGHT, 0))
  ctx.save()
  dropPath(ctx, x, y, r - lw)
  ctx.clip()
  ctx.fillStyle = cres
  ctx.fillRect(x - r, y, r * 2, ry)
  ctx.restore()

  // the glint
  const hx = x - r * 0.36
  const hy = y - r * 0.42
  const hr = Math.max(0.6, r * 0.26)
  const glint = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr)
  glint.addColorStop(0, rgba(pal.glint, 0.95))
  glint.addColorStop(0.5, rgba(pal.glint, 0.5))
  glint.addColorStop(1, rgba(pal.glint, 0))
  ctx.fillStyle = glint
  ctx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2)
}

/** where the running drop is at `time` (seconds), as a share of the pane's height */
function tearAt(time: number) {
  for (let k = 1; k < TEAR.length; k++) {
    const [t1, y1] = TEAR[k]
    if (time <= t1) {
      const [t0, y0] = TEAR[k - 1]
      return lerp(y0, y1, smooth((time - t0) / (t1 - t0)))
    }
  }
  return TEAR[TEAR.length - 1][1]
}

const tearX = (x0: number, y: number, y0: number, s: number) => x0 + Math.sin((y - y0) / (14 * s)) * 1.1 * s + (y - y0) * 0.018

/* ───────────── the night outside ───────────── */

/** stars above, and the far city as a seam of tiny lights along the horizon. Never moves. */
function paintFar(ctx: CanvasRenderingContext2D, w: number, h: number, pal: Palette) {
  const r = rng(11)
  const s = w / UNIT
  const gauss = () => (r() + r() + r() - 1.5) / 1.5

  for (let i = 0; i < 30; i++) {
    const x = r() * w
    const y = (0.03 + r() * (HORIZON - 0.15)) * h
    const bright = r() < 0.15
    ctx.fillStyle = rgba(pal.star, bright ? 0.6 + r() * 0.3 : 0.14 + r() * r() * 0.5)
    ctx.beginPath()
    ctx.arc(x, y, (bright ? 0.6 + r() * 0.3 : 0.3 + r() * r() * 0.45) * s, 0, TAU)
    ctx.fill()
  }

  const hz = HORIZON * h
  for (let k = 0; k < 7; k++) {
    // a town on the horizon: a short, flat cluster
    const cx = r() * w
    const n = 6 + Math.floor(r() * 12)
    const spread = (0.04 + r() * 0.09) * w
    for (let i = 0; i < n; i++) {
      const x = cx + gauss() * spread
      const y = hz + 0.6 * s + Math.abs(gauss()) * 0.026 * h
      const c = pal.city[1 + Math.floor(r() * 4)]
      ctx.fillStyle = rgba(c, 0.25 + r() * 0.5)
      ctx.beginPath()
      ctx.arc(x, y, (0.26 + r() * 0.32) * s, 0, TAU)
      ctx.fill()
    }
  }

  // the middle distance: fine, dim points, thinning out toward the horizon
  for (let i = 0; i < 70; i++) {
    const d = r()
    const x = r() * w
    const y = hz + (0.035 + d * d * 0.12) * h
    const c = pal.city[1 + Math.floor(r() * 4)]
    ctx.fillStyle = rgba(c, 0.18 + r() * 0.42)
    ctx.beginPath()
    ctx.arc(x, y, (0.24 + d * 0.3 + r() * 0.15) * s, 0, TAU)
    ctx.fill()
  }
}

/**
 * One group of city lights below the horizon (canvas-local px): a
 * neighbourhood or two, a street, every other group a highway, a few strays.
 */
function paintCity(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, pal: Palette, highway: boolean) {
  const r = rng(seed)
  const s = w / UNIT
  const gauss = () => (r() + r() + r() - 1.5) / 1.5

  /** one light; `big` lights are the odd brighter one (a stadium, a petrol station, a main road) */
  const light = (x: number, y: number, big = false) => {
    if (x < -6 || x > w + 6 || y < 0 || y > h) return
    // nearer the plane (lower) = a little bigger and brighter
    const d = clamp(y / h, 0, 1)
    const size = (big ? 0.8 + r() * 0.45 : 0.36 + d * 0.42 + r() * r() * 0.36) * s
    const a = (big ? 0.9 + r() * 0.1 : 0.45 + r() * 0.55) * (0.65 + d * 0.35)
    // mostly sodium amber and warm white
    const c = pal.city[r() < 0.08 ? 5 : Math.floor(r() * 5)]
    const halo = size * (big ? 5 + r() * 2 : 2.6 + r() * 2.2)
    const g = ctx.createRadialGradient(x, y, 0, x, y, halo)
    g.addColorStop(0, rgba(c, a * (big ? 0.34 : 0.26)))
    g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g
    ctx.fillRect(x - halo, y - halo, halo * 2, halo * 2)
    ctx.fillStyle = rgba(c, a)
    ctx.beginPath()
    ctx.arc(x, y, size, 0, TAU)
    ctx.fill()
  }

  for (let k = 0; k < 2; k++) {
    // a neighbourhood: a faint warm glow over it, its lights spread wider than deep
    const cx = r() * w
    const cy = (0.24 + r() * 0.66) * h
    const sx = (0.05 + r() * 0.07) * w
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, sx * 2.6)
    glow.addColorStop(0, rgba(pal.haze, 0.07))
    glow.addColorStop(1, rgba(pal.haze, 0))
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, 0.42)
    ctx.translate(-cx, -cy)
    ctx.fillStyle = glow
    ctx.fillRect(cx - sx * 2.6, cy - sx * 2.6, sx * 5.2, sx * 5.2)
    ctx.restore()
    const n = 8 + Math.floor(r() * 5)
    for (let i = 0; i < n; i++) light(cx + gauss() * sx * 2, cy + gauss() * sx * 0.7, i === 0 && r() < 0.6)
  }
  {
    // a street running off toward the horizon: lights closer together as it recedes
    const x1 = r() * w
    const y1 = (0.9 + r() * 0.1) * h
    const x2 = x1 + (r() - 0.5) * w * 0.9
    const y2 = (0.18 + r() * 0.22) * h
    const n = 8
    for (let i = 0; i < n; i++) {
      const k = Math.pow((i + r() * 0.3) / n, 0.7)
      light(lerp(x1, x2, k), lerp(y1, y2, k))
    }
  }
  if (highway) {
    // a highway: a long, gentle curve of close sodium lights, the brightest thing down there
    const y1 = (0.3 + r() * 0.5) * h
    const y2 = y1 + (r() - 0.5) * 0.5 * h
    const bow = (r() - 0.5) * 0.3 * h
    const c = pal.city[3]
    for (let k = -0.05; k <= 1.05; k += 0.022 + r() * 0.014) {
      const x = k * w
      const y = lerp(y1, y2, k) + Math.sin(k * Math.PI) * bow + gauss() * 0.6 * s
      const d = clamp(y / h, 0, 1)
      ctx.fillStyle = rgba(c, (0.45 + r() * 0.4) * (0.6 + d * 0.4))
      ctx.beginPath()
      ctx.arc(x, y, (0.3 + d * 0.3) * s, 0, TAU)
      ctx.fill()
    }
  }
  for (let i = 0; i < 5; i++) light(r() * w, (0.2 + r() * 0.8) * h)
}

/** The view: sky, horizon glow, far lights, and the near city drifting away below. Painted once. */
const Night = memo(function Night() {
  const root = useRef<HTMLDivElement>(null)
  const far = useRef<HTMLCanvasElement>(null)
  const city = useRef<(HTMLCanvasElement | null)[]>([])

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    let size = ''
    const paint = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h || `${w}x${h}` === size) return
      size = `${w}x${h}`
      const pal = palette()
      if (far.current) {
        const ctx = fit(far.current, w, h)
        if (ctx) paintFar(ctx, w, h, pal)
      }
      city.current.forEach((c, k) => {
        if (!c) return
        const cw = c.clientWidth
        const ch = c.clientHeight
        const ctx = fit(c, cw, ch)
        if (ctx) paintCity(ctx, cw, ch, 101 + k * 37, pal, k % 2 === 1)
      })
    }
    paint()
    const ro = new ResizeObserver(paint)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={root} className="plane__night" aria-hidden="true">
      <div className="plane__sky" />
      <canvas ref={far} className="plane__far" />
      {Array.from({ length: CITY_GROUPS }, (_, k) => (
        <canvas
          key={k}
          ref={(c) => {
            city.current[k] = c
          }}
          className="plane__city"
          style={{ animationDelay: `${(-k * CITY_CYCLE_S) / CITY_GROUPS}s`, animationDuration: `${CITY_CYCLE_S}s` }}
        />
      ))}
      <span className="plane__beacon" />
    </div>
  )
})

/* ───────────── the glass: fog, drops, and her finger ───────────── */

/**
 * Everything drawn on the pane's canvas, and every way it gets cleared: her
 * finger (a soft round brush, smoothed between pointer samples), the palm
 * sweeps of "Wipe it", and the drop that runs down by itself.
 * A tiny CPU-side copy of the fog (`mask`) gets the same dabs, so counting
 * what is left is a 48 px readback that never waits on the GPU.
 */
class Glass {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  tearEl: HTMLCanvasElement
  mask = document.createElement('canvas')
  mctx: CanvasRenderingContext2D | null
  brush = makeBrush()
  rim = makeRim()
  pal = palette()
  reduce: boolean
  w = 0
  h = 0
  full = 0
  lifted = false
  touched = false
  /** the finger: last raw points (for smoothing), and its own pen (the palm of "Wipe it" has another) */
  pts: Pt[] = []
  pen: Pen = { at: { x: 0, y: 0 }, carry: 0 }
  ticked = 0
  /** how far her finger has wiped in all, in px (breath doesn't count) */
  wiped = 0
  onTick: () => void = () => {}
  /** the running drop, while it is on the glass, and the size of its layer */
  tear: { x: number; y: number; r: number } | null = null
  tearBox = 0
  cried = false
  tearRun: Playback | null = null
  sweepRun: Playback | null = null
  /**
   * Her finger only breathes on the glass (the scene sets this until the drop
   * of "I cried" has run): its trails fog back over and never count. While
   * they do, `base` keeps the fog as it is without them, `mist` holds the
   * trails, and the glass is `base` minus `mist` at `mistK` strength.
   */
  breath = false
  base: CanvasRenderingContext2D | null = null
  mist: CanvasRenderingContext2D | null = null
  misting = false
  /** no memory for those copies: her breath trails simply stay (they still never count) */
  mistless = false
  mistK = 1
  mistAt = 0
  mistRaf = 0

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, tearEl: HTMLCanvasElement, reduce: boolean) {
    this.canvas = canvas
    this.ctx = ctx
    this.tearEl = tearEl
    this.reduce = reduce
    this.mctx = this.mask.getContext('2d', { willReadFrequently: true })
  }

  static create(canvas: HTMLCanvasElement, tearEl: HTMLCanvasElement, reduce: boolean) {
    const ctx = canvas.getContext('2d')
    return ctx ? new Glass(canvas, ctx, tearEl, reduce) : null
  }

  get s() {
    return this.w / UNIT
  }

  /** fit the pane; keeps what she has already wiped */
  resize(w: number, h: number) {
    if (!w || !h || (Math.abs(w - this.w) < 0.5 && Math.abs(h - this.h) < 0.5)) return
    // breath trails still fogging over are let go: the fog as it was is what gets kept
    this.settle()
    const first = !this.w
    const keep = !first && (this.touched || this.cried)
    let old: HTMLCanvasElement | null = null
    if (keep) {
      old = document.createElement('canvas')
      old.width = this.canvas.width
      old.height = this.canvas.height
      old.getContext('2d')?.drawImage(this.canvas, 0, 0)
    }
    this.w = w
    this.h = h
    fit(this.canvas, w, h)

    if (old) {
      this.ctx.drawImage(old, 0, 0, w, h)
      // the counting copy keeps its pixels (resizing a canvas would wipe it): only its scale changes
      this.mctx?.setTransform(this.mask.width / w, 0, 0, this.mask.height / h, 0, 0)
      // a drop that has run would land in the wrong place: let it go; one still waiting for his line moves with the pane
      if (this.cried) this.dropTear()
      else if (this.tear) this.restTear()
      return
    }
    this.mask.width = 48
    this.mask.height = Math.round(48 * (h / w))
    this.mctx?.setTransform(this.mask.width / w, 0, 0, this.mask.height / h, 0, 0)
    this.paint()
    if (this.mctx) {
      this.mctx.globalCompositeOperation = 'source-over'
      this.mctx.clearRect(0, 0, w, h)
      this.mctx.fillStyle = '#000'
      panePath(this.mctx, w, h)
      this.mctx.fill()
      this.full = this.alphaSum()
    }
  }

  /** the fogged pane, as he left it */
  paint() {
    const { ctx, w, h, s, pal } = this
    const r = rng(29)
    ctx.save()
    ctx.clearRect(0, 0, w, h)
    panePath(ctx, w, h)
    ctx.clip()

    // the veil: warm grey in the reading light, thinner up top, heavier where the condensation collects
    ctx.globalCompositeOperation = 'source-over'
    const veil = ctx.createLinearGradient(0, 0, 0, h)
    veil.addColorStop(0, rgba(FOG_TOP, 0.24))
    veil.addColorStop(0.5, rgba(FOG, 0.32))
    veil.addColorStop(1, rgba(FOG_LOW, 0.47))
    ctx.fillStyle = veil
    ctx.fillRect(0, 0, w, h)

    // never even: soft banks of thicker and thinner fog
    for (let i = 0; i < 16; i++) {
      const x = r() * w
      const y = r() * h
      const rad = (0.2 + r() * 0.4) * w
      const thick = r() < 0.55
      const a = 0.03 + r() * 0.07
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
      g.addColorStop(0, thick ? rgba(FOG_BANK, a) : `rgba(0, 0, 0, ${a * 1.6})`)
      g.addColorStop(1, thick ? rgba(FOG_BANK, 0) : 'rgba(0, 0, 0, 0)')
      ctx.globalCompositeOperation = thick ? 'source-over' : 'destination-out'
      ctx.fillStyle = g
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }

    // the cold rim fogs up first
    ctx.globalCompositeOperation = 'source-over'
    const rim = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.6)
    rim.addColorStop(0, rgba(FOG_BANK, 0))
    rim.addColorStop(1, rgba(FOG_BANK, 0.14))
    ctx.fillStyle = rim
    ctx.fillRect(0, 0, w, h)

    // fog scatters what is behind it: the haze on the horizon, the city's glow, its brightest lights
    const hz = HORIZON * h
    const band = ctx.createLinearGradient(0, hz - h * 0.16, 0, hz + h * 0.14)
    band.addColorStop(0, rgba(pal.haze, 0))
    band.addColorStop(0.55, rgba(pal.haze, 0.13))
    band.addColorStop(1, rgba(pal.haze, 0.03))
    ctx.fillStyle = band
    ctx.fillRect(0, hz - h * 0.16, w, h * 0.3)
    const below = ctx.createRadialGradient(w * 0.5, h * 1.08, 0, w * 0.5, h * 1.08, h * 0.52)
    below.addColorStop(0, rgba(pal.haze, 0.13))
    below.addColorStop(1, rgba(pal.haze, 0))
    ctx.fillStyle = below
    ctx.fillRect(0, h * 0.5, w, h * 0.5)
    for (let i = 0; i < 14; i++) {
      const x = r() * w
      const y = hz + (0.04 + r() * 0.38) * h
      const rad = (5 + r() * 10) * s
      // the warm ones only (the odd cold LED is too faint to carry through fog)
      const c = pal.city[Math.floor(r() * r() * (pal.city.length - 1))]
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
      g.addColorStop(0, rgba(c, 0.1 + r() * 0.14))
      g.addColorStop(1, rgba(c, 0))
      ctx.fillStyle = g
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }

    // the reading light above the seat warms the top of the fog
    ctx.globalCompositeOperation = 'source-atop'
    const warm = ctx.createRadialGradient(w * 0.32, -h * 0.08, 0, w * 0.32, -h * 0.08, h * 0.7)
    warm.addColorStop(0, rgba(pal.glint, 0.12))
    warm.addColorStop(1, rgba(pal.glint, 0))
    ctx.fillStyle = warm
    ctx.fillRect(0, 0, w, h)

    // up close, fog is a crowd of tiny droplets
    for (let i = 0; i < 700; i++) {
      const x = r() * w
      const y = r() * h
      const rad = (0.3 + r() * r() * 0.6) * s
      if (r() < 0.55) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
      } else {
        ctx.globalCompositeOperation = 'source-atop'
        ctx.fillStyle = rgba(MIST, 0.12)
      }
      ctx.beginPath()
      ctx.arc(x, y, rad, 0, TAU)
      ctx.fill()
    }

    // the drops: mostly small, a few heavy ones lower down; none on the running drop's path
    const tx = TEAR_X * w
    const ty0 = TEAR[0][1] * h
    const ty1 = TEAR[TEAR.length - 1][1] * h
    const tr = TEAR_R * s
    const drops: { x: number; y: number; r: number }[] = []
    for (let tries = 0; drops.length < 40 && tries < 900; tries++) {
      const u = r()
      const size = u < 0.5 ? 0.9 + r() * 1.3 : u < 0.86 ? 2.2 + r() * 2.2 : 4.6 + r() * 3.4
      const rad = size * s
      const x = r() * w
      const y = Math.pow(r(), 0.75) * h
      if (!inPane(x, y, w, h, rad * 2 + 4 * s)) continue
      if (Math.abs(x - tx) < tr * 3 && y > ty0 - tr * 3 && y < ty1 + tr * 3) continue
      if (drops.some((d) => Math.hypot(d.x - x, d.y - y) < d.r + rad + 3 * s)) continue
      drops.push({ x, y, r: rad })
    }
    // and the beads too small to have shape yet
    for (let tries = 0, n = 0; n < 60 && tries < 600; tries++) {
      const rad = (0.45 + r() * 0.6) * s
      const x = r() * w
      const y = r() * h
      if (!inPane(x, y, w, h, 5 * s)) continue
      if (drops.some((d) => Math.hypot(d.x - x, d.y - y) < d.r + rad + 2 * s)) continue
      drops.push({ x, y, r: rad })
      n++
    }
    for (const d of drops) drawDrop(ctx, d.x, d.y, d.r, true, pal)

    if (this.reduce) {
      // no running: the drop has already run, its trail is on the glass
      const beads = { next: 6 * s, rand: rng(53) }
      let last = { x: tx, y: ty0 }
      for (let y = ty0 + 1; y <= ty1; y += 1) {
        const k = 1 - 0.16 * ((y - ty0) / (ty1 - ty0))
        const p = { x: tearX(tx, y, ty0, s), y }
        this.trail(last, p, tr * k * 0.86, beads)
        last = p
      }
      drawDrop(ctx, last.x, last.y, tr * 0.84, true, pal)
      this.cried = true
    } else {
      // the drop that will run sits on its own layer; the glass under it is clearer
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      dropPath(ctx, tx, ty0, tr * 0.86)
      ctx.fill()
    }
    ctx.restore()
    if (!this.reduce) this.restTear()
  }

  /** the running drop, still at rest where it formed */
  restTear() {
    const { s, w, h } = this
    const r = TEAR_R * s
    const box = Math.ceil(r * 3.2)
    const tctx = fit(this.tearEl, box, box)
    if (!tctx) return
    this.tearEl.style.width = `${box}px`
    this.tearEl.style.height = `${box}px`
    drawDrop(tctx, box / 2, box / 2, r, false, this.pal)
    this.tearBox = box
    this.tear = { x: TEAR_X * w, y: TEAR[0][1] * h, r }
    this.placeTear(this.tear.x, this.tear.y, 1)
    this.tearEl.style.opacity = '1'
  }

  placeTear(x: number, y: number, k: number) {
    const half = this.tearBox / 2
    this.tearEl.style.transform = `translate3d(${(x - half).toFixed(2)}px, ${(y - half).toFixed(2)}px, 0) scale(${k.toFixed(3)})`
  }

  /**
   * The trail of a sliding drop: the glass it ran over comes mostly clear,
   * narrower than the drop and soft at the edges, with a bead left behind
   * every so often (`beads` is the distance to the next one).
   */
  trail(a: Pt, b: Pt, r: number, beads: { next: number; rand: () => number }) {
    const { s, pal } = this
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(dist / 0.7))
    beads.next -= dist
    let bead: [number, number, number] | null = null
    if (beads.next <= 0) {
      beads.next = (9 + beads.rand() * 12) * s
      bead = [a.x + (beads.rand() - 0.5) * r * 0.5, a.y - r * 1.4, (0.5 + beads.rand() * 0.6) * s]
    }
    for (const ctx of this.lasting()) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 0.09
      for (let i = 1; i <= n; i++) {
        const x = lerp(a.x, b.x, i / n)
        const y = lerp(a.y, b.y, i / n)
        // never quite even: water runs a little wider, then narrower
        const rr = r * (0.82 + 0.14 * Math.sin(y / (4.5 * s)) + 0.08 * Math.sin(y / (1.7 * s)))
        ctx.drawImage(this.brush, x - rr, y - rr, rr * 2, rr * 2)
      }
      ctx.globalAlpha = 1
      if (bead) drawDrop(ctx, bead[0], bead[1], bead[2], true, pal)
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  /** where a lasting change is drawn: the glass, and the fog under her breath trails while they fog over */
  lasting() {
    return this.misting && this.base ? [this.ctx, this.base] : [this.ctx]
  }

  /** a dab of breath: it clears the glass for a moment, then fogs back over, and never counts */
  breathe(x: number, y: number, r: number) {
    const { ctx, brush } = this
    const kept = this.misty()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = DAB
    ctx.drawImage(brush, x - r, y - r, r * 2, r * 2)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    if (!kept || !this.mist) return
    this.mist.globalAlpha = DAB
    this.mist.drawImage(brush, x - r, y - r, r * 2, r * 2)
    this.mist.globalAlpha = 1
    this.mistAt = performance.now()
  }

  /** ready for a breath: the fog kept as it is now, or (while it fogs back over) what has come back kept */
  misty() {
    const { canvas } = this
    if (this.misting) {
      if (this.mistK < 1 && this.mist) {
        // she breathes on it again while it fogs over: what has come back stays back
        this.mist.save()
        this.mist.setTransform(1, 0, 0, 1, 0, 0)
        this.mist.globalCompositeOperation = 'destination-out'
        this.mist.globalAlpha = 1 - this.mistK
        this.mist.fillRect(0, 0, canvas.width, canvas.height)
        this.mist.restore()
        this.mistK = 1
        this.show()
      }
      return true
    }
    if (this.mistless) return false
    const layer = (old: CanvasRenderingContext2D | null) => {
      if (old && old.canvas.width === canvas.width && old.canvas.height === canvas.height) return old
      const c = document.createElement('canvas')
      c.width = canvas.width
      c.height = canvas.height
      return c.getContext('2d')
    }
    const base = (this.base = layer(this.base))
    const mist = (this.mist = layer(this.mist))
    if (!base || !mist) {
      this.mistless = true
      return false
    }
    for (const c of [base, mist]) {
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.globalCompositeOperation = 'source-over'
      c.globalAlpha = 1
      c.clearRect(0, 0, canvas.width, canvas.height)
    }
    base.drawImage(canvas, 0, 0)
    // both draw in the glass's CSS px, like the glass itself
    base.setTransform(canvas.width / this.w, 0, 0, canvas.height / this.h, 0, 0)
    mist.setTransform(canvas.width / this.w, 0, 0, canvas.height / this.h, 0, 0)
    this.misting = true
    this.mistK = 1
    this.mistAt = performance.now()
    this.mistRaf = requestAnimationFrame(this.regrow)
    return true
  }

  /** her breath trails stay while she wipes, then fog back over, smoothly */
  regrow = (now: number) => {
    this.mistRaf = 0
    if (!this.misting) return
    const k = 1 - smooth(clamp((now - this.mistAt - MIST_HOLD_MS) / MIST_FADE_MS, 0, 1))
    if (k <= 0) {
      this.settle()
      return
    }
    if (k < 1) {
      this.mistK = k
      this.show()
    }
    this.mistRaf = requestAnimationFrame(this.regrow)
  }

  /** the glass while her breath trails fog over: the fog without them, minus what is left of them */
  show() {
    const { ctx, canvas, base, mist } = this
    if (!base || !mist) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(base.canvas, 0, 0)
    if (this.mistK > 0) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = this.mistK
      ctx.drawImage(mist.canvas, 0, 0)
    }
    ctx.restore()
  }

  /**
   * Her breath stops fogging back (the drop has run): what it has cleared now
   * stays, as she sees it, and counts like any wipe.
   */
  keep() {
    if (!this.misting) return
    const { mist, mctx } = this
    cancelAnimationFrame(this.mistRaf)
    this.mistRaf = 0
    this.show()
    if (mist && mctx && this.mistK > 0) {
      mctx.save()
      mctx.globalCompositeOperation = 'destination-out'
      mctx.globalAlpha = this.mistK
      mctx.drawImage(mist.canvas, 0, 0, this.w, this.h)
      mctx.restore()
    }
    this.misting = false
    this.mistK = 1
  }

  /** her breath trails have fogged over: the glass is the fog it was, exactly */
  settle() {
    if (!this.misting) return
    cancelAnimationFrame(this.mistRaf)
    this.mistRaf = 0
    this.mistK = 0
    this.show()
    this.misting = false
    this.mistK = 1
  }

  /** one dab of her finger, on the glass and on the counting copy */
  dab(x: number, y: number, size: number) {
    const { mctx, brush } = this
    // a finger is never perfectly round or steady
    const r = size * (0.95 + Math.random() * 0.1)
    if (this.breath) {
      this.breathe(x, y, r)
      return
    }
    // the water it pushes aside gathers just outside it, a little lighter
    const rr = r * RIM_SCALE
    for (const ctx of this.lasting()) {
      ctx.globalCompositeOperation = 'source-atop'
      ctx.globalAlpha = 0.035
      ctx.drawImage(this.rim, x - rr, y - rr, rr * 2, rr * 2)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = DAB
      ctx.drawImage(brush, x - r, y - r, r * 2, r * 2)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    if (mctx) {
      mctx.globalCompositeOperation = 'destination-out'
      mctx.globalAlpha = DAB
      mctx.drawImage(brush, x - r, y - r, r * 2, r * 2)
      mctx.globalAlpha = 1
    }
    // wiped over the running drop: it goes with the fog (before it runs, it waits for his line)
    const tear = this.tear
    if (tear && this.cried && Math.hypot(tear.x - x, tear.y - y) < r * 0.8 + tear.r) this.dropTear()
  }

  /** move a pen to `to`, dabbing at even spacing; ticks the haptics every TICK_PX */
  walk(pen: Pen, to: Pt, r: number) {
    const from = pen.at
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.hypot(dx, dy)
    const step = Math.max(1, r * 0.22)
    let done = 0
    while (pen.carry + (dist - done) >= step) {
      done += step - pen.carry
      pen.carry = 0
      this.dab(from.x + (dx * done) / dist, from.y + (dy * done) / dist, r)
    }
    pen.carry += dist - done
    pen.at = to
    if (!this.breath) this.wiped += dist
    this.ticked += dist
    if (this.ticked >= TICK_PX) {
      this.ticked = 0
      this.onTick()
    }
  }

  /** her finger lands: a dab right away, so even a tap leaves a mark */
  begin(p: Pt) {
    this.touched = true
    this.pts = [p]
    this.pen = { at: p, carry: 0 }
    this.dab(p.x, p.y, this.w * BRUSH)
  }

  /** smoothed between samples: a quadratic through the midpoints */
  move(p: Pt) {
    const pts = this.pts
    const last = pts[pts.length - 1]
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.75) return
    pts.push(p)
    if (pts.length > 3) pts.shift()
    const r = this.w * BRUSH
    if (pts.length === 2) {
      this.walk(this.pen, { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }, r)
      return
    }
    const [a, b, c] = pts
    const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }
    const n = Math.max(2, Math.ceil((Math.hypot(b.x - m1.x, b.y - m1.y) + Math.hypot(m2.x - b.x, m2.y - b.y)) / 3))
    for (let i = 1; i <= n; i++) {
      const k = i / n
      const u = 1 - k
      this.walk(this.pen, { x: u * u * m1.x + 2 * u * k * b.x + k * k * m2.x, y: u * u * m1.y + 2 * u * k * b.y + k * k * m2.y }, r)
    }
  }

  end() {
    const last = this.pts[this.pts.length - 1]
    if (last && this.pts.length > 1) this.walk(this.pen, last, this.w * BRUSH)
    this.pts = []
  }

  alphaSum() {
    if (!this.mctx) return 0
    const d = this.mctx.getImageData(0, 0, this.mask.width, this.mask.height).data
    let sum = 0
    for (let i = 3; i < d.length; i += 4) sum += d[i]
    return sum
  }

  /** how much of the glass she has cleared, 0 to 1 */
  cleared() {
    if (!this.full) return 0
    return 1 - this.alphaSum() / this.full
  }

  /** clear enough to lift the rest: 40%, or a little less once she has been at it a while */
  enough() {
    // no counting copy (out of canvas memory): judge by how long she has wiped
    if (!this.mctx) return this.wiped >= WIPE_ENOUGH * this.h
    const share = this.cleared()
    return share >= CLEAR_AT || (this.wiped >= LONG_WIPE * this.h && share >= CLEAR_AT_LONG)
  }

  /** the drop that runs down while he says he cried: slides, catches, slides on, stops (then `ran`); false if none can run */
  cry(ran: () => void) {
    if (this.cried || this.lifted) return false
    // (a drop that was let go of forms again where it starts: this line always has its drop)
    if (!this.tear) this.restTear()
    if (!this.tear) return false
    this.cried = true
    const { s, h } = this
    const r0 = this.tear.r
    const x0 = this.tear.x
    const y0 = this.tear.y
    const end = TEAR[TEAR.length - 1][0]
    const beads = { next: 6 * s, rand: rng(53) }
    let last = { x: x0, y: y0 }
    this.tearRun = animate(0, end, {
      duration: end,
      ease: 'linear',
      onUpdate: (time) => {
        const tear = this.tear
        if (!tear) return
        const y = tearAt(time) * h
        const x = tearX(x0, y, y0, s)
        // it leaves some of itself on the way down
        const k = 1 - 0.16 * clamp((y - y0) / (TEAR[TEAR.length - 1][1] * h - y0), 0, 1)
        const p = { x, y }
        if (y - last.y > 0.3) {
          this.trail(last, p, r0 * k * 0.86, beads)
          last = p
        }
        tear.x = x
        tear.y = y
        tear.r = r0 * k
        this.placeTear(x, y, k)
      },
      onComplete: () => {
        this.tearRun = null
        ran()
      },
    })
    return true
  }

  /** the running drop is wiped away (or the fog lifts): it goes with the fog */
  dropTear() {
    this.tearRun?.stop()
    this.tearRun = null
    if (!this.tear) return
    this.tear = null
    this.tearEl.style.opacity = '0'
  }

  /** "Wipe it": four sweeps of a palm across the glass, top to bottom */
  sweep(onSweep: () => void, done: () => void) {
    if (this.lifted || this.sweepRun || !this.w) return false
    const { w, h } = this
    const r = w * PALM
    const arcs = SWEEPS.map(([x1, y1, x2, y2, bow]) => ({
      a: { x: x1 * w, y: y1 * h },
      c: { x: ((x1 + x2) / 2) * w, y: ((y1 + y2) / 2 - bow) * h },
      b: { x: x2 * w, y: y2 * h },
    }))
    this.touched = true
    // the palm has its own pen: a finger on the glass meanwhile never pulls it off its course
    const pen: Pen = { at: arcs[0].a, carry: 0 }
    let at = -1
    this.sweepRun = animate(0, arcs.length, {
      duration: SWEEP_S * arcs.length,
      ease: 'linear',
      onUpdate: (v) => {
        const k = Math.min(arcs.length - 1, Math.floor(v))
        if (k !== at) {
          at = k
          onSweep()
        }
        const q = easeInOut(clamp(v - k, 0, 1))
        const { a, c, b } = arcs[k]
        const u = 1 - q
        this.walk(pen, { x: u * u * a.x + 2 * u * q * c.x + q * q * b.x, y: u * u * a.y + 2 * u * q * c.y + q * q * b.y }, r)
      },
      onComplete: () => {
        this.sweepRun = null
        done()
      },
    })
    return true
  }

  /** the rest of the fog lifts (the canvas, and the running drop with it, fade out in CSS) */
  lift() {
    if (this.lifted) return
    this.lifted = true
    this.sweepRun?.stop()
    this.sweepRun = null
    this.tearRun?.stop()
    this.tearRun = null
    // breath trails still fogging over go with the rest, as they are
    cancelAnimationFrame(this.mistRaf)
    this.mistRaf = 0
    this.misting = false
  }

  dispose() {
    this.tearRun?.stop()
    this.sweepRun?.stop()
    cancelAnimationFrame(this.mistRaf)
    this.misting = false
  }
}

/* ───────────── the scene ───────────── */

/** Scene 5: Saturday, the flight back. The window is fogged up; she wipes it, and he thanks her. */
export default function Plane() {
  const reduce = !!useReducedMotion()
  // she cleared the window before he asked: where "Thanks" goes in his story (see beatsFor)
  const [early, setEarly] = useState<Early | null>(null)
  const beats = useMemo(() => beatsFor(early, reduce), [early, reduce])
  const end = beats[beats.length - 1].id ?? END
  const seq = useSequence(beats)
  const [clear, setClear] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  // she has started wiping since he asked: the fallback keeps out of her way
  const [engaged, setEngaged] = useState(false)
  // ...and stopped before the glass was clear: the fallback comes now
  const [missed, setMissed] = useState(false)
  const windowRef = useRef<HTMLDivElement>(null)
  /** her last input was a key: when "Wipe it" goes away under it, the focus is handed to the window */
  const keyed = useRef(false)
  const paneRef = useRef<HTMLDivElement>(null)
  const fogRef = useRef<HTMLCanvasElement>(null)
  const tearRef = useRef<HTMLCanvasElement>(null)
  const glass = useRef<Glass | null>(null)
  const finger = useRef<{ id: number; rect: DOMRect } | null>(null)
  const countedAt = useRef(0)
  const clearedAt = useRef(0)
  const reduceAtStart = useRef(reduce)
  const missTimer = useRef(0)
  const askedAt = useRef(0)
  /** after an early clear, when the line on screen will have been up HEARD_MS ("Thanks" waits for it) */
  const heardAt = useRef(0)

  // the score's two moments here ('cried', 'clear'): each marked once, and only while
  // she is watching this scene (a timer can still fire while it dissolves away)
  const sound = useSound()
  const present = useIsPresent()
  const score = useRef({ sound, present, marked: [] as Cue[] })
  useLayoutEffect(() => {
    score.current.sound = sound
    score.current.present = present
  }, [sound, present])
  const mark = useCallback((name: Cue) => {
    const s = score.current
    if (!s.present || s.marked.includes(name)) return
    s.marked.push(name)
    s.sound.cue(name)
  }, [])

  /** enough of the glass is clear: the rest of the fog lifts */
  const lift = useCallback(() => {
    const g = glass.current
    if (g?.lifted) return
    g?.lift()
    finger.current = null
    window.clearTimeout(missTimer.current)
    clearedAt.current = performance.now()
    haptic(10)
    setSweeping(false)
    setClear(true)
    mark('clear')
  }, [mark])

  useEffect(() => () => window.clearTimeout(missTimer.current), [])

  const count = useCallback(() => {
    const g = glass.current
    // nothing lifts before the drop of "I cried" has run: "Thanks" never comes first, nor cuts it short
    if (!g || g.lifted || g.breath) return
    countedAt.current = performance.now()
    if (g.enough()) lift()
  }, [lift])

  // the glass: fog and drops drawn once, kept to the pane's size (rotation, in-app browser bars)
  useLayoutEffect(() => {
    const pane = paneRef.current
    const fog = fogRef.current
    const tear = tearRef.current
    if (!pane || !fog || !tear) return
    const g = Glass.create(fog, tear, reduceAtStart.current)
    if (!g) {
      // no canvas: there is no fog to wipe, the window is simply clear
      setClear(true)
      return
    }
    g.onTick = () => haptic(6)
    glass.current = g
    const size = () => g.resize(pane.clientWidth, pane.clientHeight)
    size()
    const ro = new ResizeObserver(size)
    ro.observe(pane)
    return () => {
      ro.disconnect()
      g.dispose()
      glass.current = null
    }
  }, [])

  // while he says he cried, a drop runs down the glass
  const crying = seq.reached('cried')
  const atPrompt = seq.at('prompt')
  // the drop has run (or none can): from here her finger wipes for real
  const [dropRan, setDropRan] = useState(false)
  // Until then her finger only breathes on the glass: what it clears fogs back over and nothing
  // lifts, so a wipe never cuts "I cried" short. Once she has tapped past that line it wipes for
  // real. With reduced motion nothing runs: the glass opens on the line.
  const breath = !crying || (!reduce && !dropRan && seq.at('cried'))
  /** the glass has just opened: count it once */
  const opened = useRef(false)
  useLayoutEffect(() => {
    const g = glass.current
    if (!g) return
    const was = g.breath
    g.breath = breath
    if (!was || breath || reduce) return
    // the drop has run: what her breath has cleared stays (before the prompt can check it, below)
    g.keep()
    opened.current = true
  }, [breath, reduce])
  // ...and a glass she has already cleared lifts now, so "Thanks" follows the drop
  // (counted after the sequence has started the clock of a line that has just come up)
  useEffect(() => {
    if (!opened.current) return
    opened.current = false
    count()
  }, [breath, count])
  useEffect(() => {
    if (!crying) return
    // with reduced motion nothing runs: the moment is the line itself
    if (reduce) {
      mark('cried')
      return
    }
    const run = window.setTimeout(() => {
      if (!glass.current?.cry(() => setDropRan(true))) setDropRan(true)
      mark('cried')
    }, CRY_DELAY_MS)
    // a drop let go of on its way (the pane was resized) never stops: the glass opens when it would have
    const opens = window.setTimeout(() => setDropRan(true), CRY_END_MS)
    return () => {
      window.clearTimeout(run)
      window.clearTimeout(opens)
    }
  }, [crying, reduce, mark])

  const thanked = seq.reached('after')
  const ended = seq.reached(end)
  const { jump, i, elapsed } = seq

  // she cleared it before he asked: the moment the fog lifts, "Thanks" goes in right after the line
  // on screen (so a line moving on by itself lands on it), and never before "I cried"; a line that
  // has only just been cued (not even faded in) simply waits until after "Thanks". Decided here,
  // before the next paint, so no other line slips in first.
  useLayoutEffect(() => {
    if (!clear || thanked || atPrompt || early != null || !glass.current) return
    const shown = elapsed()
    // (read now: the new order restarts the line's clock)
    heardAt.current = performance.now() + Math.max(0, HEARD_MS - shown)
    setEarly({ at: Math.max(shown < FRESH_MS ? i : i + 1, CRIED_AT + 1) })
  }, [clear, thanked, atPrompt, early, i, elapsed])

  // the held "I cried" ends with enough of the glass already clear (she was wiping as it ended):
  // he thanks her there and then, and never asks (decided before the prompt is ever painted)
  useLayoutEffect(() => {
    const g = glass.current
    if (!atPrompt || early != null || !g || g.lifted || g.breath || !g.enough()) return
    setEarly({ at: i })
    lift()
  }, [atPrompt, early, i, lift])

  // cleared: he thanks her within a breath, wherever he was (a new order brings a new `jump`),
  // and never before the line on screen has been up long enough to read
  useEffect(() => {
    if (!clear || thanked || (!atPrompt && early == null)) return
    const now = performance.now()
    const wait = Math.max(0, THANKS_AFTER_MS - (now - clearedAt.current), atPrompt ? 0 : heardAt.current - now)
    const id = window.setTimeout(() => jump('after'), wait)
    return () => window.clearTimeout(id)
  }, [clear, thanked, atPrompt, early, jump])

  /** "Wipe it", Enter or Space: a few sweeps of a palm, then the rest lifts (once it can be wiped for real) */
  const wipeForHer = () => {
    const g = glass.current
    if (!g || g.lifted || g.breath || sweeping) return
    // "Wipe it" goes away as it starts: under the keyboard, the focus moves onto the window, which
    // stays focusable once clear, so she keeps her place
    if (keyed.current && document.activeElement?.closest('.bar')) windowRef.current?.focus({ preventScroll: true })
    if (reduce) {
      lift()
      return
    }
    if (g.sweep(() => haptic(6), lift)) setSweeping(true)
  }

  const live = !clear
  // the window is a button (Tab, Enter) once it can be wiped for real; before, a finger only breathes on it.
  // Once clear it keeps tabIndex -1 without the role, so a focus on it stays put.
  const ready = live && !breath

  // he has asked her to wipe it and it isn't clear yet: the fallback may come (late, so she tries first)
  const asking = atPrompt && live && !sweeping
  useEffect(() => {
    if (asking) askedAt.current = performance.now()
  }, [asking])

  /** her finger is on the glass: while she wipes, the fallback stays away (unless it is already showing) */
  const engage = () => {
    if (asking && !engaged && !missed && performance.now() - askedAt.current < LATE_MS) setEngaged(true)
  }

  /** a pointer position in the glass's own px (right even if something up the tree is scaled) */
  const local = (rect: DOMRect, e: { clientX: number; clientY: number }): Pt => {
    const g = glass.current
    const kx = g && rect.width ? g.w / rect.width : 1
    const ky = g && rect.height ? g.h / rect.height : 1
    return { x: (e.clientX - rect.left) * kx, y: (e.clientY - rect.top) * ky }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const g = glass.current
    const pane = paneRef.current
    if (!g || !pane || g.lifted || finger.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the pointer is already gone */
    }
    const rect = pane.getBoundingClientRect()
    finger.current = { id: e.pointerId, rect }
    window.clearTimeout(missTimer.current)
    engage()
    g.begin(local(rect, e))
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const f = finger.current
    const g = glass.current
    if (!f || !g || f.id !== e.pointerId || g.lifted) return
    // (her finger may have been down since before he asked)
    engage()
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? []
    for (const s of samples.length ? samples : [e.nativeEvent]) g.move(local(f.rect, s))
    if (performance.now() - countedAt.current >= COUNT_MS) count()
  }

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const f = finger.current
    if (!f || f.id !== e.pointerId) return
    finger.current = null
    glass.current?.end()
    count()
    // she let go before it was clear: if nothing more happens, she gets the fallback
    if (atPrompt && !missed && !glass.current?.lifted) {
      window.clearTimeout(missTimer.current)
      missTimer.current = window.setTimeout(() => setMissed(true), MISS_MS)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (!e.repeat) wipeForHer()
  }

  return (
    <section
      className="scene plane"
      aria-label={SCENE_LABEL}
      onKeyDownCapture={() => {
        keyed.current = true
      }}
      onPointerDownCapture={() => {
        keyed.current = false
      }}
    >
      <div className="scene__picture">
        {/* the shared frame, empty: it only puts the window where the photos sit */}
        <div className="frame plane__frame">
          <div
            ref={windowRef}
            className="plane__window"
            style={WINDOW_STYLE}
            data-live={live || undefined}
            role={ready ? 'button' : undefined}
            tabIndex={ready ? 0 : -1}
            aria-label={ready ? t.prompt : undefined}
            onPointerDown={live ? onPointerDown : undefined}
            onPointerMove={live ? onPointerMove : undefined}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onLostPointerCapture={onPointerEnd}
            onKeyDown={ready ? onKeyDown : undefined}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div ref={paneRef} className="plane__pane">
              <Night />
              <span className="plane__sheen" aria-hidden="true" />
              <div className={`plane__fog${clear ? ' is-lifted' : ''}`} aria-hidden="true">
                <canvas ref={fogRef} className="plane__glass" />
                <canvas ref={tearRef} className="plane__tear" />
              </div>
              {HER_MESSAGE !== '' && clear ? (
                <motion.p
                  className="plane__message"
                  aria-hidden={!ended}
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: ended ? 1 : 0,
                    transition: ended
                      ? { duration: reduce ? 0.6 : 1.8, delay: MESSAGE_DELAY_S, ease: ease.film }
                      : { duration: 0.3 },
                  }}
                >
                  {HER_MESSAGE}
                </motion.p>
              ) : null}
              <span className="plane__rim" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>

      <Subtitles seq={seq} />

      <Controls
        action={
          asking && (!engaged || missed) ? { label: t.action, onClick: wipeForHer, late: true, missed } : null
        }
        showNext={ended}
      />
    </section>
  )
}
