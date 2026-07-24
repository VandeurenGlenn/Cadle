export type PageCloneOptions = {
  includeWalls: boolean
  outsideWallsOnly: boolean
  includeOpenings: boolean
  includeElectrical: boolean
}

type UnknownRecord = Record<string, unknown>

const WALL_TYPES = new Set(['cadlewall', 'wall'])
const OPENING_TYPES = new Set(['cadledoor', 'door', 'cadlewindow', 'window', 'cadlegate', 'gate'])
const ELECTRICAL_TYPE_HINTS = ['switch', 'load', 'socket', 'outlet', 'electrical', 'lighting', 'lamp', 'motor']
const OUTSIDE_KEYS = ['isOutside', 'outside', 'outsideWall', 'isExterior', 'external', 'exterior']

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value && typeof value === 'object')

const asLowerString = (value: unknown): string => (typeof value === 'string' ? value.toLowerCase() : '')

const hasOutsideFlag = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  for (const key of OUTSIDE_KEYS) {
    const candidate = value[key]
    if (candidate === true) return true
    if (typeof candidate === 'string' && candidate.toLowerCase() === 'true') return true
  }
  return false
}

const textHasElectricalHints = (value: string): boolean => ELECTRICAL_TYPE_HINTS.some((hint) => value.includes(hint))

const isElectricalLike = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  const role = asLowerString(value.role)
  const bindingRole = asLowerString(value.bindingRole)
  if (role || bindingRole) {
    const candidate = role || bindingRole
    if (candidate === 'switch' || candidate === 'load' || candidate === 'protection' || candidate === 'junction')
      return true
  }

  if (isRecord(value.electrical)) return true

  const searchable = [
    asLowerString(value.type),
    asLowerString(value.name),
    asLowerString(value.symbolName),
    asLowerString(value.symbolPath),
    asLowerString(value.path)
  ]
    .filter(Boolean)
    .join(' ')

  return searchable.length > 0 && textHasElectricalHints(searchable)
}

const isWallLike = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  return WALL_TYPES.has(asLowerString(value.type)) || asLowerString(value.kind) === 'wall'
}

const isOpeningLike = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  const type = asLowerString(value.type)
  const kind = asLowerString(value.kind)
  return OPENING_TYPES.has(type) || kind === 'door' || kind === 'window' || kind === 'gate'
}

const shouldKeepByOptions = (value: unknown, options: PageCloneOptions, outsideWallsKnown: boolean): boolean => {
  const wall = isWallLike(value)
  if (wall) {
    if (!options.includeWalls) return false
    if (!options.outsideWallsOnly) return true
    return outsideWallsKnown ? hasOutsideFlag(value) : true
  }

  const opening = isOpeningLike(value)
  if (opening) return options.includeOpenings

  if (isElectricalLike(value)) return options.includeElectrical

  return false
}

const cloneFilteredNativePayload = (payload: UnknownRecord, options: PageCloneOptions): UnknownRecord => {
  const shapes = Array.isArray(payload.shapes) ? payload.shapes : []
  const outsideWallsKnown = shapes.some((shape) => isWallLike(shape) && hasOutsideFlag(shape))
  const filteredShapes = shapes.filter((shape) => shouldKeepByOptions(shape, options, outsideWallsKnown))
  const selectedId = typeof payload.selectedId === 'string' ? payload.selectedId : null
  const selectedStillExists = selectedId
    ? filteredShapes.some((shape) => isRecord(shape) && shape.id === selectedId)
    : false

  return {
    ...payload,
    shapes: structuredClone(filteredShapes),
    selectedId: selectedStillExists ? payload.selectedId : null
  }
}

const cloneFilteredSchemaObjects = (objects: unknown[], options: PageCloneOptions): unknown[] => {
  const outsideWallsKnown = objects.some((object) => isWallLike(object) && hasOutsideFlag(object))
  return objects.filter((object) => shouldKeepByOptions(object, options, outsideWallsKnown))
}

export const clonePageSchema = (schema: { version?: string; objects?: unknown[] }, options: PageCloneOptions) => {
  const version = schema?.version ?? '6.0.0'
  const objects = Array.isArray(schema?.objects) ? schema.objects : []

  const clonedObjects = objects.map((object) => {
    if (!isRecord(object)) return object
    if (object.kind !== 'cadle-native-svg-document' || !isRecord(object.payload)) return object
    return {
      ...object,
      payload: cloneFilteredNativePayload(object.payload, options)
    }
  })

  const hasNativeEnvelope = clonedObjects.some(
    (object) => isRecord(object) && object.kind === 'cadle-native-svg-document' && isRecord(object.payload)
  )

  if (hasNativeEnvelope) return structuredClone({ version, objects: clonedObjects })

  const filtered = cloneFilteredSchemaObjects(objects, options)
  return structuredClone({ version, objects: filtered })
}
