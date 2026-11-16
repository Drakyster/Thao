import cafeLaugh from './assets/photos/cafe-laugh.webp'
import cafeLaughBlur from './assets/photos/cafe-laugh-blur.webp'
import cafeWink from './assets/photos/cafe-wink.webp'
import littleHim from './assets/photos/little-him.webp'
import littleThao from './assets/photos/little-thao.webp'
import placeholders from './assets/photos/placeholders.json'

/** A point or size in a photo, as a fraction of its width (x) and height (y). */
export type Pt = { x: number; y: number }

export type Photo = {
  src: string
  /** 12px-wide blurred copy: used as the light a frame spills onto the dark */
  glow: string
  alt: string
}

/*
 * All photos are 3:4. Anchors were measured on the exported files
 * (eye midpoints, eye distance as a fraction of the photo width).
 * Both café selfies are mirrored, like the phone saved them:
 * he is on the left in both, and every pairing keeps him left.
 */

export const umbrella = {
  src: cafeWink,
  glow: placeholders['cafe-wink'],
  alt: `Us under the striped umbrella at the café. You're winking, I'm trying to look calm.`,
  /** where the two heads meet: the cut line for the "glued" split */
  join: 0.555,
  him: { eyes: { x: 0.32, y: 0.447 }, eyeGap: 0.19 },
  her: { eyes: { x: 0.77, y: 0.41 }, eyeGap: 0.2 },
  /** the hottest bulb under the umbrella (brightness centroid) */
  bulb: { x: 0.802, y: 0.08 },
} satisfies Photo & Record<string, unknown>

export const laugh = {
  src: cafeLaugh,
  blur: cafeLaughBlur,
  glow: placeholders['cafe-laugh'],
  alt: `Us at the café at night, palm trees and a lit tower behind us. I'm winking, you're laughing and winking too.`,
  join: 0.69,
  him: { face: { x: 0.42, y: 0.46 } },
  her: { face: { x: 0.865, y: 0.54 } },
} satisfies Photo & Record<string, unknown>

export const kidHim = {
  src: littleHim,
  glow: placeholders['little-him'],
  alt: 'Me in 2009, dressed for a wedding, on a brown leather sofa in front of a fish tank.',
  eyes: { x: 0.455, y: 0.352 },
  // pupil to pupil, measured on little-him.webp
  eyeGap: 0.129,
} satisfies Photo & Record<string, unknown>

export const kidHer = {
  src: littleThao,
  glow: placeholders['little-thao'],
  alt: `You as a little girl with two green bows in your hair and a peace sign, on a burgundy leather sofa.`,
  eyes: { x: 0.51, y: 0.352 },
  eyeGap: 0.185,
} satisfies Photo & Record<string, unknown>

/** Decode an image before revealing it, so nothing pops in half-loaded. */
export function preload(src: string) {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  return img.decode().catch(() => undefined)
}

export const allPhotos = [littleHim, littleThao, cafeWink, cafeLaugh, cafeLaughBlur]

