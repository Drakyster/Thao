import type { CSSProperties, ReactNode, Ref } from 'react'

type PhotoLike = { src: string; glow?: string; alt: string }

/**
 * A photo in the shared 3:4 frame, letterboxed on the night.
 * `glow` lets the picture throw its own light onto the dark around it.
 * `push` adds the slow camera push-in (1.00 → 1.045 over 14s).
 */
export function Frame({
  photo,
  glow = true,
  push = false,
  className = '',
  style,
  imgStyle,
  frameRef,
  children,
}: {
  photo: PhotoLike
  glow?: boolean
  push?: boolean
  className?: string
  style?: CSSProperties
  imgStyle?: CSSProperties
  frameRef?: Ref<HTMLDivElement>
  children?: ReactNode
}) {
  return (
    <div className={`frame ${className}`} style={style} ref={frameRef}>
      {glow && photo.glow ? <img className="frame__glow" src={photo.glow} alt="" aria-hidden="true" /> : null}
      <div className="frame__clip">
        <img
          className={`frame__img${push ? ' is-pushing' : ''}`}
          src={photo.src}
          alt={photo.alt}
          draggable={false}
          decoding="async"
          style={imgStyle}
        />
      </div>
      {children}
    </div>
  )
}
