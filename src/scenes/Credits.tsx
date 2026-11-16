import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import { config, copy } from '../content'
import { Controls } from '../film/Controls'
import { useSequence, type Beat } from '../film/sequence'
import { useSound } from '../film/sound'
import { useStage } from '../film/stage'
import { Subtitles } from '../film/Subtitles'
import { useSideways } from '../film/useSideways'
import { ease, haptic } from '../lib/feel'
import { preload, umbrella } from '../photos'
import './credits.css'

const t = copy.credits

/* Strings content.ts does not have yet (candidates to move into copy.credits). */
/** what "Wink back" puts on her clipboard: the wink from its own label */
const WINK = ';)'
/** replaces t.copied when the browser refuses the clipboard: never claim a copy that did not happen */
/** screen-reader names */
const SCENE_LABEL = 'Credits'
const PAUSE_LABEL = 'Pause the credits'
const PLAY_LABEL = 'Play the credits'
const KEEP_LABEL = 'Hide everything but the poster for a few seconds, for a screenshot'

/** roll speed (px/s): brisk, like real end credits; a tap pauses it to read */
const SPEED = 88
/** the roll's last stretch (px) eases to a stop, with the last line centred */
const SETTLE = 64
/** how long that last line holds before the poster comes up */
const HOLD_MS = 2200
/** reduced motion, the credits standing still: once she has scrolled their last line into full view, it stays this long, then holds */
const LAST_MS = 4000
/** ...and if she doesn't, they stand this long after her last scroll or her arrival (about the roll's own length on a phone) */
const STILL_MS = 22000

/** the keepsake: "Screenshot now." for this long, then the poster alone for CLEAN_MS */
const CUE_MS = 1000
const CLEAN_MS = 4000
/** a tap this soon after the one on the poster belongs to it (a double tap), not "bring it all back" */
const BACK_GUARD_MS = 600
/**
 * Keys that take a screenshot, or start one (Cmd+Shift+4, Win+Shift+S,
 * PrtScn, a phone's side and volume buttons): they never bring the UI back
 * into the picture she is keeping.
 */
const SCREENSHOT_KEYS = new Set([
  'Meta',
  'OS',
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Fn',
  'PrintScreen',
  'Power',
  'AudioVolumeUp',
  'AudioVolumeDown',
])

/** the O's wink: it shuts fast and opens a touch slower */
const WINK_MS = 220

type Phase = 'roll' | 'hold' | 'poster'
type Reply = 'idle' | 'copied' | 'manual'
/** after a tap on the poster: 'cue' says "Screenshot now.", 'clean' leaves the poster alone */
type Keep = 'idle' | 'cue' | 'clean'

/** Silent while the credits roll; his one line comes under the poster once it is up. */
function beatsFor(reply: Reply): Beat[] {
  return [
    { id: 'roll', wait: 'gesture' },
    // a breath of poster before he speaks
    { id: 'poster', ms: 2300 },
    {
      id: 'turn',
      say: reply === 'copied' ? t.copied : reply === 'manual' ? t.copyThis : t.yourTurn,
      wait: 'end',
    },
  ]
}

