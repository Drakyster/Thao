import { AnimatePresence, motion, useIsPresent, type Variants } from 'motion/react'
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Grain } from './components/Grain'
import { copy } from './content'
import { SoundProvider, SoundToggle } from './film/SoundProvider'
import { StageContext, type StageApi } from './film/stage'
import { load, save } from './lib/storage'
import Lights from './scenes/Lights'
import Sofas from './scenes/Sofas'
import Week from './scenes/Week'
import Focus from './scenes/Focus'
import Plane from './scenes/Plane'
import Glued from './scenes/Glued'
import SameLight from './scenes/SameLight'
import Credits from './scenes/Credits'

/*
 * The film, scene by scene. Each scene is its own file in src/scenes.
 * Open #<id> in the address bar to jump straight to one (handy to test on a phone).
 *
 * Every scene ships with the first load (about 100 kB in all, far less than
 * the photos): once the page is open, nothing else has to come over the
 * network, so a bad signal halfway through can never leave her on an empty screen.
 */
const SCENES: readonly { id: string; View: ComponentType }[] = [
  { id: 'lights', View: Lights }, // she switches the film on
  { id: 'sofas', View: Sofas }, // two kids, then the match cut
  { id: 'week', View: Week }, // Monday to Saturday
  { id: 'friday', View: Focus }, // back to Friday night at the café
  { id: 'plane', View: Plane }, // Saturday, the flight
  { id: 'glued', View: Glued }, // 10,000 km, still glued
  { id: 'light', View: SameLight }, // I love you. Anh yêu em.
  { id: 'credits', View: Credits }, // credits and the poster
]

type Progress = { last: number; finished: boolean }

/**
 * Where she is, where she came from (some cuts are continuous), and which
 * visit this is: every visit mounts the scene fresh, even one she comes back
 * to while it is still dissolving away.
 */
type View = { index: number; from: number; n: number }

/** how one scene hands over to the next */
type Cut = { instant: boolean }

const DISSOLVE: Variants = {
  // the scene arriving fades up over the one leaving, a film dissolve, never a dip to an empty room
  hidden: (cut: Cut) => ({ opacity: cut.instant ? 1 : 0 }),
  shown: (cut: Cut) => ({
    opacity: 1,
    transition: cut.instant ? { duration: 0 } : { duration: 0.7, delay: 0.12, ease: [0.22, 0.61, 0.36, 1] },
  }),
  gone: (cut: Cut) => ({
    opacity: 0,
    transition: cut.instant ? { duration: 0 } : { duration: 0.45, ease: [0.4, 0, 0.2, 1] },
  }),
}

function indexFromHash() {
  const id = window.location.hash.replace(/^#/, '')
  return SCENES.findIndex((s) => s.id === id)
}

/** If a scene ever fails to draw, she gets a way through instead of an empty screen. */
class SceneSafety extends Component<{ children: ReactNode }, { failed: boolean }> {
  static contextType = StageContext
  declare context: StageApi | null
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    const stage = this.context
    return (
      <section className="scene scene--failed">
        <div className="subs">
          <p className="sub" data-tone="prompt">
            {copy.common.failed}
          </p>
        </div>
        <nav className="bar" aria-label="Film controls">
          {stage && stage.index > 0 ? (
            <button type="button" className="btn btn--text" onClick={stage.back}>
              {copy.common.back}
            </button>
          ) : (
            <span />
          )}
          <div className="bar__side">
            <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
              {copy.common.retry}
            </button>
            {/* if it fails every time on her phone, the rest of the film is still reachable */}
            {stage && stage.index < stage.count - 1 ? (
              <button type="button" className="btn btn--next" onClick={stage.next}>
                {copy.common.skip}
              </button>
            ) : null}
          </div>
        </nav>
      </section>
    )
  }
}

/**
 * One scene on the stage. While it leaves, it can no longer be touched, nor
 * reached from the keyboard (inert): a second press of Enter can never skip
 * the scene that is arriving.
 */
