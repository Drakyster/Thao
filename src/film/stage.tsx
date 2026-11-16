import { createContext, useContext } from 'react'

export type StageApi = {
  /** index of the current scene */
  index: number
  count: number
  id: string
  /** id of the scene she just came from (null on the first scene of this visit) */
  from: string | null
  /** go to the next scene (a dissolve; Glued → light is an invisible cut) */
  next: () => void
  /** previous scene (same as the phone's back gesture) */
  back: () => void
  /** jump to a scene by id */
  goTo: (id: string) => void
  /** jump to a scene by index */
  goToIndex: (i: number) => void
  /**
   * pick up where she left off: the scene replaces the opening in the history,
   * so Back from there goes to the scene before it, as everywhere else
   */
  resume: (i: number) => void
  /** she has already seen the whole film once on this phone */
  finishedBefore: boolean
  /** scene index she left off at last time (0 if none) */
  resumeAt: number
  /** call when the credits are reached */
  markFinished: () => void
}

export const StageContext = createContext<StageApi | null>(null)

export function useStage() {
  const api = useContext(StageContext)
  if (!api) throw new Error('useStage must be used inside <App>')
  return api
}
