import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { RectShape, Shape } from '../src/editor/model/types.ts'
import { heatingEntrySealsOtherLaunch } from '../src/editor/heating-entry-enclosure.ts'
import { createHeatingPipe } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { buildHeatingGrid } from '../src/editor/heating-routing.ts'
import { heatingFeedGrid } from '../src/editor/heating-feed-grid.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'

const actual = JSON.parse(readFileSync(new URL('./fixtures/heating-entry-enclosure.json', import.meta.url), 'utf8')) as {
  host: RectShape; pair: RectShape[]; other: RectShape; scene: Shape[]; source: { x: number; y: number };
}
const scene = sanitizeShapes(actual.scene), native = buildHeatingGrid(scene, 100, 100, actual.source,
  { pipeDiameterMm: 16, minBendRadiusMm: 80 }), grid = heatingFeedGrid(native, 100)
const settings = { diameterMm: 16, spacingMm: 100, design: actual.host.heating!.design }
const options = () => ({ grid, nativeFloor: native, nativeWallCells: new Set<number>(), permittedWallCells: new Set<number>(),
  source: actual.source, checkpoint: () => {}, baseline: new Map<RectShape, number>() })

test('an actual door pair consuming the adjacent R6 field launch is rejected without any route search', () => {
  const before = JSON.stringify(actual), context = options()
  assert.equal(heatingEntrySealsOtherLaunch(actual.host, actual.pair, [actual.host, actual.other], settings, 100, context), true)
  assert.ok(context.baseline.get(actual.other)! > 0, 'the adjacent coil has a valid native-wall/R80 launch before the new pair')
  const reversed = actual.pair.map((feed) => createHeatingPipe(feed.id, [...heatingPipeGeometry(feed).points].reverse(), feed.heating!))
  assert.equal(heatingEntrySealsOtherLaunch(actual.host, reversed, [actual.host, actual.other], settings, 100, context), true,
    'internal paired-route orientation is accepted too')
  assert.equal(JSON.stringify(actual), before)
})

test('remote paired tails retain another field launch and reuse the immutable baseline', () => {
  const context = options(), remote = actual.pair.map((pipe) => ({ ...structuredClone(pipe),
    start: { x: pipe.start.x - 500, y: pipe.start.y }, end: { x: pipe.end.x - 500, y: pipe.end.y } }))
  assert.equal(heatingEntrySealsOtherLaunch(actual.host, remote, [actual.host, actual.other], settings, 100, context), false)
  assert.ok(context.baseline.get(actual.other)! > 0)
  assert.equal(context.baseline.size, 1)
  assert.equal(heatingEntrySealsOtherLaunch(actual.host, remote, [actual.host, actual.other], settings, 100, context), false)
  assert.equal(context.baseline.size, 1)
  assert.equal(heatingEntrySealsOtherLaunch(actual.host, actual.pair, [actual.host, actual.other], settings, 100, context), true,
    'the cache retains launches, not the acceptance of a different candidate')
})

test('earlier connected fields and a coil with no baseline launch are not rejected again', () => {
  const connected = createHeatingPipe('connected-feed', [{ x: 1200, y: 610 }, { x: 1200, y: 612 }],
    { ...actual.other.heating!, pipeRole: 'supply' })
  assert.equal(heatingEntrySealsOtherLaunch(actual.host, actual.pair, [actual.host, actual.other, connected], settings, 100, options()), false)
  const context = options()
  context.baseline.set(actual.other, 0)
  assert.equal(heatingEntrySealsOtherLaunch(actual.host, actual.pair, [actual.host, actual.other], settings, 100, context), false)
})
