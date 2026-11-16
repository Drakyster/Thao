import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { copy, readingMs } from '../content'
import { Controls } from '../film/Controls'
import { Fireflies, type ClearZone, type FieldPoint } from '../film/Fireflies'
import { Lamp } from '../film/Lamp'
import { useWarmUp } from '../film/useWarmUp'
import { useSequence, type Beat } from '../film/sequence'
import { useSound, type Cue } from '../film/sound'
import { useStage } from '../film/stage'
import { Subtitles } from '../film/Subtitles'
import { useSideways } from '../film/useSideways'
import { ease } from '../lib/feel'
import { umbrella } from '../photos'
import './samelight.css'

const t = copy.light

/** Screen-reader name of the scene. Not in content.ts yet (see the scene report). */
const SCENE_LABEL = 'The same light'

const { x: BX, y: BY } = umbrella.bulb
const pct = (n: number) => `${+(n * 100).toFixed(3)}%`

/** The lamp from the opening hangs exactly where the bulb under their umbrella was (Glued ends on it). */
const BULB: CSSProperties = { left: pct(BX), top: pct(BY) }

/** the cold ember's box overhangs the frame by 30% on every side (samelight.css) */
const EMBER_SPILL = 0.3
const EMBER_BOX = 1 + 2 * EMBER_SPILL
const FRAME_VARS = {
  '--ember-at': `${pct((BX + EMBER_SPILL) / EMBER_BOX)} ${pct((BY + EMBER_SPILL) / EMBER_BOX)}`,
} as CSSProperties

/** The face that sets "Anh yêu em." (the ê must never flash in a fallback font). */
const CARD_FONT = 'italic 300 64px "Newsreader Variable"'
const FONT_TIMEOUT_MS = 2500
/** Black between the hard cut and the card: long enough to feel the dark. */
const BLACK_MS = 1400
/** the flare's peak: a bulb flaring, never a white-out */
const FLARE = 0.7
/** how far a line rises as it comes up (px) */
const RISE = 12

/**
 * Where his words go, for the fireflies to keep out of: round the middle of the picture, as wide as a
 * line can be (samelight.css: 16ch of clamp(1.9rem, 7.6vw, 3rem), about 9 times the type's size) and
 * two lines tall, with some air.
 */
function wordsZone(): ClearZone {
  const say = Math.min(48, Math.max(30.4, window.innerWidth * 0.076))
  return { halfW: 4.6 * say + 24, halfH: 1.25 * say + 28 }
}

/** a star glint at "I love you.": where (CSS), how big (px), one twinkle (s), its first one (s) */
type Glint = { x: string; y: string; size: number; every: number; at: number }

/** round the words (in their line's box); every twinkle its own length, so they never fall in step */
const WORD_GLINTS: Glint[] = [
  { x: '-5%', y: '10%', size: 10, every: 1.7, at: 0.9 },
  { x: '104%', y: '36%', size: 12, every: 2.1, at: 1.5 },
  { x: '79%', y: '112%', size: 8, every: 1.35, at: 0.6 },
  { x: '33%', y: '-16%', size: 7, every: 1.9, at: 2.05 },
]

/** by the bulb (px from it), where its light catches the lens */
const LAMP_GLINTS: Glint[] = [
  { dx: -36, dy: 30, size: 9, every: 1.55, at: 1.1 },
  { dx: 30, dy: 22, size: 11, every: 2.2, at: 0.4 },
  { dx: -46, dy: -6, size: 7, every: 1.2, at: 1.75 },
].map(({ dx, dy, ...g }) => ({ ...g, x: `calc(${pct(BX)} + ${dx}px)`, y: `calc(${pct(BY)} + ${dy}px)` }))

function Glints({ list }: { list: Glint[] }) {
  return list.map((g, k) => (
    <span
      key={k}
      className="samelight__glint"
      aria-hidden="true"
      style={{ '--x': g.x, '--y': g.y, '--s': `${g.size}px`, '--d': `${g.every}s`, '--at': `${g.at}s` } as CSSProperties}
    />
  ))
}

/** the last two words stay together (a no-break space), so no line ever ends on one word (as Subtitles does) */
const keepLastTwo = (text: string) => text.replace(/ (?=\S+$)/, '\u00a0')

const lastLine = t.lines.length - 1

