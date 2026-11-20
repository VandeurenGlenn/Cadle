import type { Shape, SymbolShape, TextShape } from '../model/types.js'
import { oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'
import { protectionAnnotationBounds, protectionDescriptionLayout } from './protection-label-layout.js'
import { paperTextLineHeight, paperTextLinesForShape } from './paper-text-layout.js'
import { translateShape } from '../interaction/shape-transforms.js'

export const placeOneWireIncomingCable = (input: readonly Shape[]): { shapes: Shape[]; changed: boolean } => {
  let shapes = [...input], changed = false
  for (const device of input.filter((shape): shape is SymbolShape =>
    shape.kind === 'symbol' && shape.sourceLink?.role === 'main-switch' && Boolean(shape.generationKey))) {
    const belongs = (shape: Shape) => shape.groupId === device.groupId &&
      shape.sourceLink?.kind === 'board' && shape.sourceLink.id === device.sourceLink?.id
    const feeder = shapes.find((shape) => belongs(shape) && shape.kind === 'line' && shape.sourceLink?.role === 'grid-incoming')
    const oldIncoming = shapes.find((shape) => belongs(shape) && shape.kind === 'line' &&
      shape.sourceLink?.role === 'incoming' && shape.connection?.labelOwner === 'topology')
    const caption = shapes.find((shape): shape is TextShape => belongs(shape) && shape.kind === 'text' &&
      shape.sourceLink?.role === 'incoming-cable-label')
    const voltage = shapes.find((shape): shape is TextShape => belongs(shape) && shape.kind === 'text' &&
      shape.sourceLink?.role === 'grid-voltage-label')
    const bottom = oneWireSymbolTerminalInfo(device.path, device.scale)?.bottom
    const description = protectionDescriptionLayout(device)
    if (feeder?.kind !== 'line' || !bottom || !description) continue
    if (!caption && !oldIncoming && feeder.connection?.labelOwner !== 'topology' && !voltage) continue
    let connection = feeder.connection
    if (oldIncoming?.kind === 'line' && oldIncoming.connection) {
      const { via: _via, ...legacy } = oldIncoming.connection
      connection = { ...legacy, ...connection, kind: 'cable', labelOwner: 'topology',
        ...(legacy.name !== undefined ? { name: legacy.name } : {}),
        ...(legacy.showLabel !== undefined ? { showLabel: legacy.showLabel } : {}),
        ...(legacy.offsetMm !== undefined ? { offsetMm: legacy.offsetMm } : {}) }
    }
    const lastNameY = description.y + Math.max(0, description.lines.length - 1) * description.lineHeight
    const voltageY = Math.max(device.position.y + bottom.y + 4, lastNameY + 20)
    const voltageSpan = voltage ? (paperTextLinesForShape(voltage).length - 1) *
      paperTextLineHeight(18 * (voltage.scale ?? 1)) : 0
    const captionY = Math.max(device.position.y + bottom.y + 40, lastNameY + 60,
      voltage ? voltageY + voltageSpan + 16 : 0)
    const captionSpan = caption ? (paperTextLinesForShape(caption).length - 1) * paperTextLineHeight(18 * (caption.scale ?? 1)) : 0
    const endY = caption && !caption.hidden && connection?.showLabel !== false
      ? captionY + captionSpan + 24
      : voltage && !voltage.hidden ? Math.max(device.position.y + bottom.y + 36, voltageY + voltageSpan + 24)
        : device.position.y + bottom.y + 36
    shapes = shapes.map((shape) => {
      if (shape === oldIncoming && shape.kind === 'line') {
        changed = true
        return { ...shape, connection: { kind: 'wire', showLabel: false } }
      }
      if (shape === feeder && shape.kind === 'line' && (connection !== shape.connection || Math.abs(shape.end.y - endY) > 0.01)) {
        changed = true
        return { ...shape, connection, end: { ...shape.end, y: endY } }
      }
      if (shape === caption && shape.kind === 'text' && (Math.abs(shape.position.x - feeder.start.x - 24) > 0.01 ||
        Math.abs(shape.position.y - captionY) > 0.01)) {
        changed = true
        return { ...shape, position: { x: feeder.start.x + 24, y: captionY } }
      }
      if (shape === voltage && shape.kind === 'text' && (Math.abs(shape.position.x - feeder.start.x - 24) > 0.01 ||
        Math.abs(shape.position.y - voltageY) > 0.01)) {
        changed = true
        return { ...shape, position: { x: feeder.start.x + 24, y: voltageY } }
      }
      return shape
    })
  }
  return { shapes, changed }
}

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
  if (!device || !meter) return placeOneWireIncomingCable(shapes).shapes
  const bottom = oneWireSymbolTerminalInfo(device.path, device.scale)?.bottom
  const top = oneWireSymbolTerminalInfo(meter.path, meter.scale)?.top
  const description = protectionDescriptionLayout(device)
  if (!bottom || !top || !description) return placeOneWireIncomingCable(shapes).shapes
  const lastNameY = description.y + Math.max(0, description.lines.length - 1) * description.lineHeight
  const meterCaption = shapes.find((shape): shape is TextShape => shape.kind === 'text' &&
    shape.groupId === device.groupId && shape.sourceLink?.role === 'meter-cable-label')
  const captionY = Math.max(device.position.y + bottom.y + 40, lastNameY + 48)
  const captionSpan = meterCaption
    ? (paperTextLinesForShape(meterCaption).length - 1) * paperTextLineHeight(18 * (meterCaption.scale ?? 1)) : 0
  const targetTop = meterCaption && !meterCaption.hidden ? captionY + captionSpan + 36 : captionY
  const dy = targetTop - meter.position.y - top.y
  const downstream = new Set(['meter', 'main-switch', 'main-switch-to-meter', 'grid-incoming'])
  return placeOneWireIncomingCable(shapes.map((shape) => {
    const role = shape.sourceLink?.role
    if (!role || shape.sourceLink?.id !== device.sourceLink?.id) return shape
    if (shape === meterCaption) return { ...meterCaption, position: { x: meter.position.x + top.x + 24, y: captionY } }
    if (shape.kind === 'line' && role === 'incoming') return { ...shape, start: { ...shape.start, y: targetTop } }
    return downstream.has(role) && Math.abs(dy) > 0.01 ? translateShape(shape, 0, dy) : shape
  })).shapes
}
