import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCircuits } from '../src/editor/circuit-analysis.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../src/editor/layout/onewire-layout-plan.ts'
import { nativeStateForProjectPage } from '../src/data/project-document.ts'
import {
  createVisualTestProject,
  VISUAL_TEST_GROUND_PAGE_KEY,
  VISUAL_TEST_ONEWIRE_CIRCUITS_PAGE_KEY,
  VISUAL_TEST_ONEWIRE_CIRCUITS_ROW_2_PAGE_KEY,
  VISUAL_TEST_ONEWIRE_PAGE_KEY
} from '../src/data/visual-test-project.ts'

test('provides linked situation and one-wire pages for visual regression', () => {
  const project = createVisualTestProject()
  const situation = nativeStateForProjectPage(project, VISUAL_TEST_GROUND_PAGE_KEY)
  const topology = nativeStateForProjectPage(project, VISUAL_TEST_ONEWIRE_PAGE_KEY)
  const rowOneCircuits = nativeStateForProjectPage(project, VISUAL_TEST_ONEWIRE_CIRCUITS_PAGE_KEY)
  const rowTwoCircuits = nativeStateForProjectPage(project, VISUAL_TEST_ONEWIRE_CIRCUITS_ROW_2_PAGE_KEY)

  assert.equal(project.pages[VISUAL_TEST_GROUND_PAGE_KEY]?.pageType, 'groundplan')
  assert.equal(project.pages[VISUAL_TEST_ONEWIRE_PAGE_KEY]?.pageType, 'onewire')
  assert.equal(project.pages[VISUAL_TEST_ONEWIRE_CIRCUITS_PAGE_KEY]?.pageType, 'onewire')
  assert.equal(project.pages[VISUAL_TEST_ONEWIRE_CIRCUITS_ROW_2_PAGE_KEY]?.pageType, 'onewire')
  assert.ok(situation)
  assert.ok(topology)
  assert.ok(rowOneCircuits)
  assert.ok(rowTwoCircuits)
  assert.equal(topology.oneWireLayoutVersion, ONE_WIRE_LAYOUT_VERSION)
  assert.equal(rowOneCircuits.oneWireLayoutVersion, ONE_WIRE_LAYOUT_VERSION)
  assert.equal(rowTwoCircuits.oneWireLayoutVersion, ONE_WIRE_LAYOUT_VERSION)
  assert.equal(project.oneWireTopology?.mainDifferential?.sensitivityMa, 300)
  assert.equal(project.oneWireTopology?.additionalDifferentials?.[0]?.sensitivityMa, 30)

  const analysis = analyzeCircuits(situation.shapes, project.electricalProfile, project.circuitSpecifications)
  assert.equal(analysis.valid, true)
  assert.deepEqual(analysis.families, ['A', 'ALSB', 'B', 'C'])

  const paths = situation.shapes.filter((shape) => shape.kind === 'symbol').map((shape) => shape.path)
  assert.ok(paths.some((path) => /switches\/push button\.svg$/i.test(path)))
  assert.ok(paths.some((path) => /switches\/double push button\.svg$/i.test(path)))
  assert.ok(paths.some((path) => /consumption appliances\/wall light\.svg$/i.test(path)))
  assert.ok(paths.some((path) => /socket outlets\//i.test(path)))

  const situationSymbols = situation.shapes.filter((shape) => shape.kind === 'symbol')
  const scaleById = new Map(situationSymbols.map((shape) => [shape.id, shape.scale]))
  const expectedScales = new Map<string, number>([
    ['device-a1-push', 0.8],
    ['device-a1-light', 1],
    ['device-a2-push', 1.5],
    ['device-a2-wall-light', 1.5],
    ['device-a3-double-push', 1.5],
    ['device-a3-fluorescent', 1.5],
    ['device-b1-outlet-1', 1],
    ['device-b1-outlet-2', 1],
    ['device-b2-outlet', 1],
    ['device-c1-switch', 1.3],
    ['device-c1-spot', 1],
    ['device-c2-dimmer', 1.3],
    ['device-c2-spot', 1],
    ['device-board', 1.5]
  ])
  for (const [id, scale] of expectedScales) {
    assert.equal(scaleById.get(id), scale)
  }

  const linkedDeviceIds = new Set(
    [...rowOneCircuits.shapes, ...rowTwoCircuits.shapes]
      .filter((shape) => shape.sourceLink?.kind === 'device')
      .map((shape) => shape.sourceLink?.id)
  )
  for (const shape of situation.shapes) {
    if (shape.kind !== 'symbol' || shape.bindingId === 'ALSB') continue
    assert.ok(linkedDeviceIds.has(shape.id), shape.id)
  }

  const bus = topology.shapes.find((shape) => shape.generationKey === 'board:main:topology:bus')
  assert.equal(bus?.kind === 'line' ? bus.strokeWidth : null, 4)
  const topologyRoles = new Set(
    topology.shapes
      .filter((shape) => shape.sourceLink?.kind === 'board' && shape.sourceLink.id === 'main')
      .map((shape) => shape.sourceLink?.role)
  )
  assert.ok(topologyRoles.has('meter'))
  assert.ok(topologyRoles.has('earth'))
  assert.ok(topologyRoles.has('main-differential'))
  assert.ok(topologyRoles.has('additional-differential-consumers-1'))
  assert.ok(topologyRoles.has('additional-differential-consumers-2'))
  assert.ok(!topologyRoles.has('consumer-differential'))
  assert.ok(topology.shapes.some((shape) => shape.kind === 'text' && shape.text === 'NAAR RIJ 1'))
  assert.ok(topology.shapes.some((shape) => shape.kind === 'text' && shape.text === 'NAAR KAST KEUKEN · RIJ 1'))
  assert.equal(rowOneCircuits.shapes.filter((shape) => shape.sourceLink?.role === 'description').length, 2)
  assert.equal(rowTwoCircuits.shapes.filter((shape) => shape.sourceLink?.role === 'description').length, 1)
  assert.ok(rowOneCircuits.shapes.some((shape) => shape.sourceLink?.role === 'rail:main:rail-1'))
  assert.ok(rowTwoCircuits.shapes.some((shape) => shape.sourceLink?.role === 'rail:keuken:rail-1'))
  assert.ok(rowOneCircuits.shapes.some((shape) => shape.kind === 'symbol' && /wall light\.svg$/i.test(shape.path)))
  assert.ok(rowOneCircuits.shapes.some((shape) => shape.kind === 'symbol' && /push button\.svg$/i.test(shape.path)))
  assert.ok(
    !rowOneCircuits.shapes.some((shape) => shape.kind === 'symbol' && /distribution board\.svg$/i.test(shape.path))
  )
  assert.ok(!topology.shapes.some((shape) => shape.sourceLink?.kind === 'device'))
  assert.ok(!rowOneCircuits.shapes.some((shape) => shape.sourceLink?.role === 'meter'))
  assert.ok(!rowTwoCircuits.shapes.some((shape) => shape.sourceLink?.role === 'meter'))
})