const BEATS: Beat[] = [
  { id: 'hold', prompt: t.prompt, wait: 'gesture' },
  { id: 'keep', prompt: copy.lights.keepHolding, wait: 'gesture' },
  // silence while the café comes back on around the bulb and the fireflies come out
  { id: 'reveal', ms: 3000 },
  ...t.lines.flatMap((say, k): Beat[] => {
    if (k === lastLine) {
      return [
        // the room holds its breath (the light dips, the bar steps aside)
        { id: 'hush', ms: 900 },
        { id: 'love', say, vow: true, minMs: 2500, ms: Math.max(4000, readingMs(say)) },
      ]
    }
    if (k === 0) return [{ id: 'name', say, vow: true, minMs: 1500, ms: Math.max(2400, readingMs(say)) }]
    return [{ say }]
  }),
  // hard cut to black; the scene moves on once the black has held and the card's font is in
  { id: 'cut', wait: 'gesture' },
  { id: 'card', ms: 3000 },
  ...(t.accents ? [{ id: 'accents', ms: 1600 } satisfies Beat] : []),
  { id: 'end', wait: 'end' },
]

let cardFont: Promise<unknown> | undefined
/** Starts loading the card's italic once (on mount), so it is long ready by the end. */
function loadCardFont() {
  cardFont ??= (document.fonts?.load(CARD_FONT, t.card) ?? Promise.resolve()).catch(() => undefined)
  return cardFont
}

const sleep = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms))

/** whether she is looking at the page at all (not in another app) */
const onVisibility = (change: () => void) => {
  document.addEventListener('visibilitychange', change)
  return () => document.removeEventListener('visibilitychange', change)
}
const pageVisible = () => document.visibilityState !== 'hidden'

/**
 * Marks one moment of the peak for the score, once, in the very commit that
 * shows it (a layout effect runs before that frame is painted). A scene that
 * is already leaving marks nothing: she is watching the next one.
 */
function useCueOnce(name: Cue, now: boolean) {
  const sound = useSound()
  const present = useIsPresent()
  const done = useRef(false)
  useLayoutEffect(() => {
    if (!now || !present || done.current) return
    done.current = true
    sound.cue(name)
  }, [name, now, present, sound])
}

/**
 * One side of her taps while he speaks, with Subtitles' own rules (the lines
 * are not in the subtitle row here). If it goes (the hush, the cut) while the
 * keyboard is on it, the keyboard goes back to the picture, never to the page:
 * the cleanup runs before the button leaves the page.
 */
function Tap({
  side,
  label,
  onTap,
  home,
}: {
  side: 'prev' | 'next'
  label: string
  onTap: () => void
  home: () => HTMLElement | null
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    return () => {
      if (el && el === document.activeElement) home()?.focus({ preventScroll: true })
    }
  }, [home])
  return <button ref={ref} type="button" className={`samelight__tap samelight__tap--${side}`} aria-label={label} onClick={onTap} />
}

/**
 * Scene 7, the peak: the lamp from the opening comes back where the bulb under
 * their umbrella was, and she switches it on again. This time it stays on: the
 * café comes back around it, fireflies come out, and he says it plainly, line
 * by line, big in the middle of the room. Then a hard cut, and "Anh yêu em."
 *
 * No fade here relies on the scene's own mount animation: things stay mounted
 * with `initial={false}` and state-driven `animate`, or are driven from
 * effects and CSS classes.
 */
