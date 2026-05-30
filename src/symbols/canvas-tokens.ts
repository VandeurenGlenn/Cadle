/**
 * Canvas-paint tokens.
 *
 * Fabric paints to a 2D context, so it cannot read CSS variables directly —
 * we resolve them on the document root and hand the value back as a string.
 * Falls back to a neutral warm gray so canvas elements never render as harsh
 * pure black/white when the theme has not loaded yet.
 */
const fallbackInk = '#000'

const readVar = (name: string): string => {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Subtle on-surface ink for measurement labels, dimensions, etc. */
export const canvasInk = (): string =>
  readVar('--cadle-canvas-ink') || readVar('--md-sys-color-on-surface') || fallbackInk
