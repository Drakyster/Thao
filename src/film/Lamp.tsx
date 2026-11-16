import { motion, useTransform, type MotionValue } from 'motion/react'
import type { CSSProperties } from 'react'

/*
 * The lamp she holds in the opening and at the peak: the same café bulb as
 * the week's string, with its domed socket, brass collar, filament and
 * reflection (the glass and the wire are its host's ::before and ::after,
 * film.css). Like a real filament it warms slowly while dull red, then
 * rushes to white, and at the end the whole glass fills with light.
 *
 * Every glow is a fixed gradient that only fades or grows with the heat:
 * the phone composites those, instead of repainting them on every frame of
 * her hold.
 */
const STOPS = [0, 0.35, 0.72, 1]
/** the filament: ember, tungsten, bulb yellow, then white (the light it throws on the room stops at gold) */
const CORE = ['#6b2d0b', '#ea9a1a', '#ffd27a', '#fffaf0']
/** the light on the room peaks in amber at this heat (film.css .lamp__light--amber)... */
const AMBER_AT = 0.35
/** ...and these are the alphas of the amber and gold lights' centres */
const AMBER_A = 0.5
const GOLD_A = 0.55

/** the week's filament and its two supports (Week.tsx), in a 20x20 box */
const FILAMENT = 'M9 0.5 8.1 10.6M11 0.5 11.9 10.6M8.1 10.6l.63-1.1.63 1.1.63-1.1.63 1.1.63-1.1.63 1.1'

/**
 * How much of each of the three stacked lights (ember, amber, gold) shows at
 * a given heat. The one on top fades in as the one under it fades out a
 * little slower, so the pair adds up to a single light whose colour and
 * strength move in a straight line from one to the next.
 */
function halo(h: number): [number, number, number] {
  if (h <= AMBER_AT) {
    const t = Math.max(0, h) / AMBER_AT
    return [(1 - t) / (1 - t * AMBER_A), t, 0]
  }
  const t = Math.min(1, (h - AMBER_AT) / (1 - AMBER_AT))
  return [0, (1 - t) / (1 - t * GOLD_A), t]
}

export function Lamp({ heat, className = '', style }: { heat: MotionValue<number>; className?: string; style?: CSSProperties }) {
  // the light on the room grows out of the glass as it warms
  const reach = useTransform(heat, [0, 1], [0.16, 1])
  const ember = useTransform(heat, (h) => halo(h)[0])
  const amber = useTransform(heat, (h) => halo(h)[1])
  const gold = useTransform(heat, (h) => halo(h)[2])
  // the filament itself: it catches at her first touch, then runs through the colours of the heat
  const wire = useTransform(heat, STOPS, CORE)
  const caught = useTransform(heat, [0, 0.1], [0, 1])
  // the cold filament's faint ember, then its glow, then the glass full of light
  const smoulder = useTransform(heat, [0, 0.12, 0.3, 0.55], [0.5, 0.9, 1, 0])
  const glow = useTransform(heat, [0.12, 0.66], [0, 1])
  const lit = useTransform(heat, [0.68, 1], [0, 1])
  const capLit = useTransform(heat, [0.4, 1], [0, 1])

  return (
    <div className={`lamp ${className}`} style={style} aria-hidden="true">
      <motion.div className="lamp__halo" style={{ scale: reach }}>
        <motion.div className="lamp__light lamp__light--ember" style={{ opacity: ember }} />
        <motion.div className="lamp__light lamp__light--amber" style={{ opacity: amber }} />
        <motion.div className="lamp__light lamp__light--gold" style={{ opacity: gold }} />
      </motion.div>
      <div className="lamp__cap">
        <motion.div className="lamp__cap-lit" style={{ opacity: capLit }} />
      </div>
      <div className="lamp__globe">
        <motion.div className="lamp__ember" style={{ opacity: smoulder }} />
        <motion.div className="lamp__glow" style={{ opacity: glow }} />
        <svg className="lamp__filament lamp__filament--cold" viewBox="0 0 20 20">
          <path d={FILAMENT} />
        </svg>
        <motion.svg className="lamp__filament lamp__filament--hot" viewBox="0 0 20 20" style={{ opacity: caught }}>
          <motion.path className="lamp__bloom" d={FILAMENT} style={{ stroke: wire }} />
          <motion.path d={FILAMENT} style={{ stroke: wire }} />
        </motion.svg>
        <motion.div className="lamp__lit" style={{ opacity: lit }} />
        <div className="lamp__spec" />
      </div>
    </div>
  )
}
