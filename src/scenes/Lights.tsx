import { animate, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { copy } from '../content'
import { Controls } from '../film/Controls'
import { Lamp } from '../film/Lamp'
import { useWarmUp } from '../film/useWarmUp'
import { useSequence, type Beat } from '../film/sequence'
import { useSound } from '../film/sound'
import { useStage } from '../film/stage'
import { Subtitles } from '../film/Subtitles'
import { useSideways } from '../film/useSideways'
import { ease } from '../lib/feel'
import { allPhotos, preload } from '../photos'
import './lights.css'

const t = copy.lights

const BEATS: Beat[] = [
  { id: 'hold', prompt: t.prompt, wait: 'gesture' },
  { id: 'keep', prompt: t.keepHolding, wait: 'gesture' },
]

/** On a rewatch the bulb still holds a little of last time's light. */
const REMEMBERED_HEAT = 0.1
/** The title card holds this long, then the film rolls on by itself. */
const TITLE_MS = 3000
/** THAO's tracking closes in as it fades up: how much wider (em per gap) it starts. */
const TRACK_IN_EM = 0.08
/**
 * Lit, the bulb stays in the flare a moment and goes out under it, as the
 * flare peaks: fading straight out over the dark room, its white-hot glass
 * would pass through grey.
 */
const LAMP_OUT = { duration: 0.3, delay: 0.16, ease: 'easeIn' } as const
/** the reduced bloom is one 0.6 s pulse: the bulb is gone by its peak */
const LAMP_OUT_REDUCED = { duration: 0.2, delay: 0.1, ease: 'easeIn' } as const
/** The wire (lights.css) ends this far above the bulb's centre, inside the socket's dome (px)... */
const WIRE_END = 31
/** ...and stops this far below the greeting's last line: never longer than film.css draws it, nor a mere stub. */
const WIRE_CLEAR = 8
const WIRE_MAX = 113
const WIRE_MIN = 24

/** Her name letter by letter (composed first, so an accented capital stays one letter). */
const LETTERS = Array.from(t.title.normalize('NFC'))

/** Scene 1: a single cold light in the dark. She warms it up; the film starts. */
export default function Lights() {
  const stage = useStage()
  const reduce = useReducedMotion()
  const seq = useSequence(BEATS)
  const [phase, setPhase] = useState<'dark' | 'bloom' | 'title'>('dark')
  const dark = phase === 'dark'
  const flash = useRef<HTMLDivElement>(null)
  const stageEl = useRef<HTMLDivElement>(null)
  const hello = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const helloId = useId()
  const { cue } = useSound()
  // only the scene she is watching marks its moment (a hold can still end while it fades out under Continue)
  const present = useIsPresent()

  // who is arriving, read once: the stage moves on while this scene fades out
  const [visit] = useState(() => {
    // she has seen it all before: on this phone, or just now ("Watch again" comes from the credits)
    const again = stage.finishedBefore || stage.from === 'credits'
    // she left halfway last time
    const resumeTo = again ? 0 : stage.resumeAt
    return { again, resumeTo, greeting: again ? t.helloAgain : resumeTo > 0 ? t.welcomeBack : t.hello }
  })

  // her hold and the Play fallback end in the same warm-up, so the score hears the bloom once, as it starts
  const lamp = useWarmUp({
    onLit: () => {
      setPhase('bloom')
      if (present) cue('bloom')
    },
    rest: visit.again ? REMEMBERED_HEAT : 0,
  })

  // decode every photo while she reads the first screen
  useEffect(() => {
    allPhotos.forEach(preload)
  }, [])

  // the bulb hangs from the dark above the greeting: its wire stops short of the last line, whatever the
  // screen or the copy (layout offsets, so the greeting's rise as it fades in doesn't count)
  useLayoutEffect(() => {
    const el = stageEl.current
    const text = hello.current
    const bulb = anchor.current
    if (!el || !text || !bulb) return
    const fit = () => {
      const room = bulb.offsetTop - WIRE_END - (text.offsetTop + text.offsetHeight) - WIRE_CLEAR
      el.style.setProperty('--wire', `${Math.round(Math.min(WIRE_MAX, Math.max(WIRE_MIN, room)))}px`)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    ro.observe(text)
    return () => ro.disconnect()
  }, [])

  // letting go too early teaches the gesture
  useEffect(() => {
    if (lamp.hint && seq.at('hold')) seq.jump('keep')
  }, [lamp.hint, seq])

  // the bloom: the bulb flares (never a white-out), falls back to the dark, the title comes up
  useEffect(() => {
    if (phase !== 'bloom' || !flash.current) return
    const el = flash.current
    let live = true
    const run = async () => {
      if (reduce) {
        await animate(el, { opacity: [0, 0.6, 0] }, { duration: 0.6 })
      } else {
        await animate(el, { opacity: [0, 0.75] }, { duration: 0.45, ease: [0.4, 0, 0.2, 1] })
        await animate(el, { opacity: 0 }, { duration: 0.9, ease: [0.4, 0, 1, 1] })
      }
      if (live) setPhase('title')
    }
    run()
    return () => {
      live = false
    }
  }, [phase, reduce])

  // the phone on its side (the "upright" card covers the film), or the page hidden: the title card waits for her
  const sideways = useSideways()
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden')
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  const away = sideways || hidden

  // THAO stands alone in the light she made, then the film rolls on by itself (once);
  // if she looks away, the card holds its whole time again when she is back
  const rolled = useRef(false)
  const { next } = stage
  useEffect(() => {
    if (phase !== 'title' || away) return
    const id = window.setTimeout(() => {
      if (rolled.current) return
      rolled.current = true
      next()
    }, TITLE_MS)
    return () => window.clearTimeout(id)
  }, [phase, next, away])

  // the way through: late, so she tries the light first; at once if she let go too early; gone while it warms
  const offerPlay = dark && lamp.state === 'cold'

  return (
    <section className="scene lights" data-phase={phase} aria-label="Opening">
      {/* the whole picture is the switch while the bulb is cold (the greeting is read as its description) */}
      <div
        ref={stageEl}
        className="scene__picture lights__stage"
        tabIndex={dark ? 0 : -1}
        {...(dark ? { role: 'button', 'aria-label': t.prompt, 'aria-describedby': helloId, ...lamp.bind } : {})}
      >
        <motion.div
          ref={hello}
          id={helloId}
          className="lights__hello"
          aria-hidden={dark ? undefined : true}
          initial={{ opacity: 0, y: reduce ? 0 : 10 }}
          animate={{ opacity: dark ? 1 : 0, y: 0 }}
          transition={{ duration: dark ? 0.9 : 0.25, ease: [0.22, 1, 0.36, 1], delay: dark ? 0.3 : 0 }}
        >
          <h1 className="lights__hi title-serif">{visit.greeting}</h1>
          <p className="lights__intro">{t.intro}</p>
          <p className="lights__runtime">{t.runtime}</p>
        </motion.div>

        <motion.div
          ref={anchor}
          className="lights__lamp"
          initial={{ opacity: 0 }}
          animate={{ opacity: dark ? 1 : 0 }}
          transition={dark ? { duration: 1.2, delay: 0.9 } : reduce ? LAMP_OUT_REDUCED : LAMP_OUT}
        >
          <Lamp heat={lamp.heat} />
          {dark && lamp.state === 'cold' ? <span className="lights__breath" aria-hidden="true" /> : null}
        </motion.div>

        {phase === 'title' ? (
          <div className="lights__title">
            <motion.h2
              className="lights__name title-serif"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.4, ease: ease.film }}
            >
              <span className="sr-only">{t.title}</span>
              {/* the tracking closes in as it fades up: each letter drifts to its place (transforms only) */}
              {LETTERS.map((letter, k) => (
                <motion.span
                  key={k}
                  className="lights__letter"
                  aria-hidden="true"
                  initial={{ x: `${reduce ? 0 : (k - (LETTERS.length - 1) / 2) * TRACK_IN_EM}em` }}
                  animate={{ x: '0em' }}
                  transition={{ duration: 1.4, ease: ease.film }}
                >
                  {letter}
                </motion.span>
              ))}
            </motion.h2>
            <motion.p
              className="lights__byline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.2, delay: 0.7 }}
            >
              {t.byline}
            </motion.p>
          </div>
        ) : null}
      </div>

      <Subtitles seq={seq} hidden={!dark} />

      {/* no Next on the title card: it moves on by itself */}
      <Controls
        hidden={!dark}
        action={offerPlay ? { label: t.play, onClick: lamp.play, late: true, missed: lamp.missed } : null}
        extra={
          dark && visit.resumeTo > 0 ? (
            <button type="button" className="btn btn--text" onClick={() => stage.resume(visit.resumeTo)}>
              {t.resume}
            </button>
          ) : null
        }
      />

      <div ref={flash} className="flash" aria-hidden="true" />
    </section>
  )
}