export default function SameLight() {
  const reduce = useReducedMotion()
  const stage = useStage()
  // Glued ends on this very bulb and the cut is instant: the lamp is already there
  const [fromGlued] = useState(() => stage.from === 'glued')
  const seq = useSequence(BEATS)
  const lamp = useWarmUp({ onLit: () => seq.jump('reveal') })
  const lampOpacity = useMotionValue(fromGlued ? 1 : 0)
  /** she used the fallback: the lamp warms by itself, so the prompt to hold it steps aside */
  const [played, setPlayed] = useState(false)

  const lit = lamp.state === 'lit'
  const hushed = seq.reached('hush')
  const love = seq.reached('love')
  const cut = seq.reached('cut')
  const atCut = seq.at('cut')
  const card = seq.reached('card')
  const accents = seq.reached('accents')
  const end = seq.reached('end')
  const next = seq.next
  const sideways = useSideways()
  const visible = useSyncExternalStore(onVisibility, pageVisible, () => true)

  // his lines, from "Thao." to "I love you.": big in the middle of the room, not in the subtitle row
  const speaking = lit && seq.reached('name') && !cut
  const beat = seq.beat
  const said = speaking ? beat?.say : undefined
  const isLove = beat?.id === 'love'
  const tappable = !!said && beat?.wait !== 'gesture' && beat?.wait !== 'end'

  // the score's three moments here: the bulb lights (her hold or the fallback),
  // the hard cut to black, and "Anh yêu em." starting to come up
  useCueOnce('lit', lit)
  useCueOnce('cut', cut)
  useCueOnce('card', card)

  // fetch the card's font while she looks at the dark
  useEffect(() => {
    loadCardFont()
  }, [])

  // the lamp comes up out of the black (coming from Glued, it is already there); lit, it stays, full
  useEffect(() => {
    if (lit) {
      const on = animate(lampOpacity, 1, { duration: 0.3, ease: ease.film })
      return () => on.stop()
    }
    if (fromGlued) return
    const up = animate(lampOpacity, 1, { duration: 1.2, delay: 0.6, ease: ease.film })
    return () => up.stop()
  }, [lit, lampOpacity, fromGlued])

  // an early release teaches the gesture again
  useEffect(() => {
    if (lamp.hint && seq.at('hold')) seq.jump('keep')
  }, [lamp.hint, seq])

  // the hard cut: hold the black, and only bring the card up once its font is in. She must see it
  // come up: while she is in another app or the phone is on its side the black waits, then starts over
  useEffect(() => {
    if (!atCut || sideways || !visible) return
    let live = true
    const fontOrGiveUp = Promise.race([loadCardFont(), sleep(FONT_TIMEOUT_MS)])
    Promise.all([sleep(BLACK_MS), fontOrGiveUp]).then(() => {
      if (live) next()
    })
    return () => {
      live = false
    }
  }, [atCut, next, sideways, visible])

  // where the lamp hangs in the picture, for the fireflies that come out round it, and where his words go
  const picture = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<{ near: FieldPoint; clear: ClearZone } | null>(null)
  useLayoutEffect(() => {
    const field = picture.current
    if (!field) return
    const measure = () => {
      const f = frame.current?.getBoundingClientRect()
      const p = field.getBoundingClientRect()
      if (!f || !p.width || !p.height) return
      const x = +((f.left + BX * f.width - p.left) / p.width).toFixed(4)
      const y = +((f.top + BY * f.height - p.top) / p.height).toFixed(4)
      const clear = wordsZone()
      setRoom((was) =>
        was && was.near.x === x && was.near.y === y && was.clear.halfW === clear.halfW && was.clear.halfH === clear.halfH
          ? was
          : { near: { x, y }, clear },
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(field)
    return () => watch.disconnect()
  }, [])
  const home = useCallback(() => picture.current, [])

  // until it is lit, the whole picture is the light switch (useWarmUp captures the finger, leaves the
  // outer 24px to the phone's back swipe, and only her own release counts as letting go); once lit it is
  // no longer a control but stays focusable (-1), so a keyboard user's focus never drops to the page
  const hold = !lit
  const holdProps = hold ? { role: 'button', tabIndex: 0, 'aria-label': t.prompt, ...lamp.bind } : { tabIndex: -1 }

  return (
    <section className={`scene samelight${cut ? ' is-cut' : ''}`} aria-label={SCENE_LABEL}>
      <div ref={picture} className={`scene__picture samelight__stage${hold ? ' is-holdable' : ''}`} {...holdProps}>
        {/* everything of the lit room goes at once on the cut, in the same frame (the café goes dark with it) */}
        {!cut ? (
          <>
            {/* the bulb's light on the room behind his words */}
            <div
              className={`samelight__pool${lit ? ' is-on' : ''}${hushed && !love ? ' is-hushed' : ''}${love ? ' is-love' : ''}`}
              aria-hidden="true"
            />

            {/* the shared frame, empty and invisible: the lamp hangs on it where the umbrella's bulb was */}
            <div
              ref={frame}
              className={`frame samelight__frame${lit ? ' is-lit' : ''}${hushed ? ' is-hushed' : ''}`}
              style={FRAME_VARS}
            >
              {/* straight from Glued, its socket and wire fade in after the cut (samelight.css) */}
              <motion.div
                className={`samelight__lamp${fromGlued ? ' is-from-glued' : ''}`}
                style={{ ...BULB, opacity: lampOpacity }}
              >
                <Lamp heat={lamp.heat} />
                {hold && lamp.state === 'cold' ? <span className="samelight__breath" aria-hidden="true" /> : null}
              </motion.div>

              {/* lit, the bulb blooms on the dark, after one short flare; at "I love you." its light catches the lens */}
              <div className="samelight__over" aria-hidden="true">
                <span className="samelight__bulb" style={BULB} />
                <motion.span
                  className="samelight__flare"
                  style={BULB}
                  initial={false}
                  animate={
                    lit
                      ? { opacity: [0, reduce ? FLARE * 0.7 : FLARE, 0], scale: reduce ? 1 : [0.5, 1, 1.12] }
                      : { opacity: 0 }
                  }
                  transition={
                    lit
                      ? { duration: 0.9, delay: reduce ? 0.1 : 0.02, times: [0, 0.2, 1], ease: ['easeOut', 'easeIn'] }
                      : { duration: 0 }
                  }
                />
                {love ? (
                  <motion.div
                    className="samelight__sparks"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 1.2, ease: ease.film }}
                  >
                    <Glints list={LAMP_GLINTS} />
                  </motion.div>
                ) : null}
              </div>
            </div>

            {lit && room ? <Fireflies near={room.near} clear={room.clear} slow={hushed} /> : null}

            <div className="samelight__words" aria-live="polite" aria-atomic="true">
              <AnimatePresence mode="wait" initial={false}>
                {said ? (
                  <motion.p
                    key={`${seq.i}:${said}`}
                    className={`samelight__line${beat?.vow ? ' is-vow' : ''}${isLove ? ' is-love' : ''}`}
                    data-beat={beat?.id}
                    lang={beat?.lang}
                    initial={{ opacity: 0, y: reduce ? 0 : RISE }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.9, ease: ease.film } }}
                    exit={{ opacity: 0, transition: { duration: 0.35, ease: 'easeIn' } }}
                  >
                    {isLove ? (
                      <span className="samelight__swell" aria-hidden="true">
                        {keepLastTwo(said)}
                      </span>
                    ) : null}
                    <span className="samelight__say">{keepLastTwo(said)}</span>
                    {/* a quiet "tap for more", once she has had a second to read (never after a vow) */}
                    {tappable && !beat?.vow ? <span className="samelight__more" aria-hidden="true" /> : null}
                    {isLove ? <Glints list={WORD_GLINTS} /> : null}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
          </>
        ) : null}

        {/* the title card: mounted (hidden) from the start so its fade always plays */}
        <div className={`samelight__title${card ? ' is-on' : ''}`} aria-live="polite">
          <div className="samelight__card-wrap">
            <motion.h2
              className="samelight__card title-serif"
              lang="vi"
              hidden={!card}
              initial={false}
              animate={{
                opacity: card ? 1 : 0,
                // tracking eases in as it fades up (the trailing space is pulled back so it stays centred)
                letterSpacing: card || reduce ? '0.02em' : '0.06em',
                marginRight: card || reduce ? '-0.02em' : '-0.06em',
              }}
              transition={{
                opacity: { duration: 1.2, ease: ease.film },
                letterSpacing: { duration: 2.4, ease: ease.out },
                marginRight: { duration: 2.4, ease: ease.out },
              }}
            >
              {t.card}
            </motion.h2>
            {t.accents ? (
              <motion.p
                className="samelight__accents"
                hidden={!accents}
                initial={false}
                animate={{ opacity: accents ? 1 : 0 }}
                transition={{ duration: 1.1, ease: ease.film }}
              >
                {t.accents}
              </motion.p>
            ) : null}
          </div>
        </div>
      </div>

      {/* while he speaks: a tap on the right goes on, on the left reads the line again (as in the subtitle row) */}
      {speaking ? (
        <div className="samelight__taps">
          {seq.canPrev ? <Tap side="prev" label="Previous line" onTap={seq.prev} home={home} /> : null}
          {tappable ? <Tap side="next" label="Next line" onTap={seq.tapNext} home={home} /> : null}
        </div>
      ) : null}

      {/* the subtitle row keeps her prompts; his lines are in the middle of the room */}
      <Subtitles seq={seq} hidden={cut || (played && hold) || seq.reached('name')} />

      {/*
        The fallback waits (late) so she tries the lamp first, comes at once
        after a release that didn't light it (missed), and steps aside while
        the lamp is warming under her finger. Nothing sits beside "I love you."
        or "Anh yêu em.": the bar steps aside from the hush until the end.
      */}
      <Controls
        hidden={hushed && !end}
        action={
          hold && lamp.state !== 'warming'
            ? {
                label: t.action,
                onClick: () => {
                  setPlayed(true)
                  lamp.play()
                },
                late: true,
                missed: lamp.missed,
              }
            : null
        }
        showNext={end}
        nextLabel={t.rollCredits}
      />
    </section>
  )
}
