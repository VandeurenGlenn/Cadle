/**
 * Canvas-paint tokens.
 *
 * Fabric paints to a 2D context, so it cannot read CSS variables directly —
 * we resolve them on the document root and hand the value back as a string.
 * Falls back to a neutral warm gray so canvas elements never render as harsh
 * pure black/white when the theme has not loaded yet.
 */
const fallbackInk = '#4a4a4a'

const readVar = (name: string): string => {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Subtle on-surface ink for measurement labels, dimensions, etc. */
export const canvasInk = (): string =>
  readVar('--cadle-canvas-ink') || readVar('--md-sys-color-on-surface') || fallbackInk

/** Background surface used for openings and canvas surfaces. */
export const canvasSurface = (): string =>
  readVar('--cadle-canvas-surface') ||
  readVar('--md-sys-color-surface') ||
  readVar('--md-sys-color-background') ||
  '#fff'

const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

export const invertColor = (color: string): string => {
  const hexMatch = color.match(/^#([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/)
  if (hexMatch) {
    let hex = hexMatch[1]
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((char) => char + char)
        .join('')
    }

    const value = parseInt(hex, 16)
    const r = 255 - ((value >> 16) & 0xff)
    const g = 255 - ((value >> 8) & 0xff)
    const b = 255 - (value & 0xff)
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
  }

  const rgbMatch = color.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/)
  if (rgbMatch) {
    const r = clamp(Number(rgbMatch[1]))
    const g = clamp(Number(rgbMatch[2]))
    const b = clamp(Number(rgbMatch[3]))
    const a = rgbMatch[4]
    const inverted = `rgb(${255 - r}, ${255 - g}, ${255 - b})`
    return a !== undefined ? `rgba(${255 - r}, ${255 - g}, ${255 - b}, ${a})` : inverted
  }

  if (color.toLowerCase() === 'transparent') return 'transparent'
  return '#fff'
}
