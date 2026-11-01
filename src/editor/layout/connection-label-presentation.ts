import type { ElectricalConnection } from '../model/electrical-connection.js'
import { cableLabelText } from '../model/electrical-connection.js'
import type { Shape } from '../model/types.js'

/** Connection properties own their caption, including after regeneration. */
export const presentConnectionLabels = (shapes: readonly Shape[]): Shape[] => {
  const owners = new Map<string, ElectricalConnection>()
  const key = (shape: Shape, owner: string) => `${owner}:${shape.sourceLink?.kind}:${shape.sourceLink?.id}:${shape.oneWireRailId ?? ''}`
  for (const shape of shapes) {
    if (shape.kind !== 'line' || !shape.connection?.labelOwner || !shape.sourceLink) continue
    const ownerKey = key(shape, shape.connection.labelOwner)
    if (!owners.has(ownerKey) || shape.connection.name) owners.set(ownerKey, shape.connection)
  }
  return shapes.map((shape) => {
    if (shape.kind !== 'text') return shape
    const owner = shape.sourceLink?.role === 'cable-section' ? 'circuit'
      : shape.sourceLink?.role === 'incoming-cable-label' ? 'topology' : null
    if (!owner) return shape
    const connection = owners.get(key(shape, owner))
    if (!connection) return shape
    const text = connection.name?.trim() || (owner === 'topology'
      ? `${connection.conductors ?? 4}x${connection.sectionMm2 ?? 10} mm² ${connection.cableType?.replace('-', ' ') ?? ''}`.trim()
      : cableLabelText(connection))
    const hidden = connection.showLabel === false
    return shape.text === text && Boolean(shape.hidden) === hidden ? shape : { ...shape, text, hidden }
  })
}
