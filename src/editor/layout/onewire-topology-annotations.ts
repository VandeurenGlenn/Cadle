import type { Shape, SymbolShape, TextShape } from '../model/types.js'
import { oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'
import { protectionAnnotationBounds, protectionDescriptionLayout } from './protection-label-layout.js'
import { paperTextLineHeight, paperTextLinesForShape } from './paper-text-layout.js'
import { translateShape } from '../interaction/shape-transforms.js'

/** Grow the feeder's clear space when a device name or cable caption wraps. */
export const spaceOneWireTopologyAnnotations = (shapes: readonly Shape[]): Shape[] => {
  for (const device of shapes.filter((shape): shape is SymbolShape => shape.kind === 'symbol' &&
    Boolean(shape.sourceLink?.role.startsWith('additional-differential-')))) {
    if ((protectionDescriptionLayout(device)?.lines.length ?? 0) < 2) continue
    const role = device.sourceLink!.role
    const feed = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === `${role}-to-rail`)
    const outgoing = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === `${role}-outgoing`)
    const bounds = protectionAnnotationBounds(device)
    if (feed?.kind !== 'line' || !bounds) continue
    const dy = Math.min(0, feed.start.y - 24 - bounds.y - bounds.height)
    if (dy > -0.01) continue
    const loads = new Set(shapes.flatMap((shape) => {
      if (shape.kind !== 'symbol' || shape.sourceLink?.role !== 'ev-load' || outgoing?.kind !== 'line') return []
      const bottom = oneWireSymbolTerminalInfo(shape.path, shape.scale)?.bottom
      return bottom && Math.hypot(shape.position.x + bottom.x - outgoing.end.x, shape.position.y + bottom.y - outgoing.end.y) < 0.01 ? [shape.id] : []
    }))
    shapes = shapes.map((shape) => {
      if (shape === feed) return { ...shape, end: { ...shape.end, y: shape.end.y + dy } }
      return shape.sourceLink?.role === role || shape.sourceLink?.role.startsWith(`${role}-`) || loads.has(shape.id)
        ? translateShape(shape, 0, dy) : shape
    })
  }
  const device = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.sourceLink?.role === 'main-differential')
  const meter = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.sourceLink?.role === 'meter')
  const caption = shapes.find((shape): shape is TextShape => shape.kind === 'text' && shape.sourceLink?.role === 'incoming-cable-label' && !shape.hidden)
  if (!device || !meter) return [...shapes]
  const bottom = oneWireSymbolTerminalInfo(device.path, device.scale)?.bottom
  const top = oneWireSymbolTerminalInfo(meter.path, meter.scale)?.top
  const description = protectionDescriptionLayout(device)
  if (!bottom || !top || !description) return [...shapes]
  const lastNameY = description.y + Math.max(0, description.lines.length - 1) * description.lineHeight
  const captionY = Math.max(device.position.y + bottom.y + 40, lastNameY + 60)
  const captionSpan = caption ? (paperTextLinesForShape(caption).length - 1) * paperTextLineHeight(18 * (caption.scale ?? 1)) : 0
  const targetTop = caption ? captionY + captionSpan + 24 : Math.max(device.position.y + bottom.y + 40, lastNameY + 48)
  const dy = targetTop - meter.position.y - top.y
  const downstream = new Set(['meter', 'main-switch', 'main-switch-to-meter', 'grid-incoming'])
  return shapes.map((shape) => {
    const role = shape.sourceLink?.role
    if (!role || shape.sourceLink?.id !== device.sourceLink?.id) return shape
    if (shape === caption) return { ...shape, position: { ...shape.position, y: captionY } }
    if (shape.kind === 'line' && role === 'incoming') return { ...shape, start: { ...shape.start, y: targetTop } }
    return downstream.has(role) && Math.abs(dy) > 0.01 ? translateShape(shape, 0, dy) : shape
  })
}
