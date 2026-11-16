import { useEffect, useState } from 'react'
import './grain.css'

const TILE = 160

/**
 * One tile of fine film grain, drawn once at the screen's pixel density.
 * The specks are warm (cream light, espresso dark), like grain on a print
 * under tungsten light, so no CSS filter has to tint them on every frame.
 */
function makeGrainTile(done: (url: string) => void) {
  const size = Math.round(TILE * Math.min(2, window.devicePixelRatio || 1))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d')
  } catch {
    /* no canvas here: then there is simply no grain */
  }
  if (!ctx) return
  const img = ctx.createImageData(size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const light = Math.random() < 0.5
    d[i] = light ? 255 : 26
    d[i + 1] = light ? 238 : 12
    d[i + 2] = light ? 212 : 4
    // most pixels nearly clear, a few stronger specks
    const r = Math.random()
    d[i + 3] = Math.round(r * r * r * (light ? 46 : 70))
  }
  ctx.putImageData(img, 0, 0)
  // a blob URL, not a 400 kB base64 string written into the style attribute
  canvas.toBlob((blob) => blob && done(URL.createObjectURL(blob)), 'image/png')
}

/**
 * Film grain over everything. Moves at ~12 fps; static with reduced motion.
 * The tile is drawn just after the first frame, so it never delays the film's
 * first picture; the grain then fades in.
 */
export function Grain() {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let made: string | null = null
    const t = window.setTimeout(() => {
      makeGrainTile((u) => {
        if (!alive) return URL.revokeObjectURL(u)
        made = u
        setUrl(u)
      })
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(t)
      if (made) URL.revokeObjectURL(made)
    }
  }, [])

  if (!url) return null
  return <div className="grain" style={{ backgroundImage: `url(${url})` }} aria-hidden="true" />
}
