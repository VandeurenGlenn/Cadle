import type { SymbolShape } from '../model/types.js'
import { oneWireProtectionBodyEdges, oneWireSymbolBounds, oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'
import { PAPER_WORLD_UNITS_PER_MM } from '../constants.js'
import { paperTextLineHeight, paperTextWidth, wrapPaperText } from './paper-text-layout.js'

export const PROTECTION_TEXT_SIZE = 2.5 * PAPER_WORLD_UNITS_PER_MM
export const PROTECTION_TEXT_WEIGHT = 400
export const PROTECTION_FONT_FAMILY = "'IBM Plex Sans','Segoe UI',sans-serif"

// Descriptions and technical values share the same columns beside a device.
export const protectionLabelLayout = (shape: SymbolShape) => {
  const terminals = oneWireSymbolTerminalInfo(shape.path, shape.scale)
  const bounds = oneWireSymbolBounds({ ...shape, rotation: 0 })
  if (!bounds || !terminals?.top || !terminals.bottom) return null
  const axisX = shape.position.x + terminals.bottom.x
  // The source SVG reserves a wide area for its old embedded labels. Place
  // external values beside the actual switching body, excluding that whitespace.
  const body = oneWireProtectionBodyEdges(shape) ?? { leftX: bounds.x, rightX: bounds.x + bounds.width }
  return {
    axisX,
    centerY: shape.position.y + (terminals.top.y + terminals.bottom.y) / 2,
    bottomY: shape.position.y + terminals.bottom.y,
    rightX: body.rightX + 10,
    leftX: body.leftX - 8
  }
}

export const protectionDescriptionLayout = (shape: SymbolShape) => {
  const layout = protectionLabelLayout(shape)
  if (!layout) return null
  const residual = /residual-current circuit breaker\.svg$/i.test(shape.path)
  const lines = wrapPaperText(shape.symbolTextOverrides?.description ?? '', PROTECTION_TEXT_SIZE)
  return { x: layout.rightX, y: layout.centerY + (residual ? 40 : 29), lines,
    lineHeight: paperTextLineHeight(PROTECTION_TEXT_SIZE) }
}

export const protectionPhaseLabelLayout = (shape: SymbolShape) => {
  const layout = protectionLabelLayout(shape)
  if (!layout) return null
  const residual = /residual-current circuit breaker\.svg$/i.test(shape.path)
  const description = shape.symbolTextOverrides?.description ? protectionDescriptionLayout(shape) : null
  return {
    x: layout.rightX,
    y: Math.max(layout.centerY + (residual ? 40 : 33), description
      ? description.y + Math.max(0, description.lines.length - 1) * description.lineHeight + 28 : 0)
  }
}

/** Include the text beside the body when packing or centering a diagram. */
export const protectionAnnotationBounds = (shape: SymbolShape) => {
  const layout = protectionAnnotationLayout(shape)
  if (!layout) return null
  const rcd = /residual-current circuit breaker\.svg$/i.test(shape.path)
  const values = shape.symbolTextOverrides ?? {}
  const points: Array<{ x: number; y: number }> = []
  const add = (text: string, point: { x: number; y: number }, end = false, size = PROTECTION_TEXT_SIZE) => {
    if (!text) return
    const width = paperTextWidth(text, size), x = point.x - (end ? width : 0)
    points.push({ x, y: point.y - size }, { x: x + width, y: point.y - size },
      { x, y: point.y + size * 0.2 }, { x: x + width, y: point.y + size * 0.2 })
  }
  add(values.poles ?? values['desc:nP'] ?? 'nP', layout.poles, true)
  const current = values['rated-current'] ?? values[rcd ? 'desc:40A' : 'desc:20A'] ?? (rcd ? '40A' : '20A')
  add([current, rcd ? values['rcd-type'] ?? 'Type A' : ''].filter(Boolean).join('  '), layout.current)
  if (rcd) add(`ΔI ${values['residual-current'] ?? values['desc:300mA'] ?? '300mA'}`, layout.residual, false, PROTECTION_TEXT_SIZE * 1.2)
  add(values.phase ?? values['desc:n'] ?? 'n', layout.phase)
  layout.description.lines.forEach((line, index) => add(line, {
    x: layout.description.x, y: layout.description.y + index * layout.description.lineHeight
  }))
  if (!points.length) return null
  const radians = (shape.rotation ?? 0) * Math.PI / 180
  const transformed = points.map((point) => {
    const x = (point.x - shape.position.x) * (shape.flipX ? -1 : 1)
    const y = (point.y - shape.position.y) * (shape.flipY ? -1 : 1)
    return { x: shape.position.x + x * Math.cos(radians) - y * Math.sin(radians),
      y: shape.position.y + x * Math.sin(radians) + y * Math.cos(radians) }
  })
  const x = Math.min(...transformed.map((point) => point.x)), y = Math.min(...transformed.map((point) => point.y))
  return { x, y, width: Math.max(...transformed.map((point) => point.x)) - x,
    height: Math.max(...transformed.map((point) => point.y)) - y }
}

export const protectionAnnotationLayout = (shape: SymbolShape) => {
  const layout = protectionLabelLayout(shape)
  if (!layout) return null
  const residual = /residual-current circuit breaker\.svg$/i.test(shape.path)
  return {
    poles: { x: layout.leftX, y: layout.centerY + 5 },
    current: { x: layout.rightX, y: layout.centerY + (residual ? 12 : 5) },
    residual: { x: layout.rightX, y: layout.centerY - 12 },
    type: { x: layout.rightX, y: layout.centerY + 12 },
    phase: protectionPhaseLabelLayout(shape)!,
    description: protectionDescriptionLayout(shape)!
  }
}