function SceneWrap({ cut, first, children }: { cut: Cut; first: boolean; children: ReactNode }) {
  const present = useIsPresent()
  const ref = useRef<HTMLDivElement>(null)

  // a keyboard user keeps their place: focus moves into the scene that arrives
  // (only when it was left behind in the scene that is leaving)
  useEffect(() => {
    if (first) return
    const active = document.activeElement
    if (!active || active === document.body || active.closest('[inert], [data-present="false"]')) {
      ref.current?.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div
      ref={ref}
      className="scene-wrap"
      data-present={present}
      inert={!present}
      tabIndex={-1}
      custom={cut}
      variants={DISSOLVE}
      initial={first ? false : 'hidden'}
      animate="shown"
      exit="gone"
    >
      <SceneSafety>{children}</SceneSafety>
    </motion.div>
  )
}

/**
 * The climax plays for about half a minute without a touch: keep the phone's
 * screen awake while she watches, so Auto-Lock never dims it on "I love you."
 * (Safari 16.4+; a quiet no-op where the API is missing). Released after a
 * minute and a half without any touch, so a phone left on the poster can sleep.
 */
function useStayAwake() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let asking = false
    let idle = 0
    const release = () => {
      window.clearTimeout(idle)
      idle = 0
      const held = lock
      lock = null
      held?.release().catch(() => undefined)
    }
    const want = () => {
      window.clearTimeout(idle)
      idle = window.setTimeout(release, 90_000)
      if (lock || asking || document.visibilityState !== 'visible') return
      asking = true
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          lock = l
          l.addEventListener('release', () => {
            if (lock === l) lock = null
          })
        })
        .catch(() => undefined)
        .finally(() => {
          asking = false
        })
    }
    // the phone drops the lock when the page is hidden: take it again when she comes back
    const onVisible = () => {
      if (document.visibilityState === 'visible') want()
    }
    window.addEventListener('pointerdown', want, true)
    window.addEventListener('keydown', want, true)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('pointerdown', want, true)
      window.removeEventListener('keydown', want, true)
      document.removeEventListener('visibilitychange', onVisible)
      release()
    }
  }, [])
}

