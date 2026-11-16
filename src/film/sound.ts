import { createContext, useContext } from 'react'

/**
 * The film's sound: a light, original score played by the browser itself (no
 * audio files, nothing licensed), and a few cues at the moments of the story.
 *
 * Scenes only ever call `useSound().cue(...)`; App gives the score the current
 * scene (SoundProvider). Everything is silent until her first touch is lifted
 * (browsers only allow sound after a gesture), and stays silent if she mutes it.
 */

/** the moments a scene can mark (see each scene for where they fire) */
export type Cue =
  | 'bloom' // #lights: the bulb lights under her finger
  | 'match' // #sofas: the match cut, the café's string comes on
  | 'bulb' // #week: a day's bulb lights (arg: the day, 0 = Monday … 5 = Saturday)
  | 'found' // #friday: the focus lands on her ("There you are.")
  | 'cried' // #plane: "On the plane, I cried. A lot." (the drop starts to run)
  | 'clear' // #plane: the fog lifts ("Thanks. I needed that.")
  | 'leave' // #glued: the café's lights go out, all but one bulb
  | 'lit' // #light: the bulb lights again and the light spreads
  | 'cut' // #light: the hard cut to black after "I love you."
  | 'card' // #light: "Anh yêu em." appears
  | 'poster' // #credits: the poster appears

export type SoundApi = {
  /** mark a moment of the story (safe to call any time, even before sound has started or when muted) */
  cue: (name: Cue, arg?: number) => void
}

/**
 * In development every cue is also logged on window.__thaoCues ({ name, arg, t }),
 * so a test can check that a scene marks its moment once, at the right time.
 * The engine calls this too. Nothing is logged in the built site.
 */
export function logCue(name: Cue, arg?: number) {
  if (!import.meta.env.DEV) return
  const w = window as unknown as { __thaoCues?: { name: Cue; arg?: number; t: number }[] }
  ;(w.__thaoCues ??= []).push({ name, arg, t: performance.now() })
}

export const SILENT: SoundApi = { cue: logCue }

export const SoundContext = createContext<SoundApi>(SILENT)

/** what a scene uses to mark its moments */
export function useSound() {
  return useContext(SoundContext)
}
