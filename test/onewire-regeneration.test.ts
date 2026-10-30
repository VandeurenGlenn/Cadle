import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isOneWireRailShape,
  partitionOneWireRegenerationShapes,
  reconcileGeneratedOneWire
} from '../src/editor/layout/onewire-regeneration.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { migrateOneWireCircuitGeometry } from '../src/editor/layout/onewire-circuit-migration.ts'
import { buildKamrailCircuitBundle, type BuildKamrailCircuitBundleInput } from '../src/editor/layout/onewire-helpers.ts'
import {
  oneWireSymbolNodeInfo,
  oneWireSymbolScaleFor,
  oneWireSymbolTerminalInfo
} from '../src/editor/layout/onewire-symbol-nodes.ts'

const generatedSymbol = (id: string, key: string, x: number): Shape => ({
  id,
  kind: 'symbol',
  position: { x, y: 100 },
  name: 'Load',
  path: 'load.svg',
  scale: 1,
  generationKey: key,
  sourceLink: { kind: 'device', id: 'floor-device-1', role: 'load' }
})

test('recognizes current and legacy generated rails without treating the topology bus as a kamrail', () => {
  const currentRail: Shape = {
    id: 'current-rail',
    kind: 'line',
    start: { x: 0, y: 100 },
    end: { x: 500, y: 100 },
    groupId: 'onewire-kamrail-current'
  }
  const legacyRail: Shape = {
    id: 'legacy-rail',
    kind: 'line',
    start: { x: 0, y: 200 },
    end: { x: 500, y: 200 },
    generationKey: 'board:main:rail:rail-1',
    sourceLink: { kind: 'board', id: 'main', role: 'rail:main:rail-1' }
  }
  const topologyBus: Shape = {
    id: 'topology-bus',
    kind: 'line',
    start: { x: 0, y: 300 },
    end: { x: 500, y: 300 },
    generationKey: 'board:main:topology:bus',
    sourceLink: { kind: 'board', id: 'main', role: 'topology:bus' }
  }

  assert.equal(isOneWireRailShape(currentRail), true)
  assert.equal(isOneWireRailShape(legacyRail), true)
  assert.equal(isOneWireRailShape(topologyBus), false)
})

test('retains manually composed one-wire shapes during automatic regeneration', () => {
  const manual: Shape = {
    id: 'manual-switch',
    kind: 'symbol',
    position: { x: 200, y: 200 },
    name: 'Switch',
    path: 'switch.svg',
    scale: 1,
    groupId: 'onewire-manual-a'
  }
  const generated = generatedSymbol('generated-load', 'device:floor-device-1', 440)

  const result = partitionOneWireRegenerationShapes([manual, generated])

  assert.deepEqual(
    result.retained.map((shape) => shape.id),
    ['manual-switch']
  )
  assert.deepEqual(
    result.generated.map((shape) => shape.id),
    ['generated-load']
  )
})

test('recomputes generated geometry while preserving stable identity', () => {
  const previous = generatedSymbol('old-id', 'device:floor-device-1', 440)
  const fresh = generatedSymbol('new-id', 'device:floor-device-1', 120)
  const result = reconcileGeneratedOneWire([previous], [fresh])
  assert.equal(result.preserved, 1)
  assert.deepEqual(result.shapes[0].kind === 'symbol' ? result.shapes[0].position : null, { x: 120, y: 100 })
  assert.equal(result.shapes[0].id, 'old-id')
})

test('shrinks a preserved busbar to the freshly generated family span', () => {
  const previous: Shape = {
    id: 'existing-rail',
    kind: 'line',
    start: { x: 600, y: 700 },
    end: { x: 1400, y: 700 },
    stroke: '#111111',
    strokeWidth: 10,
    generationKey: 'board:main:rail:0'
  }
  const fresh: Shape = {
    ...previous,
    id: 'fresh-rail',
    start: { x: 780, y: 700 },
    end: { x: 1220, y: 700 }
  }

  const result = reconcileGeneratedOneWire([previous], [fresh])

  assert.equal(result.shapes[0].id, 'existing-rail')
  assert.deepEqual(result.shapes[0].kind === 'line' ? result.shapes[0].start : null, { x: 780, y: 700 })
  assert.deepEqual(result.shapes[0].kind === 'line' ? result.shapes[0].end : null, { x: 1220, y: 700 })
})

test('remaps generated family references to a preserved busbar identity', () => {
  const previousRail: Shape = {
    id: 'existing-rail',
    kind: 'line',
    start: { x: 600, y: 700 },
    end: { x: 1400, y: 700 },
    generationKey: 'board:main:rail:0'
  }
  const freshRail: Shape = {
    ...previousRail,
    id: 'fresh-rail'
  }
  const freshBreaker: Shape = {
    ...generatedSymbol('fresh-breaker', 'board:A:breaker', 800),
    oneWireRailId: 'fresh-rail'
  }

  const result = reconcileGeneratedOneWire([previousRail], [freshRail, freshBreaker])

  assert.equal(result.shapes[0].id, 'existing-rail')
  assert.equal(result.shapes[1].oneWireRailId, 'existing-rail')
})