export default function App() {
  // stored progress comes from an earlier visit (maybe an older build): trust nothing in it
  const saved = useMemo<Progress>(() => {
    const raw = load<{ last?: unknown; finished?: unknown } | null>('progress', null)
    const last = raw?.last
    return {
      last: typeof last === 'number' && Number.isInteger(last) && last > 0 && last < SCENES.length ? last : 0,
      finished: raw?.finished === true,
    }
  }, [])
  const [view, setView] = useState<View>(() => ({ index: Math.max(0, indexFromHash()), from: -1, n: 0 }))
  const { index, from, n } = view
  const [finished, setFinished] = useState(saved.finished)
  // how many history entries this visit has pushed (so Back never leaves the site)
  const depth = useRef(0)
  // a quick double tap lands on the next scene's button too (it sits under the same finger): one move at a time
  const movedAt = useRef(-Infinity)
  const settled = useCallback(() => {
    const now = performance.now()
    if (now - movedAt.current < 400) return false
    movedAt.current = now
    return true
  }, [])
  // the very first scene appears without the dissolve (the page itself just loaded)
  const [firstPaint, setFirstPaint] = useState(true)
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setFirstPaint(false))
    return () => window.cancelAnimationFrame(t)
  }, [])

  useStayAwake()

  // first entry: make the hash match the scene, without adding history
  useEffect(() => {
    window.history.replaceState({ scene: index }, '', `#${SCENES[index].id}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the phone's back gesture steps back one scene instead of closing the film
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const i = typeof e.state?.scene === 'number' ? e.state.scene : indexFromHash()
      if (i >= 0) setView((v) => (v.index === i ? v : { index: i, from: v.index, n: v.n + 1 }))
      depth.current = Math.max(0, depth.current - 1)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // remember where she is, in case the in-app browser reloads; opening the
  // bare link again must not wipe a place to resume she hasn't used yet
  useEffect(() => {
    const untouched = index === 0 && from === -1 && saved.last > 0 && !saved.finished && !finished
    if (untouched) return
    save('progress', { last: index, finished } satisfies Progress)
  }, [index, from, finished, saved])

  // fetch the Vietnamese character sets early, so no accented letter ever
  // shows up in a fallback font for a split second
  useEffect(() => {
    const fonts = document.fonts
    if (!fonts?.load) return
    Promise.allSettled([
      fonts.load('500 17px "Be Vietnam Pro"', 'Dính như sam Việt Nam'),
      fonts.load('italic 300 48px "Newsreader Variable"', 'Anh yêu em Dính như sam Việt Nam'),
      fonts.load('300 48px "Newsreader Variable"', 'Việt Nam'),
      fonts.load('500 13px "Saira Extra Condensed"', 'VIỆT NAM'),
      fonts.load('300 13px "Saira Extra Condensed"', 'VIỆT NAM'),
    ])
  }, [])

  const goTo = useCallback((i: number) => {
    if (i < 0 || i >= SCENES.length || !settled()) return
    setView((v) => (v.index === i ? v : { index: i, from: v.index, n: v.n + 1 }))
    window.history.pushState({ scene: i }, '', `#${SCENES[i].id}`)
    depth.current += 1
  }, [settled])

  const api = useMemo<StageApi>(
    () => ({
      index,
      count: SCENES.length,
      id: SCENES[index].id,
      from: SCENES[from]?.id ?? null,
      next: () => goTo(index + 1),
      back: () => {
        if (index === 0 || !settled()) return
        if (depth.current > 0) window.history.back()
        else {
          setView((v) => ({ index: index - 1, from: index, n: v.n + 1 }))
          window.history.replaceState({ scene: index - 1 }, '', `#${SCENES[index - 1].id}`)
        }
      },
      goTo: (id: string) => goTo(SCENES.findIndex((s) => s.id === id)),
      goToIndex: goTo,
      resume: (i: number) => {
        if (i <= 0 || i >= SCENES.length) return
        // the scene before it takes the opening's place in the history, so both
        // Back and the phone's back gesture step back one scene, as everywhere else
        setView((v) => ({ index: i, from: v.index, n: v.n + 1 }))
        window.history.replaceState({ scene: i - 1 }, '', `#${SCENES[i - 1].id}`)
        window.history.pushState({ scene: i }, '', `#${SCENES[i].id}`)
        depth.current = 1
      },
      finishedBefore: saved.finished,
      resumeAt: saved.finished ? 0 : saved.last,
      markFinished: () => setFinished(true),
    }),
    [index, from, goTo, saved, settled],
  )

  const { id, View } = SCENES[index]
  // Glued ends on the umbrella photo's one bulb, still lit; the next scene
  // opens on that same bulb, so the cut between them is invisible
  const cut: Cut = { instant: SCENES[from]?.id === 'glued' && id === 'light' }

  return (
    <StageContext.Provider value={api}>
      <SoundProvider scene={id}>
      <main className="stage" data-scene={id}>
        {/*
          No initial={false} on AnimatePresence: it would be inherited by every
          motion element of the first scene and silently skip all of its entrance
          animations. Only the wrapper's own fade is skipped on first paint.
        */}
        <AnimatePresence custom={cut}>
          <SceneWrap key={`${id}:${n}`} cut={cut} first={firstPaint}>
            <View />
          </SceneWrap>
        </AnimatePresence>

        <div className="progress" aria-hidden="true">
          <div
            className="progress__fill"
            style={{ transform: `scaleX(${index / (SCENES.length - 1)})` }}
          />
        </div>
        <Grain />
        <SoundToggle />
        <p className="upright">{copy.common.upright}</p>
      </main>
      </SoundProvider>
    </StageContext.Provider>
  )
}
