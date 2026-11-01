import type { Shape, SymbolShape } from '../model/types.js'

const legacyDeviceRoles: Record<string, string> = {
  'main-differential-title': 'main-differential',
  'main-switch-title': 'main-switch',
  'residual-breaker-label': 'residual-breaker'
}

// Only generated captions are absorbed; independent drawing text stays editable.
export const migrateProtectionDescriptions = (shapes: Shape[]): Shape[] => {
  const devices = new Map(shapes.flatMap((shape) =>
    shape.kind === 'symbol' && shape.sourceLink?.role && /^board:main:topology:/.test(shape.generationKey ?? '')
      ? [[`${shape.groupId}:${shape.sourceLink.role}`, shape] as const] : []))
  return shapes.filter((shape) => {
    const role = shape.sourceLink?.role && legacyDeviceRoles[shape.sourceLink.role]
    if (shape.kind !== 'text' || !role || !/^board:main:topology:/.test(shape.generationKey ?? '')) return true
    const device = devices.get(`${shape.groupId}:${role}`)
    if (!device) return true
    device.symbolTextOverrides = {
      ...device.symbolTextOverrides,
      description: device.symbolTextOverrides?.description ?? shape.text
    }
    return false
  })
}

export const oneWireTopologyDescriptions = (shapes: readonly Shape[]): Record<string, string> => {
  const migrated = migrateProtectionDescriptions(shapes.map((shape) => shape.kind === 'symbol'
    ? { ...shape, symbolTextOverrides: { ...shape.symbolTextOverrides } } : shape))
  return Object.fromEntries(migrated.flatMap((shape) =>
    shape.kind === 'symbol' && shape.sourceLink?.role && /^board:main:topology:/.test(shape.generationKey ?? '') &&
      typeof shape.symbolTextOverrides?.description === 'string'
      ? [[shape.sourceLink.role, shape.symbolTextOverrides.description]] : []))
}

export const setProtectionDescription = (shape: SymbolShape, description: string) => {
  shape.symbolTextOverrides = { ...shape.symbolTextOverrides, description }
}
