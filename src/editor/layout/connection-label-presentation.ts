import type { ElectricalConnection } from '../model/electrical-connection.js'
import { cableLabelText, withCableFireClass } from '../model/cable-designation.js'
import type { Shape } from '../model/types.js'

export const meterCableLabel = (
  cable?: Pick<ElectricalConnection, 'conductors' | 'sectionMm2' | 'cableType' | 'fireClass'>
) => cable?.conductors && cable.sectionMm2 && cable.cableType && cable.cableType !== 'none'
  ? cableLabelText(cable, 'x') : 'Meter-kastkabel:\nnog op te geven'

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
      : shape.sourceLink?.role === 'incoming-cable-label' ? 'topology'
      : shape.sourceLink?.role === 'meter-cable-label' ? 'meter'
      : shape.sourceLink?.role === 'solar-cable-label' ? 'solar'
      : shape.sourceLink?.role === 'solar-ac-cable-label' ? 'solar-installation' : null
    if (!owner) return shape
    const connection = owners.get(key(shape, owner))
    if (!connection) return shape
    const text = connection.name?.trim() ? withCableFireClass(connection.name.trim(), connection.fireClass)
      : shape.sourceLink?.role === 'meter-cable-label' ? meterCableLabel(connection)
      : owner === 'solar' ? `PV-kabel:\n${connection.conductors && connection.sectionMm2 && connection.cableType && connection.cableType !== 'none'
        ? cableLabelText(connection) : 'nog op te geven'}`
      : owner === 'solar-installation' ? `PV-kabel AC:\n${connection.conductors && connection.sectionMm2
        ? cableLabelText(connection) : 'nog op te geven'}`
      : owner === 'topology' ? cableLabelText(connection, 'x') : cableLabelText(connection)
    const hidden = connection.showLabel === false
    return shape.text === text && Boolean(shape.hidden) === hidden ? shape : { ...shape, text, hidden }
  })
}
