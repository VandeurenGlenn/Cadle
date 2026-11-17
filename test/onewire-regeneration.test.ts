import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isOneWireRailShape,
  partitionOneWireRegenerationShapes,
  reconcileGeneratedOneWire
} from '../src/editor/layout/onewire-regeneration.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { migrateOneWireCircuitGeometry } from '../src/editor/layout/onewire-circuit-migration.ts'
import { createOneWireSourceResolver } from '../src/editor/layout/onewire-source-sync.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'
import { buildKamrailCircuitBundle, type BuildKamrailCircuitBundleInput } from '../src/editor/layout/onewire-helpers.ts'
import {
  oneWireSymbolBounds,
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
  const expectedTrunk = bundle.shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')
  assert.ok(expectedTrunk?.kind === 'line')
  assert.equal(trunk.end.y, expectedTrunk.end.y)
  assert.equal(trunk.connection?.sectionMm2, 4)
  assert.equal(trunk.connection?.cableType, 'XVB-Cca')
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

test('preserves multiple socket row alignment when rebuilding saved circuits', () => {
  let sequence = 0
  const input: BuildKamrailCircuitBundleInput = {
    rail: { id: 'rail', kind: 'line', groupId: 'onewire-kamrail-main', start: { x: 80, y: 1200 }, end: { x: 900, y: 1200 } },
    anchorX: 400, options: { family: 'A', amps: 20, autoIncludeFamily: true },
    familyComponents: [3, 1, 1, 3, 1, 4].map((socketCount, index) => ({
      bindingId: `A${index + 1}`, kind: 'load', sourceShapeId: `socket-${index}`, socketCount,
      sourcePath: 'symbols/Socket outlets/Wall outlet with grounding.svg', sourceName: 'Wall outlet with grounding'
    })),
    nextShapeId: () => `socket-migration-${++sequence}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
    symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!, branchStroke: '#000000'
  }
  const original = [input.rail, ...buildKamrailCircuitBundle(input)!.shapes]
  let restored = original
  for (let reload = 0; reload < 2; reload++) {
    restored = migrateOneWireCircuitGeometry(sanitizeShapes(restored, 'onewire'), input)
    for (const shape of original.filter((shape) => shape.sourceLink?.kind === 'device' || shape.sourceLink?.role === 'row-wire')) {
      const actual = restored.find((candidate) => candidate.id === shape.id)!
      assert.equal(actual.kind, shape.kind)
      if (shape.kind === 'symbol' && actual.kind === 'symbol') {
        assert.equal(actual.position.x, shape.position.x, shape.bindingId)
        assert.equal(actual.electrical?.socketCount, shape.electrical?.socketCount)
      }
      if (shape.kind === 'line' && actual.kind === 'line') {
        assert.equal(actual.start.x, shape.start.x)
        assert.equal(actual.end.x, shape.end.x)
        assert.equal(actual.end.y - actual.start.y, 0)
      }
    }
  }
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

test('synchronizes changed source devices and lamp counts while retaining standalone circuits and stable identities', () => {
  let sequence = 0
  const input: BuildKamrailCircuitBundleInput = {
    rail: { id: 'rail', kind: 'line', groupId: 'onewire-kamrail-main', start: { x: 0, y: 1200 }, end: { x: 900, y: 1200 } },
    anchorX: 400, options: { family: 'A', amps: 16, autoIncludeFamily: true, cableType: 'XGB', cableSectionMm2: 4 },
    familyComponents: ['lamp-1', 'lamp-2'].map((sourceShapeId) => ({
      bindingId: 'A1', kind: 'load', sourceShapeId, sourcePath: 'symbols/Consumption appliances/Lighting.svg'
    })),
    nextShapeId: () => `sync-${++sequence}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path) ?? 1.35,
    symbolContentBounds: (shape) => ({
      x: shape.position.x - 12 * shape.scale, y: shape.position.y - 12 * shape.scale,
      width: 24 * shape.scale, height: 24 * shape.scale
    }), branchStroke: '#000000'
  }
  const manual = buildKamrailCircuitBundle({ ...input, options: { ...input.options, family: 'B' },
    familyComponents: [{ bindingId: 'B1', kind: 'load', sourcePath: 'symbols/Consumption appliances/Jacuzzi.svg' }] })!.shapes
  const shapes = [input.rail, ...buildKamrailCircuitBundle(input)!.shapes, ...manual]
  const families = new Map([['A', [...input.familyComponents, {
    ...input.familyComponents[0], sourceShapeId: 'lamp-3'
  }, {
    bindingId: 'A2', kind: 'load' as const, sourceShapeId: 'heat-pump',
    sourcePath: 'symbols/Consumption appliances/Heat pump.svg'
  }]]])
  const synced = migrateOneWireCircuitGeometry(shapes, { ...input,
    resolveSource: createOneWireSourceResolver(families, [{ key: 'page', shapes }], 'page') })
  assert.ok(synced.some((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'count-label' && shape.text === 'x3'))
  assert.ok(synced.some((shape) => shape.sourceLink?.id === 'heat-pump'))
  for (const shape of manual) assert.strictEqual(synced.find((candidate) => candidate.id === shape.id), shape)
  const breaker = synced.find((shape) => shape.sourceLink?.id === 'A' && shape.sourceLink.role === 'breaker')!
  assert.equal(breaker.id, shapes.find((shape) => shape.sourceLink?.id === 'A' && shape.sourceLink.role === 'breaker')!.id)
  assert.ok(breaker.oneWireSourceSignature)
  const saved = sanitizeShapes(synced)
  const unchanged = migrateOneWireCircuitGeometry(saved, { ...input,
    resolveSource: createOneWireSourceResolver(families, [{ key: 'page', shapes: saved }], 'page') })
  assert.ok(unchanged.every((shape, index) => shape === saved[index]))
  const cleared = migrateOneWireCircuitGeometry(saved, { ...input,
    resolveSource: createOneWireSourceResolver(new Map(), [{ key: 'page', shapes: saved }], 'page') })
  assert.ok(!cleared.some((shape) => shape.sourceLink?.kind === 'device' && /^lamp-|heat-pump/.test(shape.sourceLink.id)))
  assert.ok(cleared.some((shape) => shape.id === breaker.id))
  assert.ok(cleared.some((shape) => shape.sourceLink?.id === 'B' && shape.sourceLink.role === 'breaker'))
})

test('source synchronization assigns new numbered points to one continuation chunk only', () => {
  const page = (key: string, bindingId: string) => ({
    key, shapes: [
      { ...generatedSymbol(`${key}-breaker`, `${key}-breaker`, 100),
        bindingId: 'A', oneWireRailId: key, sourceLink: { kind: 'board' as const, id: 'A', role: 'breaker' } },
      { ...generatedSymbol(`${key}-load`, `${key}-load`, 100), bindingId, oneWireRailId: key }
    ]
  })
  const pages = [page('first', 'A1'), page('second', 'A2')]
  const families = new Map([['A', ['A1', 'A2', 'A3'].map((bindingId) => ({
    bindingId, kind: 'load' as const, sourceShapeId: 'floor-device-1'
  }))]])
  const first = createOneWireSourceResolver(families, pages, 'first')(pages[0].shapes[0])
  const second = createOneWireSourceResolver(families, pages, 'second')(pages[1].shapes[0])
  assert.deepEqual(first?.familyComponents.map((component) => component.bindingId), ['A1', 'A3'])
  assert.deepEqual(second?.familyComponents.map((component) => component.bindingId), ['A2'])
})

test('a matching circuit letter alone does not link a hand-drawn circuit or claim linked source points', () => {
  const breaker = {
    ...generatedSymbol('breaker', 'board:A:breaker', 100),
    bindingId: 'A', sourceLink: { kind: 'board' as const, id: 'A', role: 'breaker' }
  }
  const pages = [
    { key: 'manual', shapes: [breaker, { ...generatedSymbol('manual-load', 'manual-load', 100), bindingId: 'A1' }] },
    { key: 'linked', shapes: [breaker, { ...generatedSymbol('linked-load', 'linked-load', 100), bindingId: 'A1',
      sourceLink: { kind: 'device' as const, id: 'actual-floor-device', role: 'load' } }] }
  ]
  const families = new Map([['A', [{
    bindingId: 'A1', kind: 'load' as const, sourceShapeId: 'actual-floor-device'
  }]]])
  assert.equal(createOneWireSourceResolver(families, pages, 'manual')(breaker), undefined)
  assert.equal(createOneWireSourceResolver(families, pages, 'linked')(breaker)?.familyComponents.length, 1)
})
