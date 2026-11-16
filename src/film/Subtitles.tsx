import { AnimatePresence, motion } from 'motion/react'
import { copy } from '../content'
import type { Sequence } from './sequence'
import { useStage } from './stage'

/** at the last line, a tap on the right goes on to the next scene once the line has had this long */
const END_TAP_MS = 1500

/**
 * Yellow film subtitles under the picture.
 * Tap the right side to move on, the left side to read the previous line
 * again (the same gesture as Instagram stories). At a scene's last line the
 * right side goes on to the next scene, like the Next button. Lines fade in
 * quickly with a slight rise and leave even faster, so the film keeps flowing.
 */
export function Subtitles({
  seq,
  hidden = false,
  onEnd,
}: {
  seq: Sequence
  hidden?: boolean
  /** what "go on" means at the last line (defaults to the next scene) */
  onEnd?: () => void
}) {
  const stage = useStage()
  const beat = seq.beat
  const text = hidden ? undefined : (beat?.say ?? beat?.prompt)
  const tone = beat?.say ? 'his' : 'prompt'
  const isEnd = beat?.wait === 'end'
  const tappable = !!text && beat?.wait !== 'gesture' && !isEnd
  const goOn = onEnd ?? (stage.index < stage.count - 1 ? stage.next : undefined)
  const endTap = !!text && isEnd && !!goOn

  return (
    <div className="subs">
      <div aria-live="polite" aria-atomic="true" className="subs__live">
        <AnimatePresence mode="wait" initial={false}>
          {text ? (
            <motion.p
              key={`${seq.i}:${text}`}
              className={beat?.vow ? 'sub sub--vow' : 'sub'}
              data-tone={tone}
              data-beat={beat?.id}
              lang={beat?.lang}
              initial={{ opacity: 0, y: 5 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: beat?.vow
                  ? { duration: 0.9, ease: [0.22, 0.61, 0.36, 1] }
                  : { duration: 0.24, ease: [0.23, 1, 0.32, 1] },
              }}
              exit={{ opacity: 0, transition: { duration: 0.14, ease: 'easeIn' } }}
            >
              {/* the last two words stay together, so no line ever ends on one word (text-wrap: balance needs iOS 17.5) */}
              {text.replace(/ (?=\S+$)/, ' ')}
              {/* a quiet "tap for more", once she has had a second to read */}
              {tappable && tone === 'his' && !beat?.vow ? <span className="sub__more" aria-hidden="true" /> : null}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      {seq.canPrev && !hidden ? (
        <button
          type="button"
          className="sub-tap sub-tap--prev"
          aria-label="Previous line"
          onClick={seq.prev}
        />
      ) : null}
      {tappable ? (
        <button
          type="button"
          className="sub-tap sub-tap--next"
          aria-label="Next line"
          onClick={seq.tapNext}
        />
      ) : endTap ? (
        <button
          type="button"
          className="sub-tap sub-tap--next"
          aria-label={copy.common.next}
          onClick={() => {
            if (seq.elapsed() >= END_TAP_MS) goOn?.()
          }}
        />
      ) : null}
    </div>
  )
}
