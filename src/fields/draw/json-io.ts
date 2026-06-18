// JSON load/save helpers extracted from `src/fields/draw.ts`.
//
// The orchestrating `toJSON` / `fromJSON` methods stay on `DrawField` because
// they touch the canvas + dispatch events + drive history. This module only
// owns the pure conversion concerns:
//
//  - The list of binding/symbol props that travel through serialization.
//  - The legacy → CadleX type-name normalization.
//  - The "specials" partition (objects we instantiate manually because Fabric
//    doesn't know about CadleWall / CadleDoor / CadleWindow / CadleGate).
//  - Instantiating those specials and adding them to a canvas.
//
// Behavior MUST stay identical to the original inlined implementation.
import type { Canvas } from './../../fabric-imports.js'
import type { FabricObject } from 'fabric'
import type { JsonValue } from '../../types.js'
import CadleWall from './../../symbols/wall.js'
import CadleDoor from './../../symbols/door.js'
import CadleWindow from './../../symbols/window.js'
import CadleGate from './../../symbols/gate.js'

export type SerializedObject = Record<string, JsonValue> & {
  type?: string
}

/**
 * Custom properties that must travel through `toJSON` / `fromJSON`. Fabric
 * strips unknown keys by default, so we include them on both sides.
 */
export const BINDING_AND_SYMBOL_PROPS = [
  'bindingId',
  'bindingLabel',
  'bindingRole',
  'bindingLabelOffset',
  'bindingGroupWireSection',
  'bindingGroupBreakerAmperage',
  'bindingGroupWireSectionOverride',
  'bindingGroupCableLengthMeters',
  'bindingGroupUpstreamProtectionA',
  'breakerAmperageA',
  'breakerShortCircuitKA',
  'breakerCurve',
  'breakerPoles',
  'breakerLabel',
  'rcdResidualCurrentMa',
  'rcdType',
  'symbolName',
  'symbolPath',
  'oneLineEligible',
  'situationElementType',
  'situationMetadata',
  'sourceObjectUuid',
  'oneWireNodeRole',
  'oneWireSnap',
  'oneWireSnapPorts',
  'themeSourceFill',
  'themeSourceStroke'
] as const

/**
 * Subset of the above that we re-apply explicitly after `loadFromJSON` as a
 * safety net. This restores symbol and binding metadata that Fabric may drop
 * during subclass hydration.
 */
const RE_APPLY_PROPS = [
  'bindingId',
  'bindingLabel',
  'bindingRole',
  'bindingLabelOffset',
  'bindingGroupWireSection',
  'bindingGroupBreakerAmperage',
  'bindingGroupWireSectionOverride',
  'bindingGroupCableLengthMeters',
  'bindingGroupUpstreamProtectionA',
  'breakerAmperageA',
  'breakerShortCircuitKA',
  'breakerCurve',
  'breakerPoles',
  'breakerLabel',
  'rcdResidualCurrentMa',
  'rcdType',
  'symbolName',
  'symbolPath',
  'oneLineEligible',
  'situationElementType',
  'situationMetadata',
  'sourceObjectUuid',
  'oneWireNodeRole',
  'oneWireSnap',
  'oneWireSnapPorts',
  'themeSourceFill',
  'themeSourceStroke'
] as const

const CADLE_TYPES = new Set([
  'wall',
  'door',
  'window',
  'gate',
  'CadleWall',
  'CadleWidth',
  'CadleDepth',
  'CadleWindow',
  'CadleDoor',
  'CadleGate'
])

/**
 * Normalize legacy `wall`/`door`/etc. type strings to their current
 * `CadleX` equivalents. Mutates the object in place to match the original
 * inlined behavior.
 */
function normalizeLegacyType(obj: SerializedObject) {
  const type = String(obj.type ?? '').toLowerCase()
  if (type === 'wall' || type === 'cadlewall') obj.type = 'CadleWall'
  else if (type === 'door' || type === 'cadledoor') obj.type = 'CadleDoor'
  else if (type === 'window' || type === 'cadlewindow') obj.type = 'CadleWindow'
  else if (type === 'gate' || type === 'cadlegate') obj.type = 'CadleGate'
}

