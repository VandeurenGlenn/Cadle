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
import CadleWall from './../../symbols/wall.js'
import CadleDoor from './../../symbols/door.js'
import CadleWindow from './../../symbols/window.js'
import CadleGate from './../../symbols/gate.js'

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
  'symbolName',
  'symbolPath',
  'oneLineEligible',
  'situationElementType',
  'situationMetadata',
  'sourceObjectUuid',
  'themeSourceFill',
  'themeSourceStroke'
] as const

/**
 * Subset of the above that we re-apply explicitly after `loadFromJSON` as a
 * safety net. `situationMetadata` is intentionally omitted to mirror the
 * original behavior.
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
  'symbolName',
  'symbolPath',
  'oneLineEligible',
  'situationElementType',
  'sourceObjectUuid',
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
function normalizeLegacyType(obj: any) {
  const type = String(obj.type ?? '').toLowerCase()
  if (type === 'wall' || type === 'cadlewall') obj.type = 'CadleWall'
  else if (type === 'door' || type === 'cadledoor') obj.type = 'CadleDoor'
  else if (type === 'window' || type === 'cadlewindow') obj.type = 'CadleWindow'
  else if (type === 'gate' || type === 'cadlegate') obj.type = 'CadleGate'
}

export type PartitionedObjects = {
  /** Standard Fabric objects that `loadFromJSON` can handle. */
  standard: any[]
  /** Cadle-specific objects we instantiate manually. */
  specials: any[]
}

/**
 * Walk the raw JSON object list and split it into the "standard" objects
 * that Fabric can hydrate via `loadFromJSON` and the "specials" that we need
 * to manually instantiate as `CadleWall` / `CadleDoor` / `CadleWindow` /
 * `CadleGate`. Mutates entries in place to normalize legacy type names.
 */
export function partitionRawObjects(rawObjects: any[]): PartitionedObjects {
  const standard: any[] = []
  const specials: any[] = []

  for (const obj of rawObjects) {
    if (!obj) continue
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

    normalizeLegacyType(obj)

    if (!obj) console.log(obj)
  }
  return { standard, specials }
}

/**
 * Re-apply binding + symbol metadata onto loaded canvas objects in case the
 * Fabric subclass constructor stripped unknown keys. Pairs `loaded[i]` with
 * `serialized[i]`; only sets a property when the loaded object doesn't
 * already have a value for it.
 */
export function reapplyBindingProps(serialized: any[], loaded: any[]) {
  const pairCount = Math.min(serialized.length, loaded.length)
  for (let i = 0; i < pairCount; i++) {
    const src = serialized[i]
    const dest = loaded[i] as any
    if (!src || !dest) continue
    for (const prop of RE_APPLY_PROPS) {
      if (src[prop] !== undefined && (dest[prop] === undefined || dest[prop] === null)) {
        dest[prop] = src[prop]
      }
    }
  }
}

/**
 * Add the manually-instantiated specials to the canvas. Returns the count
 * added so the caller can decide whether to render.
 */
export function instantiateSpecials(canvas: Canvas, specials: any[]): number {
  let added = 0
  for (const obj of specials) {
    if (obj.type === 'CadleWall') {
      canvas.add(new CadleWall(obj) as any)
      added += 1
    } else if (obj.type === 'CadleDoor') {
      canvas.add(new CadleDoor(obj) as any)
      added += 1
    } else if (obj.type === 'CadleWindow') {
      canvas.add(new CadleWindow(obj) as any)
      added += 1
    } else if (obj.type === 'CadleGate') {
      canvas.add(new CadleGate(obj) as any)
      added += 1
    }
  }
  return added
}