/** Scene 8: the credits roll, then a poster to keep. */
export default function Credits() {
  const stage = useStage()
  const reduce = !!useReducedMotion()
  const visible = usePageVisible()
  // the phone on its side: the "upright" card covers the film, so the roll waits behind it
  const sideways = useSideways()
  const [phase, setPhase] = useState<Phase>('roll')
  const [paused, setPaused] = useState(false)
  const [reply, setReply] = useState<Reply>('idle')
  const [keep, setKeep] = useState<Keep>('idle')
  // once she has kept it, the keep line comes back without its first entrance delay
  const [kept, setKept] = useState(false)
  const keptAt = useRef(0)
  const beats = useMemo(() => beatsFor(reply), [reply])
  const seq = useSequence(beats)
  const { jump } = seq
  const sceneRef = useRef<HTMLElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const oRef = useRef<HTMLSpanElement>(null)

  // she reached the end: the next visit starts from the top
  const { markFinished } = stage
  useEffect(() => {
    markFinished()
  }, [markFinished])

  // decode the poster photo now, so even an early "Skip to the end" shows it whole
  useEffect(() => {
    preload(umbrella.src)
  }, [])

  /**
   * The keyboard's place: what is about to go (the pause toggle as the roll
   * ends, the still list as the poster comes) hands its focus to the scene,
   * never to <body>, so the next Tab goes on from here.
   */
  const handOff = useCallback((going: string) => {
    const scene = sceneRef.current
    const active = document.activeElement
    if (!scene || !(active instanceof HTMLElement) || !scene.contains(active) || !active.closest(going)) return
    scene.closest<HTMLElement>('.scene-wrap')?.focus({ preventScroll: true })
  }, [])

  // the roll is over (it reached its end, or she read the still list to its end): the last line holds
  const toHold = useCallback(() => {
    handOff('.credits__toggle')
    // only ever from the roll: a list on its way out under the poster still runs its timers
    setPhase((p) => (p === 'roll' ? 'hold' : p))
  }, [handOff])

  const toPoster = useCallback(() => {
    handOff('.credits__toggle, .credits__roll')
    setPhase('poster')
    jump('poster')
  }, [jump, handOff])

  // the score marks the poster's arrival, once a visit (never again for a pause or the keepsake)
  const { cue } = useSound()
  const posterCued = useRef(false)
  const posterShown = useCallback(() => {
    if (posterCued.current) return
    posterCued.current = true
    cue('poster')
  }, [cue])

  // the last line holds in the middle of the dark, then the poster (the hold starts again if she couldn't see it)
  useEffect(() => {
    if (phase !== 'hold' || !visible || sideways) return
    const id = window.setTimeout(toPoster, HOLD_MS)
    return () => window.clearTimeout(id)
  }, [phase, visible, sideways, toPoster])

  // the desktop bar lines its buttons up with the poster's edges
  const posterRef = useCallback((el: HTMLElement | null) => {
    const scene = sceneRef.current
    if (!el || !scene) return
    const ro = new ResizeObserver(([entry]) => {
      scene.style.setProperty('--poster-w', `${Math.round(entry.contentRect.width)}px`)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // her reply: the chat opens (when Hugo set a link), the wink is on her clipboard, and the poster winks back
  const wink = () => {
    haptic(12)
    winkO(oRef.current, reduce)
    void copyText(WINK).then((ok) => setReply(ok ? 'copied' : 'manual'))
  }

  const togglePause = () => {
    haptic(6)
    setPaused((p) => !p)
  }

  // the keepsake: a tap on the poster clears the screen around it for a screenshot
  const bringBack = useCallback(() => {
    if (performance.now() - keptAt.current < BACK_GUARD_MS) return
    setKeep('idle')
  }, [])

  const keepPoster = () => {
    // pressed again (a screen reader's double tap reaches this button itself, not .credits__catch): bring it all back
    if (keep !== 'idle') return bringBack()
    haptic(8)
    keptAt.current = performance.now()
    setKept(true)
    setKeep('cue')
  }

  // "Screenshot now." for a second, the poster alone for four, then everything comes back
  useEffect(() => {
    if (keep === 'idle') return
    const id = window.setTimeout(
      () => setKeep(keep === 'cue' ? 'clean' : 'idle'),
      keep === 'cue' ? CUE_MS : CLEAN_MS,
    )
    return () => window.clearTimeout(id)
  }, [keep])

  // a key brings everything back early too (a tap does it through .credits__catch)
  useEffect(() => {
    if (keep === 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || SCREENSHOT_KEYS.has(e.key)) return
      bringBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keep, bringBack])

  /*
   * Alone, the sheet grows to the largest 9:16 under the café's string
   * (credits.css draws the move), and fits again at once if the screen changes
   * size. With reduced motion nothing moves: the fit waits until the cue has
   * had its second, and credits.css cuts to it.
   */
  const grow = reduce ? keep === 'clean' : keep !== 'idle'
  useLayoutEffect(() => {
    const stack = stackRef.current
    const band = bandRef.current
    const scene = sceneRef.current
    if (!grow || !stack || !band || !scene) return
    const place = (now: boolean) => {
      const fit = fitSheet(stack, band)
      if (!fit) return null
      if (now) stack.style.transition = 'none'
      stack.style.setProperty('--keep-x', `${fit.x.toFixed(3)}px`)
      stack.style.setProperty('--keep-y', `${fit.y.toFixed(3)}px`)
      stack.style.setProperty('--keep-s', fit.s.toFixed(5))
      if (now) {
        // commit the new fit with no transition, then give the stack its transition back
        void getComputedStyle(stack).transform
        stack.style.removeProperty('transition')
      }
      return fit
    }
    const fit = place(false)
    // "Screenshot now." rides on the sheet, or dissolves before the grown sheet can carry it off the screen
    const gone = fit?.cue && !reduce ? cueGoneMs(stack, fit.cue, band.getBoundingClientRect(), scene.getBoundingClientRect().bottom) : null
    if (gone !== null) {
      stack.style.setProperty('--cue-gone', `${Math.round(gone)}ms`)
      stack.dataset.cue = 'fade'
    }
    let size = `${scene.clientWidth}x${scene.clientHeight}`
    const ro = new ResizeObserver(() => {
      const next = `${scene.clientWidth}x${scene.clientHeight}`
      if (next === size) return
      size = next
      place(true)
    })
    ro.observe(scene)
    return () => {
      ro.disconnect()
      stack.style.removeProperty('--keep-x')
      stack.style.removeProperty('--keep-y')
      stack.style.removeProperty('--keep-s')
      stack.style.removeProperty('--cue-gone')
      delete stack.dataset.cue
    }
  }, [grow, reduce])

  const posterUp = phase === 'poster' && seq.reached('turn')
  const clean = keep !== 'idle'
  const appear = { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.4, delay: 0.15 } } }

  return (
    <section
      ref={sceneRef}
      className={`scene credits is-${phase}${clean ? ' is-clean' : ''}`}
      aria-label={SCENE_LABEL}
    >
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'poster' ? (
          <motion.div
            key="poster"
            className="scene__picture credits__sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 1.4, ease: ease.film } }}
          >
            <div className="credits__stack" ref={stackRef}>
              <Poster
                posterRef={posterRef}
                oRef={oRef}
                onShown={posterShown}
                onKeep={posterUp ? keepPoster : undefined}
                keeping={clean}
              />
              <motion.p
                className="caption credits__keep"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: posterUp && keep !== 'clean' ? 1 : 0,
                  transition:
                    keep === 'clean'
                      ? { duration: 0.3, ease: ease.film }
                      : // back from the clean screenshot, it waits for the sheet to shrink back past his line
                        { duration: 0.8, delay: kept ? 0.45 : posterUp ? 0.9 : 0 },
                }}
              >
                {/* the same place says "Screenshot now." once she taps the sheet */}
                <span className={keep === 'cue' ? 'is-off' : undefined} aria-hidden={keep === 'cue' || undefined}>
                  {t.keep}
                </span>
                <span
                  className={keep === 'cue' ? 'credits__now' : 'credits__now is-off'}
                  aria-hidden={keep !== 'cue' || undefined}
                >
                  {t.screenshotNow}
                </span>
              </motion.p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="roll"
            className={`scene__picture credits__roll${reduce ? ' is-static' : ''}`}
            exit={{ opacity: 0, transition: { duration: reduce ? 0.4 : 0.8, ease: ease.film } }}
          >
            {reduce ? (
              // reduced motion: nothing moves; the credits stand still and she reads at her pace
              <StillRoll waiting={!visible || sideways || phase !== 'roll'} onEnd={toHold} />
            ) : (
              <Roll paused={paused || !visible || sideways || phase !== 'roll'} onEnd={toHold} />
            )}

            {!reduce && phase === 'roll' ? (
              // tap anywhere on the roll to pause it (a finger or a mouse; the bar's toggle is the same control for a keyboard or a screen reader)
              <div className="roll__tap" aria-hidden="true" onClick={togglePause} />
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      <Subtitles seq={seq} />

      {/* the wink itself, under his line, as text she can select and copy by hand */}
      <AnimatePresence>
        {phase === 'poster' && reply !== 'idle' ? (
          <motion.p
            key="wink"
            className="credits__wink"
            initial={{ opacity: 0 }}
            animate={{
              opacity: clean ? 0 : 1,
              // back from the clean screenshot it follows his line, once the sheet has uncovered them
              transition: clean ? { duration: 0.3 } : { duration: 0.35, delay: kept ? 0.35 : 0.1 },
            }}
          >
            {WINK}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <Controls
        // the poster keeps just its two choices; Back stays for the roll
        hideBack={phase === 'poster'}
        // they step aside while she keeps the poster
        hidden={clean}
        action={
          phase !== 'poster'
            ? { label: t.skip, onClick: toPoster }
            : posterUp
              ? { label: t.again, onClick: () => stage.goTo('lights') }
              : null
        }
        extra={
          !reduce && phase === 'roll' ? (
            // one pause / play toggle for the whole roll (so a keyboard never loses its place): out of
            // sight while the credits roll, the round play button while paused (credits.css)
            <button
              key="toggle"
              type="button"
              className={`btn btn--ghost credits__toggle${paused ? ' is-paused' : ''}`}
              aria-label={paused ? PLAY_LABEL : PAUSE_LABEL}
              onClick={togglePause}
            >
              <span className="credits__toggle-icon" aria-hidden="true" />
            </button>
          ) : posterUp ? (
            config.replyUrl ? (
              <motion.a
                key="wink"
                className="btn btn--next"
                href={config.replyUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={wink}
                {...appear}
              >
                {t.wink}
              </motion.a>
            ) : (
              <motion.button key="wink" type="button" className="btn btn--next" onClick={wink} {...appear}>
                {t.wink}
              </motion.button>
            )
          ) : null
        }
      />

      {/* while the poster is alone, any tap brings everything back (and lands on nothing underneath) */}
      {clean ? (
        <div className="credits__catch" aria-hidden="true" onClick={bringBack}>
          {/* the room the sheet may grow into (measured, never drawn) */}
          <div className="credits__band" ref={bandRef} />
        </div>
      ) : null}
    </section>
  )
}

/* ───────────── the roll ───────────── */

type RollPath = { from: number; mid: number; to: number; at: number; seconds: number }

/** ease-out for the roll's last stretch: starts at twice its average speed (0.6 / 0.3), ends at rest */
const SETTLE_EASE = 'cubic-bezier(0.3, 0.6, 0.6, 1)'

/**
 * Constant speed from just below the frame until the last line is SETTLE px
 * short of the centre, then SETTLE_EASE to a stop. That stretch gets twice the
 * time a constant speed would need, so it starts at exactly SPEED: no jolt at
 * the seam.
 */
function rollPath(viewH: number, lastCenter: number): RollPath {
  const from = Math.round(viewH)
  const to = Math.round(viewH / 2 - lastCenter)
  const distance = from - to
  const settle = Math.min(SETTLE, distance / 4)
  const linear = (distance - settle) / SPEED
  const easing = (2 * settle) / SPEED
  return { from, mid: to + settle, to, at: (linear / (linear + easing)) * 100, seconds: linear + easing }
}

/** Pixel keyframes for this screen, so the browser's compositor runs the whole roll. */
function rollKeyframes(p: RollPath) {
  return `@keyframes credits-roll {
  0% { transform: translate3d(0, ${p.from}px, 0); animation-timing-function: linear; }
  ${p.at.toFixed(3)}% { transform: translate3d(0, ${p.mid}px, 0); animation-timing-function: ${SETTLE_EASE}; }
  100% { transform: translate3d(0, ${p.to}px, 0); }
}`
}

/**
 * The column rolls up with one CSS transform animation, sized from the measured
 * content (re-measured when the fonts land or the screen changes size).
 * Pausing flips animation-play-state, so it stops exactly where it is.
 */
function Roll({ paused, onEnd }: { paused: boolean; onEnd: () => void }) {
  const viewRef = useRef<HTMLDivElement>(null)
  const colRef = useRef<HTMLDivElement>(null)
  const lastRef = useRef<HTMLParagraphElement>(null)
  const [path, setPath] = useState<RollPath | null>(null)
  /*
   * While it waits (her tap, another app, the phone on its side), the roll keeps
   * the path it is on and measures again when it goes on. Sideways, the frame is
   * short and so is the path: re-measured under a paused roll, it could end the
   * roll behind the "upright" card.
   */
  const wait = useRef({ paused, stale: false })
  /*
   * One path from the start: wait for the web fonts (they change the line
   * heights) before the first measure. Re-timing the roll a few ms after it
   * starts makes WebKit rewind it to the beginning at its next pause.
   */
  const fontsIn = useRef(false)

  const measure = useCallback(() => {
    const view = viewRef.current
    const last = lastRef.current
    if (!view || !last || !fontsIn.current) return
    if (wait.current.paused) {
      wait.current.stale = true
      return
    }
    const next = rollPath(view.clientHeight, last.offsetTop + last.offsetHeight / 2)
    setPath((prev) => (prev && prev.from === next.from && prev.to === next.to ? prev : next))
  }, [])

  useLayoutEffect(() => {
    wait.current.paused = paused
    if (paused || !wait.current.stale) return
    wait.current.stale = false
    measure()
  }, [paused, measure])

  useLayoutEffect(() => {
    const view = viewRef.current
    const col = colRef.current
    if (!view || !col) return
    let alive = true
    const ro = new ResizeObserver(measure)
    ro.observe(view)
    ro.observe(col)
    // web fonts change line heights: measure again once they are in (never wait more than a second)
    Promise.race([document.fonts?.ready, new Promise((r) => window.setTimeout(r, 1000))]).then(() => {
      if (!alive) return
      fontsIn.current = true
      measure()
    })
    return () => {
      alive = false
      ro.disconnect()
    }
  }, [measure])

  return (
    <div className="roll__view" ref={viewRef}>
      {path ? <style>{rollKeyframes(path)}</style> : null}
      <div
        ref={colRef}
        className="roll__col"
        style={
          path
            ? {
                animationName: 'credits-roll',
                animationDuration: `${path.seconds.toFixed(2)}s`,
                animationTimingFunction: 'linear',
                animationFillMode: 'forwards',
                animationPlayState: paused ? 'paused' : 'running',
              }
            : undefined
        }
        onAnimationEnd={(e) => {
          if (e.animationName === 'credits-roll') onEnd()
        }}
      >
        <CreditList lastRef={lastRef} />
      </div>
    </div>
  )
}

/**
 * Reduced motion: the same credits standing still, in a frame she scrolls at
 * her own pace. They end the way the roll does, on the last line holding:
 * LAST_MS after she has scrolled that line into full view, or STILL_MS after
 * her last scroll (or her arrival) if she never gets there. Every scroll
 * gives her that time again.
 */
function StillRoll({ waiting, onEnd }: { waiting: boolean; onEnd: () => void }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const lastRef = useRef<HTMLParagraphElement>(null)
  // the last line is in full view, clear of the frame's faded foot
  const [seen, setSeen] = useState(false)
  // she has scrolled (when the whole list fits, nothing says she has read it yet: it stands STILL_MS)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const root = scrollerRef.current
    const last = lastRef.current
    if (!root || !last || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(
      (entries) => {
        // the last entry is where the line is now
        const e = entries[entries.length - 1]
        setSeen(e.isIntersecting && e.intersectionRatio >= 1)
      },
      // the mask fades the frame's last 15% out: a line still deep in it is not read yet
      { root, rootMargin: '0px 0px -5% 0px', threshold: 1 },
    )
    io.observe(last)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const root = scrollerRef.current
    if (waiting || !root) return
    let id = 0
    const arm = () => {
      window.clearTimeout(id)
      id = window.setTimeout(onEnd, seen && scrolled ? LAST_MS : STILL_MS)
    }
    const onScroll = () => {
      setScrolled(true)
      arm()
    }
    arm()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(id)
      root.removeEventListener('scroll', onScroll)
    }
  }, [waiting, seen, scrolled, onEnd])

  return (
    <div className="roll__scroller" ref={scrollerRef} tabIndex={0} aria-label={SCENE_LABEL}>
      <div className="roll__col">
        <CreditList lastRef={lastRef} />
      </div>
    </div>
  )
}

function CreditList({ lastRef }: { lastRef?: Ref<HTMLParagraphElement> }) {
  return (
    <>
      <dl className="roll__list">
        {t.roll.map((r, i) => (
          <div className="roll__item" key={`${i}-${r.role}`}>
            <dt className="roll__role">{r.role}</dt>
            <dd className="roll__name" lang={r.vi ? 'vi' : undefined}>
              {/* the last two words stay together (text-wrap: balance needs iOS 17.5) */}
              {r.name.replace(/ (?=\S+$)/, '\u00a0')}
            </dd>
          </div>
        ))}
      </dl>
      <p className="roll__last" ref={lastRef}>
        {t.last}
      </p>
    </>
  )
}

/* ───────────── the poster ───────────── */

/** roles from the roll, longest first, to split "Starring Thao" into its two billing-block sizes */
const ROLES = [...new Set(t.roll.map((r) => r.role))].sort((a, b) => b.length - a.length)
const VI_NAMES = new Set(t.roll.filter((r) => r.vi).map((r) => r.name))

function splitBilling(item: string) {
  const role = ROLES.find((r) => item.toLowerCase().startsWith(`${r.toLowerCase()} `))
  return role ? { role: item.slice(0, role.length), name: item.slice(role.length + 1) } : { role: '', name: item }
}

/**
 * A phone-shaped 9:16 one-sheet she can screenshot and keep.
 * Photo 1 at native 3:4 across its full width (never cropped: she is at the
 * right edge), its black sky melting into the poster's night.
 */
function Poster({
  posterRef,
  oRef,
  onShown,
  onKeep,
  keeping = false,
}: {
  posterRef: Ref<HTMLElement>
  oRef: Ref<HTMLSpanElement>
  /** the sheet has arrived (it starts to fade in) */
  onShown?: () => void
  /** a tap on the sheet (once his line is up): the keepsake */
  onKeep?: () => void
  /** everything else has stepped aside */
  keeping?: boolean
}) {
  useEffect(() => {
    onShown?.()
  }, [onShown])
  const p = t.poster
  return (
    <div className="poster-wrap">
      {/* the photo's own light on the dark around the sheet */}
      <img className="poster-wrap__glow" src={umbrella.glow} alt="" aria-hidden="true" draggable={false} />
      <figure className="poster" ref={posterRef}>
        <div className="poster__photo">
          <img src={umbrella.src} alt={umbrella.alt} draggable={false} decoding="async" />
        </div>
        <div className="poster__fade" aria-hidden="true" />

        <div className="poster__top">
          <p className="poster__presents">{p.presents}</p>
          <p className="poster__tagline">{p.tagline}</p>
        </div>

        <figcaption className="poster__bottom">
          <Title text={p.title} oRef={oRef} />
          <p className="poster__award">{p.award}</p>
          <p className="poster__billing">
            {p.billing.map((item, i) => {
              const { role, name } = splitBilling(item)
              return (
                <Fragment key={i}>
                  <span className="poster__bill">
                    {role ? <span className="poster__bill-role">{role}</span> : null}
                    {role ? ' ' : null}
                    <span className="poster__bill-name" lang={VI_NAMES.has(name) ? 'vi' : undefined}>
                      {name}
                    </span>
                  </span>{' '}
                </Fragment>
              )
            })}
          </p>
          <p className="poster__release">{p.release}</p>
        </figcaption>
      </figure>
      {onKeep ? (
        <button
          type="button"
          className="poster__tap"
          aria-label={KEEP_LABEL}
          aria-pressed={keeping}
          onClick={onKeep}
        />
      ) : null}
    </div>
  )
}

/**
 * THAO, with its O in a box of its own so it can wink back. The letters are
 * hidden from screen readers and the whole word is said once, so the title
 * still reads "THAO" (never "THA O").
 */
function Title({ text, oRef }: { text: string; oRef: Ref<HTMLSpanElement> }) {
  const k = text.lastIndexOf('O')
  if (k < 0) return <h2 className="poster__title">{text}</h2>
  return (
    <h2 className="poster__title">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, k)}
        <span className="poster__o" ref={oRef}>
          {text[k]}
        </span>
        {text.slice(k + 1)}
      </span>
    </h2>
  )
}

/* ───────────── helpers ───────────── */

/**
 * The keepsake's fit: the largest 9:16 sheet the band holds (never smaller
 * than it already is), centred in it, its edges on whole device pixels so the
 * hairline and the type land sharp. Returned as the stack's translate (px) and
 * scale from its top-left corner (credits.css), worked out through whatever
 * transform the stack has right now (a re-fit, or a tap while it was still
 * coming back). cue: where the foot of the keep line, riding under the sheet,
 * is now and where the fit takes it.
 */
function fitSheet(stack: HTMLElement, band: HTMLElement) {
  const poster = stack.querySelector('.poster')
  const keep = stack.querySelector('.credits__keep')
  if (!poster) return null
  const m = (/\(([^)]+)\)/.exec(getComputedStyle(stack).transform)?.[1] ?? '').split(',').map(Number)
  const [k, tx, ty] = m.length === 16 ? [m[0], m[12], m[13]] : m.length === 6 ? [m[0], m[4], m[5]] : [1, 0, 0]
  const st = stack.getBoundingClientRect()
  // the stack's corner where the layout puts it, and a box inside it before the transform
  const ox = st.left - tx
  const oy = st.top - ty
  const laid = (r: DOMRect) => ({ x: ox + (r.left - st.left) / k, y: oy + (r.top - st.top) / k, w: r.width / k, h: r.height / k })
  const p = laid(poster.getBoundingClientRect())
  const b = band.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const snap = (v: number) => Math.round(v * dpr) / dpr
  const room = Math.min(b.width / p.w, b.height / p.h)
  const s = Math.max(1, Math.floor(p.w * room * dpr) / dpr / p.w)
  const left = snap(b.left + (b.width - p.w * s) / 2)
  const top = snap(b.top + (b.height - p.h * s) / 2)
  const x = left - ox - s * (p.x - ox)
  const y = top - oy - s * (p.y - oy)
  // the keep line rides under the sheet: the foot of its line box now, and once the sheet is in place
  const now = keep?.getBoundingClientRect()
  const c = now ? laid(now) : null
  return { x, y, s, cue: now && c ? { from: now.bottom, to: oy + y + s * (c.y + c.h - oy) } : null }
}

/**
 * When "Screenshot now." has to be gone (ms after her tap): before the
 * growing sheet carries it past the screen's edge, or as the sheet lands if
 * it would only end up in the margin under the band. null: it lands inside
 * the band and rides along for its whole second.
 */
function cueGoneMs(stack: HTMLElement, cue: { from: number; to: number }, band: DOMRect, edge: number) {
  if (cue.to <= band.bottom) return null
  const style = getComputedStyle(stack)
  const ms = (time: string) => parseFloat(time) * (/\dms/.test(time) ? 1 : 1000)
  const wait = ms(style.transitionDelay)
  const move = ms(style.transitionDuration)
  const share = cue.to > edge ? (edge - cue.from) / (cue.to - cue.from) : 1
  return wait + move * filmTimeAt(share)
}

/** How far into a move eased with ease.film (var(--ease-film)), as a share of its time, it has covered this share of its way. */
function filmTimeAt(share: number) {
  const [x1, y1, x2, y2] = ease.film
  const at = (u: number, a: number, b: number) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u
  let u = 0
  while (u < 1 && at(u, y1, y2) < share) u += 0.002
  return at(Math.min(u, 1), x1, x2)
}

/** The O shuts and opens like an eye; with reduced motion it dims and comes back instead of moving. */
function winkO(o: HTMLElement | null, reduce: boolean) {
  if (!o || typeof o.animate !== 'function') return
  o.animate(
    reduce
      ? [{ opacity: 1 }, { opacity: 0.25, offset: 0.4 }, { opacity: 1 }]
      : [
          { transform: 'scaleY(1)', easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)' },
          { transform: 'scaleY(0.1)', offset: 0.4, easing: 'cubic-bezier(0.1, 0.5, 0.5, 1)' },
          { transform: 'scaleY(1)' },
        ],
    { duration: WINK_MS },
  )
}

/** false while she is in another app or tab: the roll waits for her */
function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  return visible
}

/** Copy text: the Clipboard API first, then the old hidden-textarea trick (older in-app browsers). */
async function copyText(text: string) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* refused: try the old way */
  }
  return copyWithTextarea(text)
}

function copyWithTextarea(text: string) {
  const area = document.createElement('textarea')
  area.value = text
  area.readOnly = true
  area.setAttribute('aria-hidden', 'true')
  // 16px keeps iOS from zooming; the stage is user-select: none, this must not be
  area.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;-webkit-user-select:text;user-select:text;'
  const before = document.activeElement
  document.body.append(area)
  area.select()
  area.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  if (before instanceof HTMLElement) before.focus({ preventScroll: true })
  return ok
}
