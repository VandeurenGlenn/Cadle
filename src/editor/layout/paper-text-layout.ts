import type { TextShape } from '../model/types.js'
import { PAPER_WORLD_UNITS_PER_MM } from '../constants.js'

export const PAPER_TEXT_MAX_WIDTH = 36 * PAPER_WORLD_UNITS_PER_MM
export const paperTextWidth = (text: string, size: number) => text.length * size * 0.68
export const paperTextLineHeight = (size: number) => size * 1.3

/** Deterministic paper layout, shared by editing, packing and every export. */
export const wrapPaperText = (value: string, size: number, maxWidth = PAPER_TEXT_MAX_WIDTH): string[] => {
  const limit = Math.max(1, Math.floor(maxWidth / (size * 0.68)))
  return value.split(/\r?\n/).flatMap((paragraph) => {
    const lines: string[] = []
    let current = ''
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (current && current.length + word.length + 1 > limit) { lines.push(current); current = '' }
      let rest = word
      while (rest.length > limit) { lines.push(rest.slice(0, limit)); rest = rest.slice(limit) }
      current = current ? `${current} ${rest}` : rest
    }
    return [...lines, current].filter(Boolean)
  })
}

export const paperTextLinesForShape = (shape: TextShape): string[] => {
  const wrap = shape.sourceLink?.role === 'cable-section' || shape.sourceLink?.role === 'incoming-cable-label'
  const lines = wrap ? wrapPaperText(shape.text, 18 * (shape.scale ?? 1)) : shape.text.split(/\r?\n/)
  return lines.length ? lines : ['']
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export const paperTextContentMarkup = (shape: TextShape): string => {
  const lines = paperTextLinesForShape(shape)
  if (lines.length === 1) return escape(lines[0])
  const height = paperTextLineHeight(18 * (shape.scale ?? 1))
  return lines.map((line, index) => `<tspan x="${shape.position.x}" y="${shape.position.y + index * height}">${escape(line)}${index < lines.length - 1 ? ' ' : ''}</tspan>`).join('')
}

export const paperTextBounds = (shape: TextShape) => {
  const size = 18 * (shape.scale ?? 1)
  const lines = paperTextLinesForShape(shape)
  const width = Math.max(...lines.map((line) => paperTextWidth(line, size)))
  const x = shape.textAnchor === 'middle' ? -width / 2 : shape.textAnchor === 'end' ? -width : 0
  const top = -size, bottom = (lines.length - 1) * paperTextLineHeight(size) + size * 0.2
  const radians = (shape.rotation ?? 0) * Math.PI / 180
  const points = [{ x, y: top }, { x: x + width, y: top }, { x, y: bottom }, { x: x + width, y: bottom }]
    .map(({ x, y }) => ({ x: x * (shape.flipX ? -1 : 1), y: y * (shape.flipY ? -1 : 1) }))
    .map(({ x, y }) => ({ x: shape.position.x + x * Math.cos(radians) - y * Math.sin(radians),
      y: shape.position.y + x * Math.sin(radians) + y * Math.cos(radians) }))
  const left = Math.min(...points.map(({ x }) => x)), right = Math.max(...points.map(({ x }) => x))
  const y = Math.min(...points.map(({ y }) => y)), endY = Math.max(...points.map(({ y }) => y))
  return { x: left, y, width: right - left, height: endY - y }
}
