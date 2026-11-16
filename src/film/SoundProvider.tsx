import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { config, copy } from '../content'
import { Live } from '../lib/score'
import { load } from '../lib/storage'
import { SILENT, SoundContext, logCue, type SoundApi } from './sound'
import './sound.css'

/** the score, for the button (scenes only ever see SoundApi) */
const LiveContext = createContext<Live | null>(null)

/**
 * Wraps the stage: knows the scene, owns the score (src/lib/score.ts).
 * config.sound false: a silent film, and no button.
 */
export function SoundProvider({ scene, children }: { scene: string; children: ReactNode }) {
  if (!config.sound) return <SoundContext.Provider value={SILENT}>{children}</SoundContext.Provider>
  return <Scored scene={scene}>{children}</Scored>
}

function Scored({ scene, children }: { scene: string; children: ReactNode }) {
  // her choice from an earlier visit (anything but an explicit false means on)
  const [live] = useState(() => new Live(load<unknown>('sound', true) !== false))

  // a layout effect: the score knows the new scene before that scene's first effects mark anything
  useLayoutEffect(() => live.setScene(scene), [live, scene])
  useEffect(() => live.attach(), [live])

  const api = useMemo<SoundApi>(
    () => ({
      cue: (name, arg) => {
        logCue(name, arg)
        live.cue(name, arg)
      },
    }),
    [live],
  )

  return (
    <SoundContext.Provider value={api}>
      <LiveContext.Provider value={live}>{children}</LiveContext.Provider>
    </SoundContext.Provider>
  )
}

/** the small sound on/off button in the top corner, once the score has started */
export function SoundToggle() {
  const live = useContext(LiveContext)
  return live ? <Toggle live={live} /> : null
}

function Toggle({ live }: { live: Live }) {
  const { started, on } = useSyncExternalStore(live.subscribe, live.snapshot)
  return (
    <button
      type="button"
      className="sound-toggle"
      data-started={started ? '' : undefined}
      aria-pressed={on}
      aria-label={on ? copy.common.soundOn : copy.common.soundOff}
      aria-hidden={started ? undefined : true}
      tabIndex={started ? undefined : -1}
      onClick={live.toggle}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path className="sound-toggle__body" d="M4.5 9.25h2.9l4.35-3.9v13.3L7.4 14.75H4.5z" />
        {on ? (
          <path d="M15.1 9.2a3.95 3.95 0 0 1 0 5.6M17.75 6.6a7.6 7.6 0 0 1 0 10.8" />
        ) : (
          <path d="M3.6 3.6l16.8 16.8" />
        )}
      </svg>
    </button>
  )
}