test('reports added and removed generated source objects', () => {
  const result = reconcileGeneratedOneWire(
    [generatedSymbol('old', 'device:removed', 10)],
    [generatedSymbol('new', 'device:added', 20)]
  )
  assert.deepEqual(
    { added: result.added, removed: result.removed, preserved: result.preserved },
    { added: 1, removed: 1, preserved: 0 }
  )
})

test('migrates generated circuits without deleting manual lines or losing cable data and load counts', () => {
  let sequence = 0
  const input: BuildKamrailCircuitBundleInput = {
    rail: {
      id: 'rail',
      kind: 'line',
      groupId: 'onewire-kamrail-test',
      start: { x: 0, y: 703 },
      end: { x: 900, y: 703 }
    },
    anchorX: 400,
    options: {
      amps: 16,
      family: 'A',
      cableType: 'XVB-Cca',
      cableSectionMm2: 4,
      cableInstallation: 'underground',
      autoIncludeFamily: true
    },
    familyComponents: [
      {
        bindingId: 'A1',
        kind: 'load',
        sourceShapeId: 'lamp1',
        sourcePath: 'symbols/Consumption appliances/Lighting.svg'
      },
      {
        bindingId: 'A1',
        kind: 'load',
        sourceShapeId: 'lamp2',
        sourcePath: 'symbols/Consumption appliances/Lighting.svg'
      },
      {
        bindingId: 'A2',
        kind: 'load',
        sourceShapeId: 'lamp3',
        sourcePath: 'symbols/Consumption appliances/Lighting.svg'
      }
    ],
    nextShapeId: () => `migration-${++sequence}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path) ?? 1.35,
    symbolContentBounds: (shape) => ({
      x: shape.position.x - 12 * shape.scale,
      y: shape.position.y - 12 * shape.scale,
      width: 24 * shape.scale,
      height: 24 * shape.scale
    }),
    branchStroke: '#000000'
  }
  const bundle = buildKamrailCircuitBundle(input)!
  const manual: Shape = {
    id: 'manual',
    kind: 'line',
    start: { x: 0, y: 0 },
    end: { x: 20, y: 0 },
    groupId: 'onewire-manual',
    bindingId: 'A1'
  }
  const old = bundle.shapes.map(
    (shape): Shape =>
      shape.kind === 'line' && shape.sourceLink?.role === 'trunk'
        ? { ...shape, start: { ...shape.start, y: 630 }, end: { ...shape.end, y: 460 } }
        : shape.kind === 'text'
          ? { ...shape, fontWeight: 600 }
          : shape
  )
  const migrated = migrateOneWireCircuitGeometry([input.rail, manual, ...old], input)
  assert.strictEqual(
    migrated.find((shape) => shape.id === 'manual'),
    manual
  )
  const breaker = migrated.find((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker')
  const trunk = migrated.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')
  assert.ok(breaker?.kind === 'symbol' && trunk?.kind === 'line')
  assert.equal(trunk.start.y, breaker.position.y + oneWireSymbolTerminalInfo(breaker.path, breaker.scale)!.top!.y)
  assert.equal(trunk.end.y, 703 - 360 - 64)
  const installation = migrated.find((shape) => shape.sourceLink?.role === 'cable-installation')
  assert.ok(installation?.kind === 'symbol')
  const installationNode = oneWireSymbolNodeInfo(installation.path, installation.scale)!
  assert.equal(installation.position.x + installationNode.offset.x, trunk.start.x)
  assert.equal(installation.position.y + installationNode.offset.y, trunk.start.y - 8)
  for (const shape of bundle.shapes.filter((candidate) => candidate.kind === 'text')) {
    const restored = migrated.find((candidate) => candidate.generationKey === shape.generationKey)
    assert.ok(restored?.kind === 'text')
    assert.equal(restored.text, shape.text)
    assert.equal(restored.fontWeight, shape.fontWeight)
  }
  assert.equal(
    migrated.find((shape) => shape.generationKey === 'device:lamp1')?.id,
    bundle.shapes.find((shape) => shape.generationKey === 'device:lamp1')?.id
  )
})

test('recomputes node-connected topology geometry instead of preserving disconnected positions', () => {
  const previous = {
    ...generatedSymbol('old-topology', 'board:main:topology:v2:earth', 440),
    position: { x: 440, y: 440 }
  }
  const fresh = {
    ...generatedSymbol('new-topology', 'board:main:topology:v2:earth', 120),
    position: { x: 120, y: 160 }
  }

  const result = reconcileGeneratedOneWire([previous], [fresh])
  assert.equal(result.shapes[0].id, 'old-topology')
  assert.deepEqual(result.shapes[0].kind === 'symbol' ? result.shapes[0].position : null, { x: 120, y: 160 })
})