function normalizeLegacyTypes(obj: SerializedObject) {
  normalizeLegacyType(obj)

  const nested = obj as { _objects?: SerializedObject[]; objects?: SerializedObject[] }
  if (Array.isArray(nested._objects)) {
    nested._objects.forEach((child) => {
      if (child && typeof child === 'object') normalizeLegacyTypes(child)
    })
  }

  if (Array.isArray(nested.objects)) {
    nested.objects.forEach((child) => {
      if (child && typeof child === 'object') normalizeLegacyTypes(child)
    })
  }
}

export type PartitionedObjects = {
  /** Standard Fabric objects that `loadFromJSON` can handle. */
  standard: SerializedObject[]
  /** Cadle-specific objects we instantiate manually. */
  specials: SerializedObject[]
}

/**
 * Walk the raw JSON object list and split it into the "standard" objects
 * that Fabric can hydrate via `loadFromJSON` and the "specials" that we need
 * to manually instantiate as `CadleWall` / `CadleDoor` / `CadleWindow` /
 * `CadleGate`. Mutates entries in place to normalize legacy type names.
 */
export function partitionRawObjects(rawObjects: SerializedObject[]): PartitionedObjects {
  const standard: SerializedObject[] = []
  const specials: SerializedObject[] = []

  for (const obj of rawObjects) {
    if (!obj) continue

    normalizeLegacyTypes(obj)

    if (CADLE_TYPES.has(obj.type)) {
      specials.push(obj)
    } else if (obj.type) {
      // Old data sometimes had negative-radius circles that Fabric chokes
      // on; preserve the original guard.
      if (!String(obj.radius).startsWith('-')) {
        standard.push(obj)
      }
    }

    if (!obj.type) {
      obj.type = 'CadleWall'
      specials.push(obj)
    }
  }
  return { standard, specials }
}

/**
 * Re-apply binding + symbol metadata onto loaded canvas objects in case the
 * Fabric subclass constructor stripped unknown keys. Pairs `loaded[i]` with
 * `serialized[i]` and recursively restores nested properties from groups.
 */
function reapplyBindingPropsToNestedObjects(
  serialized: SerializedObject[] | undefined,
  loaded: Array<FabricObject | undefined> | undefined
) {
  if (!Array.isArray(serialized) || !Array.isArray(loaded)) return

  const pairCount = Math.min(serialized.length, loaded.length)
  for (let i = 0; i < pairCount; i++) {
    const src = serialized[i]
    const dest = loaded[i]
    if (!src || !dest) continue
    reapplyBindingPropsToObject(src, dest)
  }
}

function reapplyBindingPropsToObject(src: SerializedObject, dest: FabricObject) {
  const recordDest = dest as FabricObject & Record<string, JsonValue | undefined>
  const nestedSrc = src as { _objects?: SerializedObject[]; objects?: SerializedObject[] }
  const nestedDest = dest as { _objects?: Array<FabricObject | undefined>; objects?: Array<FabricObject | undefined> }

  for (const prop of RE_APPLY_PROPS) {
    if (src[prop] !== undefined) {
      recordDest[prop] = src[prop]
    }
  }

  reapplyBindingPropsToNestedObjects(nestedSrc._objects, nestedDest._objects)
  reapplyBindingPropsToNestedObjects(nestedSrc.objects, nestedDest.objects)
}

export function reapplyBindingProps(serialized: SerializedObject[], loaded: FabricObject[]) {
  reapplyBindingPropsToNestedObjects(serialized, loaded)
}

/**
 * Add the manually-instantiated specials to the canvas. Returns the count
 * added so the caller can decide whether to render.
 */
export function instantiateSpecials(canvas: Canvas, specials: SerializedObject[]): number {
  let added = 0
  for (const obj of specials) {
    if (obj.type === 'CadleWall') {
      canvas.add(new CadleWall(obj) as FabricObject)
      added += 1
    } else if (obj.type === 'CadleDoor') {
      canvas.add(new CadleDoor(obj) as FabricObject)
      added += 1
    } else if (obj.type === 'CadleWindow') {
      canvas.add(new CadleWindow(obj) as FabricObject)
      added += 1
    } else if (obj.type === 'CadleGate') {
      canvas.add(new CadleGate(obj) as FabricObject)
      added += 1
    }
  }
  return added
}
