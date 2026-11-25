import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { Project } from '../../src/types.ts'
import type { AppShell } from '../../src/shell/app-shell.ts'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { Shape } from '../../src/editor/model/types.ts'
import { nativeStateForProjectPage } from '../../src/editor/model/document-state.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors } from '../../src/editor/layout/onewire-connections.ts'
import { pageLayout } from '../../src/editor/layout/page-layout.ts'
import { PAPER_PRESETS } from '../../src/editor/constants.ts'
import { findConnectionIssues } from '../../src/editor/layout/connection-issues.ts'

test('places differentials from the toolbar on rails and inline without adding a breaker', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const schematic = '00000000-0000-4000-8000-000000000104'
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate(async (element, key) => { await (element as AppShell).loadPage(key) }, schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'differential-placement.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes: [
        { id: 'diff-rail', kind: 'line', start: { x: 500, y: 1000 }, end: { x: 1000, y: 1000 },
          stroke: '#000000', strokeWidth: 4, groupId: 'onewire-kamrail-diff' },
        { id: 'diff-wire', kind: 'line', start: { x: 1500, y: 400 }, end: { x: 1500, y: 1000 },
          stroke: '#000000', strokeWidth: 2, connection: { kind: 'wire', showLabel: false } }
      ],
      selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680
    }))
  })
  await app.evaluate(async (element) => { await (element as CadleApp).exportA4PNG() })
  const stage = app.locator('svg.stage')
  const diff = page.locator('onewire-actions').getByRole('button', { name: 'Add differential', exact: true })
  await page.setViewportSize({ width: 1000, height: 1100 })
  await expect(diff.locator('span')).toBeVisible()
  await expect(diff.locator('custom-icon')).toHaveAttribute('icon', 'shield')
  await page.setViewportSize({ width: 1440, height: 1100 })
  await diff.click()
  await expect(diff).toHaveAttribute('aria-pressed', 'true')
  const clickMiddle = async (id: string) => {
    const point = await stage.locator(`line[data-shape-id="${id}"]`).evaluate((line: SVGLineElement) => {
      const point = new DOMPoint((line.x1.baseVal.value + line.x2.baseVal.value) / 2,
        (line.y1.baseVal.value + line.y2.baseVal.value) / 2).matrixTransform(line.getScreenCTM()!)
      return { x: point.x, y: point.y }
    })
    await page.mouse.click(point.x, point.y)
  }
  await clickMiddle('diff-rail')
  const differentials = stage.locator('g.shape-symbol').filter({ has: page.locator('title', { hasText: /^Residual-current circuit breaker$/ }) })
  await expect(differentials).toHaveCount(1)
  const railDifferentialId = (await differentials.getAttribute('data-shape-id'))!
  const differentialSvg = await app.evaluate((element) => (element as CadleApp).toSVG())
  expect(differentialSvg).toContain('3G2.5 mm² VOB')
  await app.evaluate(async (element) => { await (element as CadleApp).flushPendingSave() })
  const savedProject = await shell.evaluate((element) => (element as AppShell).project!)
  const differentialShapes = nativeStateForProjectPage(savedProject, schematic)!.shapes
  const differential = differentialShapes.find((shape) => shape.kind === 'symbol' && shape.id === railDifferentialId)
  const differentialWire = differential?.kind === 'symbol'
    ? differentialShapes.find((shape) => shape.kind === 'line' && shape.bindingId === differential.bindingId &&
      shape.sourceLink?.role === 'differential-wire')
    : undefined
  expect(differentialWire).toMatchObject({
    connection: { kind: 'cable', conductors: 3, sectionMm2: 2.5, cableType: 'VOB', showLabel: true }
  })
  await expect(page.locator('input-form-dialog[open]')).toHaveCount(0)
  const pane = page.locator('object-pane')
  await expect(pane.getByLabel('RCD (mA)', { exact: true })).toBeVisible()
  await pane.getByLabel('RCD (mA)', { exact: true }).fill('30')
  await pane.getByRole('combobox', { name: 'RCD type', exact: true }).selectOption('A')
  await pane.locator('select[data-electrical-field="breakerCurrentA"]').selectOption('40')
  await expect(pane.getByLabel('RCD (mA)', { exact: true })).toHaveValue('30')
  await closePropertiesForDrawing(page)
  await diff.click()
  await clickMiddle('diff-wire')
  await expect(differentials).toHaveCount(2)
  await expect(stage.locator('g.shape-symbol').filter({ has: page.locator('title', { hasText: /^Automaat$/ }) })).toHaveCount(0)
  await closePropertiesForDrawing(page)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(differentials).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(differentials).toHaveCount(2)
  const exportedIds = await app.evaluate((element) => {
    const exported = new DOMParser().parseFromString((element as CadleApp).toSVG(), 'image/svg+xml')
    return [...exported.querySelectorAll('.shape-symbol')].map((node) => node.getAttribute('data-shape-id'))
  })
  expect(exportedIds).toEqual(await differentials.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-shape-id'))))
  await app.evaluate(async (element) => { await (element as CadleApp).flushPendingSave() })
  const project = await shell.evaluate((element) => (element as AppShell).project!)
  const saved = nativeStateForProjectPage(project, schematic)?.shapes.find((shape) => shape.id === railDifferentialId)
  expect(saved?.kind === 'symbol' && saved.electrical?.rcdSensitivityMa).toBe(30)
  expect(saved?.kind === 'symbol' && saved.electrical?.breakerCurrentA).toBe(40)
  expect(findConnectionIssues(nativeStateForProjectPage(project, schematic)!.shapes).filter((issue) => issue.nearby)).toEqual([])
  await shell.evaluate(async (element) => {
    await (element as AppShell).loadPage('00000000-0000-4000-8000-000000000103')
  })
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000103'))).toBe(true)
  await shell.evaluate(async (element, key) => { await (element as AppShell).loadPage(key) }, schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await expect(differentials).toHaveCount(2)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  const railDifferential = stage.locator(`g.shape-symbol[data-shape-id="${railDifferentialId}"]`)
  const contact = await railDifferential.locator('path').first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(contact.x, contact.y)
  await expect(railDifferential).toHaveAttribute('data-selected', 'true')
  await expect(pane.getByLabel('RCD (mA)', { exact: true })).toBeVisible()
  await expect(pane.getByLabel('RCD (mA)', { exact: true })).toHaveValue('30')
  await expect(pane.locator('select[data-electrical-field="breakerCurrentA"]')).toHaveValue('40')
  await closePropertiesForDrawing(page)
  await page.screenshot({ path: testInfo.outputPath('differential-toolbar.png') })
})

test('places a differential above or below the rail according to the pointer position', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const schematic = '00000000-0000-4000-8000-000000000104'
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'differential-sides.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes: [{ id: 'rail-sides', kind: 'line', start: { x: 400, y: 900 }, end: { x: 1600, y: 900 },
        strokeWidth: 4, groupId: 'onewire-kamrail-sides' }],
      selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680
    }))
  })
  const stage = app.locator('svg.stage')
  const rail = stage.locator('line[data-shape-id="rail-sides"]')
  const button = page.locator('onewire-actions').getByRole('button', { name: 'Add differential', exact: true })
  for (const [x, y] of [[650, 860], [1200, 940]]) {
    await closePropertiesForDrawing(page)
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click()
    const point = await rail.evaluate((line: SVGLineElement, coords) => {
      const screen = new DOMPoint(coords.x, coords.y).matrixTransform(line.getScreenCTM()!)
      return { x: screen.x, y: screen.y }
    }, { x, y })
    await page.mouse.click(point.x, point.y)
  }
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  const project = await shell.evaluate((element) => (element as AppShell).project!)
  const shapes = nativeStateForProjectPage(project, schematic)!.shapes
  const differentials = shapes.filter((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'differential')
  expect(differentials).toHaveLength(2)
  for (const [index, side] of ['top', 'bottom'].entries()) {
    const symbol = differentials[index]
    if (symbol.kind !== 'symbol') throw new Error('Differential is not a symbol')
    const incoming = oneWireSymbolConnectionAnchors(symbol).find((anchor) => anchor.side === (side === 'top' ? 'bottom' : 'top'))!.point
    const outgoing = oneWireSymbolConnectionAnchors(symbol).find((anchor) => anchor.side === side)!.point
    const connector = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'connector' &&
      shape.sourceLink.id === symbol.sourceLink?.id)
    const wire = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'differential-wire' &&
      shape.sourceLink.id === symbol.sourceLink?.id)
    if (connector?.kind !== 'line' || wire?.kind !== 'line') throw new Error('Differential wiring not found')
    expect(side === 'top' ? symbol.position.y < 900 : symbol.position.y > 900).toBe(true)
    expect(connector.start.y).toBe(900)
    expect(connector.end.x).toBeCloseTo(incoming.x, 5)
    expect(connector.end.y).toBeCloseTo(incoming.y, 5)
    expect(wire.start.x).toBeCloseTo(outgoing.x, 5)
    expect(wire.start.y).toBeCloseTo(outgoing.y, 5)
    expect(side === 'top' ? wire.end.y < wire.start.y : wire.end.y > wire.start.y).toBe(true)
  }
  await shell.evaluate((element) => (element as AppShell).loadPage('00000000-0000-4000-8000-000000000102'))
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), schematic)
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  const reloaded = await shell.evaluate((element) => (element as AppShell).project!)
  expect(nativeStateForProjectPage(reloaded, schematic)!.shapes).toEqual(shapes)
  const lower = differentials[1]
  const lowerWire = shapes.find((shape) => shape.kind === 'line' &&
    shape.sourceLink?.role === 'differential-wire' && shape.sourceLink.id === lower.sourceLink?.id)!
  const upper = differentials[0]
  const upperWire = shapes.find((shape) => shape.kind === 'line' &&
    shape.sourceLink?.role === 'differential-wire' && shape.sourceLink.id === upper.sourceLink?.id)!
  const upperConnector = shapes.find((shape) => shape.kind === 'line' &&
    shape.sourceLink?.role === 'connector' && shape.sourceLink.id === upper.sourceLink?.id)!
  if (upperConnector.kind !== 'line') throw new Error('Upper connector not found')
  const rotatedConnectorEnd = {
    x: 2 * upper.position.x - upperConnector.end.x,
    y: 2 * upper.position.y - upperConnector.end.y
  }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'missing-differential-wire.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      ...nativeStateForProjectPage(reloaded, schematic),
      shapes: shapes.filter((shape) => shape.id !== lowerWire.id && shape.id !== upperWire.id).map((shape) =>
        shape.id === upper.id && shape.kind === 'symbol' ? { ...shape, rotation: 180 }
          : shape.id === upperConnector.id && shape.kind === 'line' ? { ...shape, end: rotatedConnectorEnd } : shape)
    }))
  })
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  const restored = await shell.evaluate((element) => (element as AppShell).project!)
  const restoredWire = nativeStateForProjectPage(restored, schematic)!.shapes.find((shape) => shape.kind === 'line' &&
    shape.sourceLink?.role === 'differential-wire' && shape.sourceLink.id === lower.sourceLink?.id)
  expect(restoredWire?.kind).toBe('line')
  if (!restoredWire || restoredWire.kind !== 'line') throw new Error('Differential cable not restored')
  expect(restoredWire.start.y).toBeLessThan(restoredWire.end.y)
  const rotatedWire = nativeStateForProjectPage(restored, schematic)!.shapes.find((shape) => shape.kind === 'line' &&
    shape.sourceLink?.role === 'differential-wire' && shape.sourceLink.id === upper.sourceLink?.id)
  expect(rotatedWire?.kind).toBe('line')
  if (!rotatedWire || rotatedWire.kind !== 'line') throw new Error('Rotated differential cable not restored')
  expect(rotatedWire.start.y).toBeGreaterThan(rotatedConnectorEnd.y)
  expect(rotatedWire.end.y).toBeGreaterThan(rotatedWire.start.y)

  await page.getByRole('button', { name: 'Select', exact: true }).click()
  const lowerConnector = shapes.find((shape) => shape.kind === 'line' &&
    shape.sourceLink?.role === 'connector' && shape.sourceLink.id === lower.sourceLink?.id)!
  const point = await stage.locator(`g.shape-symbol[data-shape-id="${lower.id}"] path`).first()
    .evaluate((path: SVGPathElement) => {
      const screen = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
      return { x: screen.x, y: screen.y }
    })
  await page.mouse.click(point.x, point.y)
  await page.keyboard.press('Delete')
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  const afterDelete = await shell.evaluate((element) => (element as AppShell).project!)
  const remaining = nativeStateForProjectPage(afterDelete, schematic)!.shapes
  expect(remaining.some((shape) => shape.id === lower.id || shape.id === lowerConnector.id)).toBe(false)
  expect(remaining.some((shape) => shape.id === differentials[0].id)).toBe(true)
})

test('starts a new kamrail at a compact length', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const schematic = '00000000-0000-4000-8000-000000000104'
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate(async (element, key) => { await (element as AppShell).loadPage(key) }, schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'empty-rail.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes: [], selectedId: null, paperPreset: 'a4-landscape', printMargin: 10,
      worldWidth: 2376, worldHeight: 1680
    }))
  })
  await page.getByRole('button', { name: 'Add kamrail', exact: true }).click()
  const stage = app.locator('svg.stage')
  const point = await stage.locator('.print-safe-area').evaluate((area: SVGRectElement) => {
    const screen = new DOMPoint(1000, 1000).matrixTransform(area.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(point.x, point.y)
  const rail = stage.locator('line.shape-line[data-shape-id]')
  await expect(rail).toHaveCount(1)
  const length = await rail.evaluate((line) => Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')))
  expect(length).toBe(240)
})

test('grows and shrinks only the affected rail when differentials are added and removed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const schematic = '00000000-0000-4000-8000-000000000104'
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate(async (element, key) => { await (element as AppShell).loadPage(key) }, schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'differential-rail.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes: [
        { id: 'rail', kind: 'line', start: { x: 500, y: 1000 }, end: { x: 1100, y: 1000 },
          stroke: '#000000', strokeWidth: 4, groupId: 'onewire-kamrail-main' },
        { id: 'feeder', kind: 'line', start: { x: 550, y: 1000 }, end: { x: 550, y: 1200 },
          stroke: '#000000', strokeWidth: 2, connection: { kind: 'wire', showLabel: false } },
        { id: 'other-rail', kind: 'line', start: { x: 1400, y: 1000 }, end: { x: 1700, y: 1000 },
          stroke: '#000000', strokeWidth: 4, groupId: 'onewire-kamrail-other' }
      ],
      selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680
    }))
  })
  await app.evaluate(async (element) => { await (element as CadleApp).exportA4PNG() })
  const stage = app.locator('svg.stage')
  const rail = stage.locator('line[data-shape-id="rail"]')
  const railSpan = (id: string) => stage.locator(`line[data-shape-id="${id}"]`).evaluate((line) => ({
    start: Number(line.getAttribute('x1')), end: Number(line.getAttribute('x2'))
  }))
  const clickRailAt = async (x: number) => {
    const point = await rail.evaluate((line: SVGLineElement, x) => {
      const screen = new DOMPoint(x, line.y1.baseVal.value).matrixTransform(line.getScreenCTM()!)
      return { x: screen.x, y: screen.y }
    }, x)
    await page.mouse.click(point.x, point.y)
  }
  const otherBefore = await railSpan('other-rail')
  const before = await railSpan('rail')
  const add = page.locator('onewire-actions').getByRole('button', { name: 'Add differential', exact: true })
  await add.click()
  await clickRailAt(650)
  const differentials = stage.locator('g.shape-symbol').filter({
    has: page.locator('title', { hasText: /^Residual-current circuit breaker$/ })
  })
  await expect(differentials).toHaveCount(1)
  await closePropertiesForDrawing(page)
  await add.click()
  await clickRailAt(1090)
  await expect(differentials).toHaveCount(2)
  const grown = await railSpan('rail')
  expect(grown.end - grown.start).toBeGreaterThan(before.end - before.start)
  const removedId = (await differentials.last().getAttribute('data-shape-id'))!

  await closePropertiesForDrawing(page)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  const point = await differentials.last().locator('path').first().evaluate((path: SVGPathElement) => {
    const screen = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(point.x, point.y)
  await page.keyboard.press('Delete')
  await expect(differentials).toHaveCount(1)
  const shrunk = await railSpan('rail')
  expect(shrunk.end - shrunk.start).toBeLessThan(grown.end - grown.start)
  expect(shrunk.start).toBeLessThanOrEqual(550)
  expect(shrunk.end).toBeGreaterThanOrEqual(650)
  expect(await railSpan('other-rail')).toEqual(otherBefore)
  await closePropertiesForDrawing(page)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(differentials).toHaveCount(2)
  expect(await railSpan('rail')).toEqual(grown)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(differentials).toHaveCount(1)
  expect(await railSpan('rail')).toEqual(shrunk)
  await app.evaluate(async (element) => { await (element as CadleApp).flushPendingSave() })
  const project = await shell.evaluate((element) => (element as AppShell).project!)
  const saved = nativeStateForProjectPage(project, schematic)!.shapes
  expect(saved.find((shape) => shape.id === 'rail')).toMatchObject({
    start: { x: shrunk.start }, end: { x: shrunk.end }
  })
  expect(saved.some((shape) => shape.id === removedId)).toBe(false)
  expect(saved.find((shape) => shape.id === 'feeder')).toMatchObject({ start: { x: 550, y: 1000 } })
  expect(saved.filter((shape) => shape.sourceLink?.role === 'connector')).toHaveLength(1)
  expect(saved.filter((shape) => shape.sourceLink?.role === 'differential-wire')).toHaveLength(2)
  await shell.evaluate(async (element) => {
    await (element as AppShell).loadPage('00000000-0000-4000-8000-000000000103')
  })
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000103'))).toBe(true)
  await shell.evaluate(async (element, key) => { await (element as AppShell).loadPage(key) }, schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await expect(differentials).toHaveCount(1)
  expect(await railSpan('rail')).toEqual(shrunk)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  const remainingPoint = await differentials.first().locator('path').first().evaluate((path: SVGPathElement) => {
    const screen = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(remainingPoint.x, remainingPoint.y)
  await page.keyboard.press('Delete')
  await expect(differentials).toHaveCount(0)
  const lastRemoved = await railSpan('rail')
  expect(lastRemoved.end - lastRemoved.start).toBeCloseTo(240)
  expect(lastRemoved.start).toBeLessThanOrEqual(550)
  expect(lastRemoved.end).toBeGreaterThanOrEqual(550)
  expect(await railSpan('other-rail')).toEqual(otherBefore)
})

test('adds a cable designation when loading a previously placed differential', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const schematic = '00000000-0000-4000-8000-000000000104'
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate(async (element, key) => { await (element as AppShell).loadPage(key) }, schematic)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)

  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'legacy-differential.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 2,
      oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes: [{
        id: 'legacy-differential',
        kind: 'symbol',
        name: 'Differentieel',
        path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
        position: { x: 700, y: 800 },
        scale: 1.35,
        bindingId: 'legacy-diff',
        sourceLink: { kind: 'circuit', id: 'legacy-diff', role: 'differential' }
      }],
      selectedId: null,
      paperPreset: 'a4-landscape',
      printMargin: 10,
      worldWidth: 2376,
      worldHeight: 1680
    }))
  })

  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).toSVG().includes('3G2.5 mm² VOB'))).toBe(true)
  await app.evaluate(async (element) => { await (element as CadleApp).flushPendingSave() })
  const project = await shell.evaluate((element) => (element as AppShell).project!)
  const shapes = nativeStateForProjectPage(project, schematic)!.shapes
  expect(shapes.filter((shape) => shape.kind === 'line' &&
    shape.sourceLink?.role === 'differential-wire')).toHaveLength(1)
  expect(shapes.find((shape) => shape.kind === 'line' &&
    shape.sourceLink?.role === 'differential-wire')).toMatchObject({
      connection: { kind: 'cable', conductors: 3, sectionMm2: 2.5, cableType: 'VOB', showLabel: true }
    })
})

test('requires a reviewed supply description and preserves editable text, JSON corrections and the main protections', async ({ page }, testInfo) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const groundKey = '00000000-0000-4000-8000-000000000102'
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  const project = await shell.evaluate((element) => (element as AppShell).project!)
  project.uuid = randomUUID()
  project.name = 'Bewerkbare schema-opbouw'
  project.pages = {
    [groundKey]: { ...project.pages[groundKey], order: 1 },
    [randomUUID()]: {
      creationTime: project.pages[groundKey].creationTime + 1,
      name: 'Kringentabel',
      pageType: 'circuit-schedule',
      order: 2,
      schema: { version: 'native-svg-1', objects: [] }
    }
  }
  delete project.oneWirePrompt
  delete project.oneWireTopology
  await page.goto('/#!/projects')
  await page.evaluate(async (project) => {
    const root = await navigator.storage.getDirectory()
    for (const [directory, value] of [['projects', project.name], ['project-data', JSON.stringify(project)]]) {
      const store = await root.getDirectoryHandle(directory, { create: true })
      const file = await store.getFileHandle(project.uuid, { create: true })
      const writer = await file.createWritable()
      await writer.write(value)
      await writer.close()
    }
  }, project)
  await page.reload()
  const open = async () => {
    await page.locator('projects-field custom-list-item[data-name="Bewerkbare schema-opbouw"]').click()
    await expect.poll(() => shell.evaluate((element) => (element as AppShell).project?.uuid)).toBe(project.uuid)
  }
  await open()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  const generate = () => shell.evaluate((element) => (element as AppShell).generateAutoOneWireSchema())
  const dialog = page.locator('onewire-prompt-dialog')
  const description = dialog.getByRole('textbox', { name: 'Beschrijving', exact: true })
  const json = dialog.locator('.json-editor')
  await generate()
  await expect(description).toHaveValue(/Hoofddifferentieel 40 A 300 mA/)
  await expect(dialog).toContainText('bewerkbaar voorbeeld')
  const example = await description.inputValue()
  await description.fill('Niet opslaan')
  await description.press('Escape')
  expect(await shell.evaluate((element) => (element as AppShell).project!.oneWireTopology)).toBeUndefined()
  expect(await shell.evaluate((element) => (element as AppShell).project!.pages)).toEqual(project.pages)
  await generate()
  await expect(description).toHaveValue(example)
  await description.fill('Hoofddifferentieel 63 A. Daarna de verbruikers.')
  await dialog.locator('custom-button[label="Structuur toepassen"]').click()
  await expect(dialog.getByRole('alert')).toContainText('gevoeligheid in mA')
  const prompt = 'Inkomende kabel 5x10 mm² XVB. Hoofdschakelaar 63 A. Hoofddifferentieel 63 A 300 mA. Remautomaat 40 A naar de verbruikers. Geen zonnepanelen.'
  await description.fill(prompt)
  await expect(dialog.locator('.preview')).toContainText(/Lokaal model actief|Regelparser \(model niet beschikbaar\)/)
  const plan = JSON.parse(await json.inputValue())
  expect(plan.mainDifferential).toMatchObject({ ratedCurrentA: 63, sensitivityMa: 300 })
  expect(plan.solar).toBe(false)
  plan.mainDifferential.rcdType = 'B'
  plan.mainDifferentialPoles = 4
  await dialog.locator('.json-review summary').click()
  await json.fill(JSON.stringify(plan))
  await expect(dialog.locator('custom-button[label="Beschrijving opnieuw analyseren"]')).toHaveCount(1)
  await dialog.locator('custom-button[label="Structuur toepassen"]').click()
  await expect(dialog).not.toHaveAttribute('data-open')
  const saved = () => shell.evaluate((element) => (element as AppShell).project!)
  const protections = async () => {
    const project = await saved()
    return Object.keys(project.pages).flatMap((key) => nativeStateForProjectPage(project, key)?.shapes ?? [])
      .filter((shape) => shape.kind === 'symbol')
  }
  await expect.poll(async () => (await protections()).map((shape) => shape.sourceLink?.role))
    .toEqual(expect.arrayContaining(['main-differential', 'main-switch', 'meter', 'residual-breaker']))
  expect((await protections()).find((shape) => shape.sourceLink?.role === 'main-differential')).toMatchObject({
    electrical: { breakerCurrentA: 63, rcdSensitivityMa: 300, rcdType: 'B', poles: 4 }
  })
  expect((await protections()).some((shape) => shape.sourceLink?.role === 'solar-panels')).toBe(false)
  expect((await saved()).oneWirePrompt).toBe(prompt)
  await shell.evaluate((element) => (element as AppShell).openOneWirePromptDialog())
  await expect(description).toHaveValue(prompt)
  expect(JSON.parse(await json.inputValue())).toEqual(plan)
  await expect(dialog.locator('custom-button[label="Beschrijving opnieuw analyseren"]')).toHaveCount(0)
  await description.fill('Niet bewaren')
  await description.press('Escape')
  await shell.evaluate((element) => (element as AppShell).openOneWirePromptDialog())
  await expect(description).toHaveValue(prompt)
  expect(JSON.parse(await json.inputValue())).toEqual(plan)
  await description.press('Escape')
  await page.reload()
  await open()
  expect((await saved()).oneWireTopology).toEqual(plan)
  expect((await protections()).some((shape) => shape.sourceLink?.role === 'main-differential')).toBe(true)
  await shell.evaluate((element) => (element as AppShell).openOneWirePromptDialog())
  await description.fill('Inkomende kabel is 4x10 mm² EXVB. Kabel van kWh-meter naar kast: 4x16 mm² XVB. Hoofdschakelaar 32 A. Hoofddifferentieel 40A 300 mA. ' +
    'Daarna een remautomaat naar differentieel 30mA 40 A type A en dan naar de verbruikers. ' +
    'Er zijn zonnepanelen; plaats deze parallel aan de kant van de hoofddifferentieel de automaat is 2P 25A.')
  const legacyPlan = JSON.parse(await json.inputValue())
  delete legacyPlan.additionalDifferentials
  await dialog.locator('.json-review summary').click()
  await json.fill(JSON.stringify(legacyPlan))
  await expect(dialog.locator('.preview')).not.toContainText('1× differentieel')
  await dialog.locator('custom-button[label="Structuur toepassen"]').click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await shell.evaluate((element) => (element as AppShell).openOneWirePromptDialog())
  await expect(dialog.locator('.preview [role="status"]')).toHaveCount(0)
  expect(JSON.parse(await json.inputValue()).additionalDifferentials).toEqual([
    { count: 1, ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A', purpose: 'consumers' }
  ])
  await expect(dialog.locator('.preview-header')).toContainText('Beschrijving bijgewerkt')
  const preview = dialog.locator('.preview')
  await expect(preview.locator('.supply-flow .flow-step strong')).toHaveText([
    'Inkomende kabel', 'Hoofdschakelaar', 'kWh-meter', 'Kabel meter → kast', 'Hoofddifferentieel'
  ])
  await expect(preview.locator('.supply-flow .flow-step').first()).toContainText('4x10 mm² EXVB')
  await expect(preview.locator('.supply-flow .flow-step').nth(3)).toContainText('4x16 mm² XVB')
  await expect(preview.locator('.branch-caption')).toContainText('parallel aangesloten')
  await expect(preview.locator('.branch-caption')).toContainText('vóór de remautomaat')
  await expect(preview.locator('.consumer-branch .branch-flow .flow-step strong')).toHaveText([
    'Remautomaat', 'Verbruikersrail'
  ])
  const differential = preview.locator('.consumer-branch .differential-group')
  await expect(differential).toContainText('1× differentieel')
  await expect(differential).toContainText('40 A / 30 mA')
  await expect(differential).toContainText('type A')
  await expect(differential).toContainText('Naar verbruikers')
  await expect(preview.locator('.solar-branch')).toContainText('2P 25 A')
  await expect(preview.locator('.solar-branch .differential-group')).toHaveCount(0)
  await expect(dialog.locator('.preview [role="status"]')).toHaveCount(0)
  await differential.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('topology-preview-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await differential.scrollIntoViewIfNeeded()
  await expect(differential).toBeVisible()
  expect(await dialog.locator('.panel').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('topology-preview-mobile.png') })
  await page.setViewportSize({ width: 1280, height: 720 })
  await dialog.locator('custom-button[label="Structuur toepassen"]').click()
  await expect.poll(async () => (await protections()).find((shape) =>
    shape.sourceLink?.role === 'additional-differential-consumers-1')?.kind).toBe('symbol')
  const updated = await saved()
  expect(updated.oneWireTopology?.additionalDifferentials).toEqual([
    { count: 1, ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A', purpose: 'consumers' }
  ])
  const topology = Object.keys(updated.pages).flatMap((key) => nativeStateForProjectPage(updated, key)?.shapes ?? [])
  expect(topology.find((shape) => shape.sourceLink?.role === 'incoming')).toMatchObject({
    connection: { conductors: 4, sectionMm2: 16, cableType: 'XVB' }
  })
  expect(topology.find((shape) => shape.sourceLink?.role === 'grid-incoming')).toMatchObject({
    connection: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' }
  })
  expect(topology.find((shape) => shape.sourceLink?.role === 'meter-cable-label')).toMatchObject({
    text: '4x16 mm² XVB'
  })
  expect(topology.some((shape) => shape.kind === 'text' && shape.text === 'NAAR VERBRUIKERS · BLAD E4')).toBe(true)
  expect(topology.find((shape) => shape.sourceLink?.role === 'additional-differential-consumers-1')).toMatchObject({
    electrical: { breakerCurrentA: 40, rcdSensitivityMa: 30, rcdType: 'A' }
  })
  expect(topology.find((shape) => shape.sourceLink?.role === 'solar-breaker')).toMatchObject({
    electrical: { breakerCurrentA: 25, poles: 2 }
  })
  expect(topology.some((shape) =>
    shape.sourceLink?.role === 'secondary-busbar-protection-label' ||
    shape.sourceLink?.role === 'secondary-busbar-capacity-detail'
  )).toBe(false)
  const rail = topology.find((shape) => shape.sourceLink?.role === 'secondary-busbar')
  const feed = topology.find((shape) => shape.sourceLink?.role === 'additional-differential-consumers-1-to-rail')
  expect(rail?.kind === 'line' && feed?.kind === 'line' && feed.start.y === rail.start.y).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('consumer-topology.png') })
})

test('starts a short generated rail close to its first breaker and keeps it after reload', async ({ page }) => {
  const groundKey = randomUUID(), rootKey = randomUUID()
  const document = (shapes: Shape[]) => ({ version: 'native-svg-1', objects: [
    { kind: 'cadle-native-svg-document', payload: { version: 2, paperLayoutVersion: 1,
      oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION, shapes, selectedId: null,
      paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 } }
  ] })
  const project: Project = {
    uuid: randomUUID(), creationTime: 1, name: 'Korte rail met twee kringen', company: '',
    customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' },
    address: { street: '', number: '', postalCode: '', city: '' },
    oneWireTopology: { version: 1, residualBreaker: false, solar: false, consumers: true,
      mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 } },
    pages: {
      [groundKey]: { name: 'Situatieplan', pageType: 'groundplan', creationTime: 1,
        schema: document(['D', 'E'].map((family, index): Shape => ({
          id: `load-${family}`, kind: 'symbol', name: 'Wall outlet with grounding',
          path: 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg', scale: 1,
          position: { x: 200 + index * 120, y: 200 }, bindingId: `${family}1`,
          electrical: { role: 'load', oneWireEligible: true, circuitType: 'sockets', socketCount: 1 }
        }))) },
      [rootKey]: { name: 'One-wire diagram', pageType: 'onewire', creationTime: 2, schema: document([]) }
    }
  }
  await page.goto('/#!/projects')
  await page.evaluate(async (value) => {
    const root = await navigator.storage.getDirectory()
    for (const [directory, content] of [['projects', value.name], ['project-data', JSON.stringify(value)]]) {
      const store = await root.getDirectoryHandle(directory, { create: true })
      const file = await store.getFileHandle(value.uuid, { create: true })
      const writer = await file.createWritable()
      await writer.write(content)
      await writer.close()
    }
  }, project)
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="Korte rail met twee kringen"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  await shell.evaluate((element) => (element as AppShell).generateAutoOneWireSchema())
  const generated = await shell.evaluate((element) => (element as AppShell).project!)
  const pageKey = Object.keys(generated.pages).find((key) => generated.pages[key].pageType === 'onewire' &&
    nativeStateForProjectPage(generated, key)?.shapes.some((shape) => shape.sourceLink?.role === 'breaker'))!
  const shapes = nativeStateForProjectPage(generated, pageKey)!.shapes
  const rail = shapes.find((shape) => shape.kind === 'line' && shape.groupId?.startsWith('onewire-kamrail-'))
  if (!rail || rail.kind !== 'line') throw new Error('Generated rail not found')
  const breakers = shapes.filter((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker')
  expect(breakers).toHaveLength(2)
  const firstX = Math.min(...breakers.map((breaker) =>
    oneWireSymbolConnectionAnchors(breaker).find((anchor) => anchor.side === 'bottom')!.point.x))
  expect(firstX - rail.start.x).toBeCloseTo(20)
  expect(rail.end.x - rail.start.x).toBeCloseTo(240)
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), pageKey)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), groundKey)
  const reloaded = await shell.evaluate((element) => (element as AppShell).project!)
  expect(nativeStateForProjectPage(reloaded, pageKey)!.shapes).toEqual(shapes)
})

test('keeps generated circuits and the start of the rail away from the page edge', async ({ page }) => {
  const groundKey = randomUUID(), rootKey = randomUUID()
  const document = (shapes: Shape[]) => ({ version: 'native-svg-1', objects: [
    { kind: 'cadle-native-svg-document', payload: { version: 2, paperLayoutVersion: 1,
      oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION, shapes, selectedId: null,
      paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 } }
  ] })
  const project: Project = {
    uuid: randomUUID(), creationTime: 1, name: 'Ruimte voor eerste kring', company: '',
    customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' },
    address: { street: '', number: '', postalCode: '', city: '' },
    oneWireTopology: { version: 1, residualBreaker: false, solar: false, consumers: true,
      mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 } },
    pages: {
      [groundKey]: { name: 'Situatieplan', pageType: 'groundplan', creationTime: 1,
        schema: document([...'ABCDEFGHIJKLM'].map((family, index): Shape => ({
          id: `load-${family}`, kind: 'symbol', name: 'Wall outlet with grounding',
          path: 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg', scale: 1,
          position: { x: 200 + index * 120, y: 200 }, bindingId: `${family}1`,
          electrical: { role: 'load', oneWireEligible: true, circuitType: 'sockets', socketCount: 1 }
        }))) },
      [rootKey]: { name: 'One-wire diagram', pageType: 'onewire', creationTime: 2, schema: document([]) }
    }
  }
  await page.goto('/#!/projects')
  await page.evaluate(async (value) => {
    const root = await navigator.storage.getDirectory()
    for (const [directory, content] of [['projects', value.name], ['project-data', JSON.stringify(value)]]) {
      const store = await root.getDirectoryHandle(directory, { create: true })
      const file = await store.getFileHandle(value.uuid, { create: true })
      const writer = await file.createWritable()
      await writer.write(content)
      await writer.close()
    }
  }, project)
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="Ruimte voor eerste kring"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  await shell.evaluate((element) => (element as AppShell).generateAutoOneWireSchema())
  const generated = await shell.evaluate((element) => (element as AppShell).project!)
  const pages = Object.keys(generated.pages).filter((key) => generated.pages[key].pageType === 'onewire')
  const circuitPages = pages.map((key) => nativeStateForProjectPage(generated, key)!)
    .filter((state) => state.shapes.some((shape) => shape.sourceLink?.role === 'breaker'))
  expect(circuitPages.length).toBeGreaterThan(0)
  for (const state of circuitPages) {
    const area = pageLayout(state.worldWidth, state.worldHeight, state.printMargin,
      state.worldWidth / PAPER_PRESETS[state.paperPreset].widthMm).content
    const boxes = state.shapes.filter((shape) => !shape.hidden).map(oneWireLayoutBounds)
    expect(Math.min(...boxes.map((box) => box.x))).toBeGreaterThanOrEqual(area.x + 96 - 1e-6)
    expect(Math.max(...boxes.map((box) => box.x + box.width))).toBeLessThanOrEqual(area.x + area.width - 96 + 1e-6)
  }
})

test('uses the printable width and consolidates old automatic sheets without losing device identities or cable overrides', async ({ page }, testInfo) => {
  const groundKey = randomUUID(), rootKey = randomUUID()
  const families = [...'ADEFGHIJKLMNQ']
  const document = (shapes: Shape[]) => ({ version: 'native-svg-1', objects: [
    { kind: 'cadle-native-svg-document', payload: { version: 2, paperLayoutVersion: 1,
      oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION, shapes, selectedId: null,
      paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 } }
  ] })
  const project: Project = {
    uuid: randomUUID(), creationTime: 1, name: 'Compacte eendraadsbladen', company: '',
    customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' },
    address: { street: '', number: '', postalCode: '', city: '' },
    circuitSpecifications: Object.fromEntries(families.map((family) => [family,
      { poles: 4, cableConductors: 5, breakerCurrentA: family === 'Q' ? 16 : 20 }])),
    oneWireTopology: { version: 1, residualBreaker: false, solar: false, consumers: true,
      mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 } },
    pages: {
      [groundKey]: { name: 'Situatieplan', pageType: 'groundplan', creationTime: 1, schema: document(families.flatMap((family, index) =>
        Array.from({ length: [1, 8, 8, 3, 1, 6, 1, 2, 1, 1, 1, 1, 14][index] }, (_, point): Shape[] => {
          const bindingId = `${family}${point + 1}`
          const switches = family === 'Q' ? [2, 0, 2, 2, 2, 0, 4, 0, 0, 0, 0, 0, 1, 1][point] : 0
          return [
            ...Array.from({ length: switches }, (_, switchIndex): Shape => ({
              id: `switch-${bindingId}-${switchIndex}`, kind: 'symbol', name: 'Switch',
              path: `symbols/Switches/${point === 6 && switchIndex > 0 && switchIndex < 3
                ? 'Intermediate switch' : 'Single pole change over switch'}.svg`,
              scale: 1, position: { x: 200 + index * 120 + switchIndex * 30, y: 180 + point * 90 },
              bindingId, electrical: { role: 'switch', oneWireEligible: true, circuitType: 'lighting' }
            })),
            { id: `load-${bindingId}`, kind: 'symbol', name: family === 'Q' ? 'Lighting' : 'Wall outlet with grounding',
              path: family === 'Q' ? 'symbols/Consumption appliances/Lighting.svg'
                : 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg', scale: 1,
              position: { x: 200 + index * 120, y: 200 + point * 90 }, bindingId,
              electrical: { role: 'load', oneWireEligible: true, circuitType: family === 'Q' ? 'lighting' : 'sockets',
                ...(family !== 'Q' ? { socketCount: 1 } : {}) } }
          ]
        }).flat())) },
      [rootKey]: { name: 'One-wire diagram', pageType: 'onewire', creationTime: 2, schema: document([]) }
    }
  }
  const store = async (value: Project) => page.evaluate(async (project) => {
    const root = await navigator.storage.getDirectory()
    for (const [directory, value] of [['projects', project.name], ['project-data', JSON.stringify(project)]]) {
      const store = await root.getDirectoryHandle(directory, { create: true })
      const file = await store.getFileHandle(project.uuid, { create: true })
      const writer = await file.createWritable()
      await writer.write(value)
      await writer.close()
    }
  }, value)
  await page.goto('/#!/projects')
  await store(project)
  await page.reload()
  const open = async () => {
    await page.locator('projects-field custom-list-item[data-name="Compacte eendraadsbladen"]').click()
    await expect.poll(() => page.locator('cadle-app:not([read-only])').evaluate((element, key) =>
      (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  }
  await open()
  const shell = page.locator('app-shell')
  const generate = () => shell.evaluate((element) => (element as AppShell).generateAutoOneWireSchema())
  const saved = () => shell.evaluate((element) => (element as AppShell).project!)
  const oneWireKeys = (project: Project) => Object.keys(project.pages).filter((key) => project.pages[key].pageType === 'onewire')
  await generate()
  const initial = await saved()
  expect(oneWireKeys(initial)).toHaveLength(2)
  const circuitKey = oneWireKeys(initial).find((key) => key !== rootKey)!
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), circuitKey)
  await expect.poll(() => page.locator('cadle-app:not([read-only])').evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), circuitKey)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('bottom-aligned-circuits.png') })
  const original = nativeStateForProjectPage(initial, circuitKey)!
  expect(original.shapes.filter((shape) => shape.sourceLink?.role === 'breaker')).toHaveLength(13)
  expect(new Set(original.shapes.flatMap((shape) =>
    shape.kind === 'symbol' && /^Q\d+$/.test(shape.bindingId ?? '') ? [shape.bindingId] : [])).size).toBe(14)
  expect(original.shapes.some((shape) => shape.sourceLink?.role.startsWith('sheet-reference:') ||
    shape.sourceLink?.role === 'overflow-reference')).toBe(false)
  const originalArea = pageLayout(original.worldWidth, original.worldHeight, original.printMargin,
    original.worldWidth / PAPER_PRESETS[original.paperPreset].widthMm).content
  const left = Math.min(...original.shapes.filter((shape) => !shape.hidden)
    .map((shape) => oneWireLayoutBounds(shape).x))
  const right = Math.max(...original.shapes.filter((shape) => !shape.hidden)
    .map((shape) => { const bounds = oneWireLayoutBounds(shape); return bounds.x + bounds.width }))
  expect(left).toBeGreaterThanOrEqual(originalArea.x + 96 - 1e-6)
  expect(right).toBeLessThanOrEqual(originalArea.x + originalArea.width - 96 + 1e-6)
  const bottom = Math.max(...original.shapes.filter((shape) => !shape.hidden)
    .map((shape) => { const bounds = oneWireLayoutBounds(shape); return bounds.y + bounds.height }))
  expect(bottom).toBeCloseTo(originalArea.y + originalArea.height - 24, 6)
  const cable = original.shapes.find((shape) => shape.kind === 'line' && shape.bindingId === 'H' && shape.connection?.kind === 'cable')
  expect(cable).toBeDefined()
  if (cable?.kind !== 'line') throw new Error('Missing H cable.')
  cable.connection = { ...cable.connection!, name: 'Voeding garage behouden', showLabel: true }
  const deviceIds = original.shapes.filter((shape) => shape.sourceLink?.kind === 'device').map((shape) => shape.id).sort()
  const symbolSizes = original.shapes.flatMap((shape) => shape.kind === 'symbol' ? [[shape.id, shape.scale]] : [])
  const legacyKeys = [circuitKey, randomUUID(), randomUUID(), randomUUID()]
  for (const [index, key] of legacyKeys.entries()) {
    const included = families.slice(index * 4, index * 4 + 4)
    const shapes = original.shapes.filter((shape) => {
      const family = (shape.bindingId ?? shape.sourceLink?.id ?? '').replace(/\d+$/, '')
      return !families.includes(family) || included.includes(family)
    })
    shapes.push({ id: `legacy-header-${index}`, kind: 'text',
      text: `KAST MAIN · BLAD E${index + 2} · VAN E${index + 1} · VERVOLG E${index + 3}`,
      position: { x: 200, y: 1300 }, scale: 1,
      generationKey: 'board:main:sheet-reference', sourceLink: { kind: 'board', id: 'main', role: 'sheet-reference:main' } })
    shapes.push({ id: `legacy-overflow-${index}`, kind: 'text', text: 'VERVOLG OP BLAD 3',
      position: { x: 200, y: 1350 }, scale: 1,
      sourceLink: { kind: 'board', id: key, role: 'overflow-reference' } })
    initial.pages[key] = { ...initial.pages[circuitKey], name: `One-wire diagram ${index + 2}`,
      creationTime: 3 + index, schema: { version: 'native-svg-1', objects: [
        { kind: 'cadle-native-svg-document', payload: { ...original, shapes } }
      ] } }
  }
  expect(oneWireKeys(initial)).toHaveLength(5)
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), groundKey)
  await store(initial)
  await page.goto('/#!/projects')
  await open()
  await generate()
  const compact = await saved()
  expect(oneWireKeys(compact)).toHaveLength(2)
  const combined = oneWireKeys(compact).flatMap((key) => {
    const state = nativeStateForProjectPage(compact, key)!
    const area = pageLayout(state.worldWidth, state.worldHeight, state.printMargin,
      state.worldWidth / PAPER_PRESETS[state.paperPreset].widthMm).content
    for (const shape of state.shapes.filter((shape) => !shape.hidden)) {
      const bounds = oneWireLayoutBounds(shape)
      expect(bounds.x, `${shape.id}: left print margin`).toBeGreaterThanOrEqual(area.x - 1e-6)
      expect(bounds.y, `${shape.id}: top print margin`).toBeGreaterThanOrEqual(area.y - 1e-6)
      expect(bounds.x + bounds.width, `${shape.id}: right print margin`).toBeLessThanOrEqual(area.x + area.width + 1e-6)
      expect(bounds.y + bounds.height, `${shape.id}: bottom print margin`).toBeLessThanOrEqual(area.y + area.height + 1e-6)
    }
    return state.shapes
  })
  expect(combined.some((shape) =>
    shape.sourceLink?.role === 'secondary-busbar-protection-label' ||
    shape.sourceLink?.role === 'secondary-busbar-capacity-detail'
  )).toBe(false)
  expect(combined.filter((shape) => shape.sourceLink?.kind === 'device').map((shape) => shape.id).sort()).toEqual(deviceIds)
  expect(combined.some((shape) => shape.sourceLink?.role.startsWith('sheet-reference:') ||
    shape.sourceLink?.role === 'overflow-reference')).toBe(false)
  expect(combined.flatMap((shape) => shape.kind === 'symbol' && symbolSizes.some(([id]) => id === shape.id)
    ? [[shape.id, shape.scale]] : []).sort()).toEqual(symbolSizes.sort())
  expect(combined.find((shape) => shape.id === cable.id)).toMatchObject({ connection: { name: 'Voeding garage behouden', showLabel: true } })
  expect(compact.recovery?.length).toBeGreaterThan(0)
  await generate()
  expect(oneWireKeys(await saved())).toEqual(oneWireKeys(compact))
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="Compacte eendraadsbladen"]').click()
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).project?.uuid)).toBe(project.uuid)
  await expect.poll(async () => oneWireKeys(await saved())).toEqual(oneWireKeys(compact))
})

test('generates imported circuit breakers without junction boxes or obsolete breaker assets', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element: any) => element.waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'legacy-breaker.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 2, paperLayoutVersion: 1, paperPreset: 'a4-landscape', printMargin: 10,
      worldWidth: 2376, worldHeight: 1680, selectedId: null,
      shapes: [
        { id: 'legacy-breaker', kind: 'image', name: 'Auto breaker',
          path: 'symbols/Protection devices/Auto breaker.svg', bindingId: 'R1',
          position: { x: 400, y: 400 }, width: 24, height: 24 },
        { id: 'legacy-junction', kind: 'image', name: 'Junction box',
          path: 'symbols/Electrical devices/Junction box.svg', bindingId: 'R1',
          position: { x: 500, y: 400 }, width: 24, height: 24 }
      ]
    }))
  })
  await expect.poll(async () => {
    const analysis = await app.evaluate((element: any) => element.analyzeBindings())
    return analysis.groups.find((group: { bindingId: string }) => group.bindingId === 'R1')?.protection
  }).toBe(1)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await page.locator('app-shell').evaluate((element: any) => element.generateAutoOneWireSchema())
  await expect.poll(() => page.locator('app-shell').evaluate((element: any) =>
    element.project?.pages?.[element.loadedPage]?.pageType)).toBe('onewire')
  const generated = await app.evaluate((element: any) => element.generateAutoOneWire())
  expect(generated.generated, generated.message).toBe(true)
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const markup = await app.evaluate((element: any) => element.toSVG())
  expect(markup).not.toContain('Junction box')
  expect(markup).not.toContain('Auto breaker.svg')
  await expect(app.locator('g.shape-symbol').filter({ has: page.locator('title', { hasText: /^Automaat$/ }) }).first()).toBeVisible()
})

// Selection now opens an overlay. Close it before coordinate-based drawing
// steps so those clicks reach the intended part of the sheet.
const closePropertiesForDrawing = async (page: Page) => {
  const panel = page.locator('app-shell #object-inspector')
  if (await panel.getAttribute('data-open') === 'true') {
    await panel.getByRole('button', { name: 'Close properties' }).click()
    await expect(panel).toBeHidden()
  }
}

test('create, draw, bind, validate, generate, reload, and export one-wire project', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 })
  await page.goto('/#!/create-project')
  const values: Record<string, string> = {
    'Project name': 'E2E AREI project',
    'Page name': 'Ground plan',
    'Customer name': 'Ada',
    'Customer last name': 'Tester',
    Name: 'E2E',
    'Last name': 'Installer',
    Company: 'Cadle Test',
    Street: 'Teststraat',
    'House number': '1',
    'Postal code': '1000',
    City: 'Brussel'
  }
  for (const [label, value] of Object.entries(values)) {
    await page.locator(`create-project-field input[data-field="${label}"]`).fill(value)
  }
  await page.locator('create-project-field .actions custom-button').click()
  await expect(page).toHaveURL(/#!\/editor\/model/)

  const drawer = page.locator('app-shell .left-rail')
  const drawerToggle = page.getByRole('button', { name: 'Open project menu' })
  await expect(drawerToggle).toBeVisible()
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer).toHaveAttribute('data-mobile-open', 'false')
  await expect(drawer).toBeHidden()
  await drawerToggle.click()
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer).toBeVisible()
  await page.getByRole('button', { name: 'Close project menu' }).click({ position: { x: 550, y: 400 } })
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer).toBeHidden()

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('tab', { name: 'Symbols catalog' }).click()
  const stage = page.locator('cadle-app svg.stage')
  await expect(stage).toBeVisible()
  const placeAndBind = async (query: string, x: number, bindingId: string) => {
    const search = page.locator('catalog-element search-element input')
    await search.fill(query)
    await expect(page.locator('catalog-element .search-status')).toContainText(query)
    const item = page.locator('catalog-element catalog-item').filter({ hasText: query }).first()
    await expect(item).toBeVisible()
    await item.click()
    await stage.evaluate((element, localX) => {
      const bounds = element.getBoundingClientRect()
      const init = {
        bubbles: true,
        composed: true,
        clientX: bounds.left + localX,
        clientY: bounds.top + 220,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0
      }
      element.dispatchEvent(new PointerEvent('pointerdown', init))
      element.dispatchEvent(new PointerEvent('pointerup', init))
      element.dispatchEvent(new MouseEvent('click', init))
    }, x)
    const binding = page.locator('object-pane input.native-binding-input')
    await expect(binding).toBeVisible()
    await binding.fill(bindingId)
    await binding.press('Tab')
    await page.waitForTimeout(450)
  }

  // The SVG spans underneath the fixed 240 px catalog rail, so keep placement
  // clicks inside the unobscured drawing column.
  await placeAndBind('Switch general symbol', 360, 'A1')
  await placeAndBind('Wall outlet with grounding for floorplan', 420, 'A1')

  await placeAndBind('Switch general symbol', 500, 'B1')
  await placeAndBind('Lighting', 580, 'B1')

  const validation = await page.locator('cadle-app').evaluate((element: any) => element.analyzeBindings())
  expect(validation.valid, JSON.stringify(validation)).toBe(true)
  expect(validation.groups[0].bindingId).toBe('A1')
  expect(validation.groups[0].specification.breakerCurrentA).toBe(20)
  expect(validation.groups[0].specification.cableSectionMm2).toBe(2.5)
  expect(validation.groups[0].specification.breakerCurve).toBe('C')

  await page.locator('app-shell').evaluate((element: any) => element.generateAutoOneWireSchema())
  const topologyReview = page.locator('onewire-prompt-dialog')
  await expect(topologyReview).toHaveAttribute('data-open')
  await topologyReview.getByRole('textbox', { name: 'Beschrijving', exact: true }).fill(
    'Inkomende kabel 4x10 mm² EXVB. Hoofdschakelaar 40 A. Hoofddifferentieel 40 A 300 mA. Geen remautomaat. Geen zonnepanelen. Daarna de verbruikers.'
  )
  await topologyReview.locator('custom-button[label="Structuur toepassen"]').click()
  await expect(topologyReview).not.toHaveAttribute('data-open')
  await expect.poll(() => page.locator('app-shell').evaluate((element) =>
    Object.values((element as AppShell).project!.pages).map((page) => page.name))).toContain('One-wire diagram 2')
  await page.locator('app-shell').evaluate(async (element) => {
    const shell = element as AppShell
    const key = Object.keys(shell.project!.pages).find((key) => shell.project!.pages[key].name === 'One-wire diagram 2')
    if (!key) throw new Error('Missing outgoing-circuit sheet.')
    await shell.loadPage(key)
  })
  await expect
    .poll(() =>
      page.locator('app-shell').evaluate((element: any) => element.project?.pages?.[element.loadedPage]?.pageType)
    )
    .toBe('onewire')
  const generated = await page.locator('cadle-app').evaluate((element: any) => element.generateAutoOneWire(1))
  expect(generated.generated, generated.message).toBe(true)
  const generatedSvg = await page.locator('cadle-app').evaluate((element: any) => element.toSVG())
  expect((generatedSvg.match(/data-shape-id=/g) ?? []).length).toBeGreaterThan(3)
  expect(generatedSvg).toContain('C20')
  expect(generatedSvg).toContain('2.5 mm²')
  expect(generatedSvg).toContain('C16')
  expect(generatedSvg).toContain('1.5 mm²')
  const generatedLabels = page.locator('cadle-app text.onewire-generated-label')
  await expect(generatedLabels.first()).toHaveCSS('stroke', 'none')
  const cableOffsets = await generatedLabels.evaluateAll((labels) =>
    labels
      .filter((label) => label.textContent?.includes('mm²'))
      .map((label) => {
        const feeder = label.closest('g.shape-group')?.querySelector('line')
        return feeder ? Number(feeder.getAttribute('x1')) - Number(label.getAttribute('x')) : null
      })
  )
  expect(cableOffsets.length).toBeGreaterThan(0)
  for (const offset of cableOffsets) expect(offset).toBeLessThan(-10)

  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await stage.evaluate((element) => {
    const breaker = [...element.querySelectorAll<SVGGElement>('g.shape-symbol')].find((group) =>
      /automaat/i.test(group.querySelector('title')?.textContent ?? '')
    )
    if (!breaker) throw new Error('Missing generated breaker symbol.')
    breaker.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0
      })
    )
    breaker.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, pointerId: 1, pointerType: 'mouse', button: 0 }))
  })
  await page.locator('object-pane [data-property-section="supply"] > summary').click()
  const supplyOptions = page.getByRole('radiogroup', { name: 'Supply phase' })
  await expect(supplyOptions.getByRole('radio')).toHaveCount(5)
  await expect(supplyOptions.getByRole('radio', { name: '3F + N' })).toHaveAttribute('aria-checked', 'true')
  const supplyLayout = await supplyOptions.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }))
  expect(supplyLayout.scrollWidth).toBeLessThanOrEqual(supplyLayout.clientWidth)

  await supplyOptions.getByRole('radio', { name: 'L2 + N' }).click()
  await expect(supplyOptions.getByRole('radio', { name: 'L2 + N' })).toHaveAttribute('aria-checked', 'true')
  const neutralOptions = page.getByRole('radiogroup', { name: 'Neutral position' })
  await neutralOptions.getByRole('radio', { name: 'N left' }).click()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('N-L2')
  await neutralOptions.getByRole('radio', { name: 'N right' }).click()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('L2-N')
  const phasePlacement = await page.locator('cadle-app').evaluate((element: any) => {
    const labels = [...element.shadowRoot.querySelectorAll('text.shape-text')] as SVGTextElement[]
    const phase = labels.find((label) => label.textContent?.trim() === 'L2-N')!
    const current = labels.find((label) => /^[BCD]?\d+A$/.test(label.textContent?.trim() ?? '') &&
      label.getAttribute('x') === phase.getAttribute('x') &&
      Math.abs(Number(phase.getAttribute('y')) - Number(label.getAttribute('y')) - 28) < 1e-6)!
    const exported = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    const exportedPhase = [...exported.querySelectorAll('text')].find((label) => label.textContent?.trim() === 'L2-N')!
    return {
      aligned: Boolean(current),
      clear: Boolean(current) && phase.getBoundingClientRect().top > current.getBoundingClientRect().bottom,
      exportedY: exportedPhase.getAttribute('y'),
      editorY: phase.getAttribute('y')
    }
  })
  expect(phasePlacement.aligned).toBe(true)
  expect(phasePlacement.clear).toBe(true)
  expect(phasePlacement.exportedY).toBe(phasePlacement.editorY)
  await page.screenshot({ path: '/private/tmp/cadle-circuit-phase.png' })
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('2P')

  const showPhaseLabel = page.getByRole('checkbox', { name: 'Show phase label' })
  await showPhaseLabel.uncheck()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).not.toContain('L2-N')
  await showPhaseLabel.check()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('L2-N')

  await supplyOptions.getByRole('radio', { name: '3F', exact: true }).click()
  await expect(supplyOptions.getByRole('radio', { name: '3F', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('3P')
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('L1-L2-L3')
  await supplyOptions.getByRole('radio', { name: '3F + N' }).click()
  await expect(supplyOptions.getByRole('radio', { name: '3F + N' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('4P')
  await supplyOptions.getByRole('radio', { name: 'L2 + N' }).click()

  const objectPane = page.locator('object-pane')
  await objectPane.locator('[data-electrical-field="breakerCurrentA"]').selectOption('25')
  await objectPane.locator('[data-electrical-field="breakerCurve"]').selectOption('D')
  await objectPane.locator('[data-electrical-field="cableSectionMm2"]').selectOption('4')
  await objectPane.locator('[data-electrical-field="cableConductors"]').fill('4')
  await expect(objectPane.locator('[data-electrical-field="hasProtectiveConductor"]')).toHaveValue('false')
  await objectPane.locator('[data-electrical-field="hasProtectiveConductor"]').selectOption('true')
  await objectPane.locator('[data-electrical-field="cableType"]').selectOption('XVB-Cca')
  await objectPane.locator('[data-electrical-field="cableInstallation"]').selectOption('underground')
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')
  await expect
    .poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG()))
    .toContain('4G4 mm² XVB Cca')
  await page.locator('cadle-app').evaluate(async (element: any) => element.flushPendingCircuitUpdates())
  await page.getByRole('button', { name: 'Close properties' }).click()

  const oneWireGeometry = async () =>
    stage.evaluate((element) => {
      const labels = [...element.querySelectorAll<SVGTextElement>('text.onewire-generated-label')]
      const labelX = (label: string) => {
        const element = labels.find((candidate) => candidate.textContent?.trim() === label)
        return element ? Number(element.getAttribute('x')) : null
      }
      const rails = [...element.querySelectorAll<SVGLineElement>('line.shape-line')]
        .map((line) => ({
          x1: Number(line.getAttribute('x1')),
          x2: Number(line.getAttribute('x2')),
          y1: Number(line.getAttribute('y1')),
          y2: Number(line.getAttribute('y2')),
          strokeWidth: Number.parseFloat(getComputedStyle(line).strokeWidth)
        }))
        .filter((line) => line.y1 === line.y2 && line.strokeWidth >= 4)
        .sort((a, b) => Math.abs(b.x2 - b.x1) - Math.abs(a.x2 - a.x1))
      return { a: labelX('A'), b: labelX('B'), c: labelX('C'), d: labelX('D'), rail: rails[0] ?? null, rails }
    })

  const addBreaker = page.getByRole('button', { name: 'Add breaker' }).last()
  await expect(addBreaker).toBeVisible()
  await addBreaker.click()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')
  const railClick = await stage.evaluate((element) => {
    const rail = [...element.querySelectorAll<SVGLineElement>('line.shape-line')]
      .filter((line) => Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4)
      .sort(
        (a, b) =>
          Math.abs(Number(b.getAttribute('x2')) - Number(b.getAttribute('x1'))) -
          Math.abs(Number(a.getAttribute('x2')) - Number(a.getAttribute('x1')))
      )[0]
    if (!rail) throw new Error('Missing generated one-wire rail.')
    const point = element.createSVGPoint()
    point.x = Number(rail.getAttribute('x2')) - 2
    point.y = Number(rail.getAttribute('y2'))
    const screen = point.matrixTransform(rail.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(railClick.x, railClick.y)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('C')
  await page.getByRole('button', { name: 'Add breaker', exact: true }).first().click()
  await expect.poll(async () => (await oneWireGeometry()).c).not.toBeNull()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')

  const addedGeometry = await oneWireGeometry()
  expect(addedGeometry.b).not.toBeNull()
  expect(addedGeometry.c).not.toBeNull()
  expect(addedGeometry.rail).not.toBeNull()
  const previousRightmostFamily = Math.max(addedGeometry.a ?? 0, addedGeometry.b ?? 0)
  expect((addedGeometry.c ?? 0) - previousRightmostFamily).toBeGreaterThan(0)
  // Protection values now reserve clear space on both sides of each breaker.
  expect((addedGeometry.c ?? 0) - previousRightmostFamily).toBeLessThan(220)
  expect(
    Math.max(addedGeometry.rail?.x1 ?? 0, addedGeometry.rail?.x2 ?? 0) - (addedGeometry.c ?? 0)
  ).toBeLessThanOrEqual(30)

  const addKamrail = page.getByRole('button', { name: 'Add kamrail' }).last()
  await closePropertiesForDrawing(page)
  await addKamrail.click()
  const secondRailPoint = await stage.evaluate((element) => {
    const rail = [...element.querySelectorAll<SVGLineElement>('line.shape-line')].find(
      (line) => Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4
    )
    if (!rail) throw new Error('Missing generated one-wire rail.')
    const point = element.createSVGPoint()
    point.x = (Number(rail.getAttribute('x1')) + Number(rail.getAttribute('x2'))) / 2
    point.y = Number(rail.getAttribute('y1')) + 160
    const screen = point.matrixTransform(rail.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(secondRailPoint.x, secondRailPoint.y)
  await expect.poll(async () => (await oneWireGeometry()).rails.length).toBe(2)
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')

  await closePropertiesForDrawing(page)
  await addBreaker.click()
  const secondRailClick = await stage.evaluate((element) => {
    const rails = [...element.querySelectorAll<SVGLineElement>('line.shape-line')]
      .filter((line) => Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4)
      .sort((a, b) => Number(a.getAttribute('y1')) - Number(b.getAttribute('y1')))
    const rail = rails.at(-1)
    if (!rail) throw new Error('Missing second one-wire rail.')
    const point = element.createSVGPoint()
    point.x = Number(rail.getAttribute('x1')) + 20
    point.y = Number(rail.getAttribute('y1'))
    const screen = point.matrixTransform(rail.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(secondRailClick.x, secondRailClick.y)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('D')
  await page.getByRole('button', { name: 'Add breaker', exact: true }).first().click()
  await expect.poll(async () => (await oneWireGeometry()).d).not.toBeNull()
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => element.toSVG())).toContain('D25A')
  const multiRailGeometry = await oneWireGeometry()
  expect(multiRailGeometry.rails).toHaveLength(2)
  expect(multiRailGeometry.rails.find((rail) => rail.y1 === addedGeometry.rail?.y1)).toEqual(addedGeometry.rail)

  await page.locator('cadle-app').evaluate(async (element: any) => {
    await element.flushPendingCircuitUpdates()
    await element.flushPendingSave()
  })
  const editedCircuit = await page
    .locator('app-shell')
    .evaluate((element: any) => element.project?.circuitSpecifications?.A)
  expect(editedCircuit).toMatchObject({
    breakerCurrentA: 25,
    breakerCurve: 'D',
    cableSectionMm2: 4,
    cableConductors: 4,
    hasProtectiveConductor: true,
    cableType: 'XVB-Cca',
    cableInstallation: 'underground',
    phaseConfiguration: 'L2+N',
    neutralPosition: 'right',
    poles: 2,
    showPhaseLabel: true
  })
  const savedSvg = await page.locator('cadle-app').evaluate((element: any) => element.toSVG())
  expect(savedSvg).toContain('D25A')
  expect(savedSvg).toContain('4G4 mm² XVB Cca')
  expect(savedSvg).toContain('L2-N')
  expect(savedSvg).toContain('2P')
  await page.reload()
  await expect(page.locator('projects-field .welcome-bubble')).toHaveCount(0)
  const reopenProject = page.locator('projects-field custom-button[label="Open"]')
  await expect
    .poll(
      async () =>
        (await reopenProject.isVisible()) ||
        (await page.evaluate(() => typeof customElements.get('cadle-app')?.prototype?.toSVG === 'function'))
    )
    .toBe(true)
  if (await reopenProject.isVisible()) await reopenProject.click()
  await expect(page).toHaveURL(/#!\/editor\/model/)
  await expect.poll(() => page.locator('cadle-app').evaluate((element: any) => typeof element.toSVG)).toBe('function')
  const restoredCircuit = await page
    .locator('app-shell')
    .evaluate((element: any) => element.project?.circuitSpecifications?.A)
  expect(restoredCircuit).toMatchObject(editedCircuit)
  const exportedSvg = await page.locator('cadle-app').evaluate((element: any) => element.toSVG())
  expect(exportedSvg).toContain('<svg')
  expect(exportedSvg.length).toBeGreaterThan(1000)
  expect(exportedSvg).toContain('D25A')
  expect(exportedSvg).toContain('4G4 mm² XVB Cca')
  expect(exportedSvg).toContain('L2-N')
  expect(exportedSvg).toContain('2P')
  await expect(page.locator('cadle-app text.onewire-generated-label').first()).toHaveCSS('stroke', 'none')
  const restoredGeometry = await oneWireGeometry()
  expect(restoredGeometry.c).not.toBeNull()
  expect(restoredGeometry.d).not.toBeNull()
  expect(restoredGeometry.rails).toEqual(multiRailGeometry.rails)
})

test('inserts a breaker near the rail start without moving or extending the rail unnecessarily', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()

  await page.locator('project-actions').getByRole('button', { name: 'More' }).click()
  await page.locator('project-actions custom-list-item[data-action="describe-one-wire"]').click()
  const topologyDialog = page.locator('onewire-prompt-dialog')
  await expect(topologyDialog.locator('textarea:not(.json-editor)')).not.toHaveValue('')
  await expect(topologyDialog.locator('textarea:not(.json-editor)')).not.toHaveAttribute('placeholder', '')
  await expect(topologyDialog.locator('.json-editor')).not.toHaveValue('')
  await expect(topologyDialog.locator('custom-button[label="Structuur toepassen"]')).not.toHaveAttribute('disabled')
  await topologyDialog.locator('custom-button[label="Sluiten"]').click()

  const stage = page.locator('cadle-app svg.stage')
  const existingRailIds = await stage
    .locator('line.shape-line')
    .evaluateAll((lines) =>
      lines
        .filter((line) => Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4)
        .map((line) => line.getAttribute('data-shape-id'))
    )
  await page.getByRole('button', { name: 'Add kamrail' }).click()
  const stageBounds = await stage.boundingBox()
  if (!stageBounds) throw new Error('One-wire stage is not visible.')
  await page.mouse.click(stageBounds.x + stageBounds.width * 0.72, stageBounds.y + stageBounds.height * 0.3)
  const railId = await stage.locator('line.shape-line').evaluateAll((lines, previousIds) => {
    const previous = new Set(previousIds)
    return lines
      .filter(
        (line) =>
          Number.parseFloat(getComputedStyle(line).strokeWidth) >= 4 &&
          !previous.has(line.getAttribute('data-shape-id'))
      )
      .map((line) => line.getAttribute('data-shape-id'))
      .at(-1)
  }, existingRailIds)
  if (!railId) throw new Error('The new kamrail was not created.')

  const addSwitch = page.getByRole('button', { name: 'Add switch' })
  await closePropertiesForDrawing(page)
  await addSwitch.click()
  await expect(addSwitch).toHaveAttribute('aria-pressed', 'true')
  expect((await addSwitch.boundingBox())?.height).toBeGreaterThanOrEqual(36)

  const rail = stage.locator(`line[data-shape-id="${railId}"]`)
  const beforeShapeIds = await stage
    .locator('[data-shape-id]')
    .evaluateAll((items) => [...new Set(items.map((item) => item.getAttribute('data-shape-id')).filter(Boolean))])
  const railBefore = await rail.evaluate((line) => ({
    x1: Number(line.getAttribute('x1')),
    x2: Number(line.getAttribute('x2')),
    y: Number(line.getAttribute('y1')),
    strokeWidth: Number.parseFloat(getComputedStyle(line).strokeWidth)
  }))
  const clickPoint = await rail.evaluate((element) => {
    const line = element as SVGLineElement
    const point = line.ownerSVGElement?.createSVGPoint()
    if (!point) throw new Error('Missing SVG point factory.')
    point.x =
      Number(line.getAttribute('x1')) + (Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'))) * 0.1
    point.y = Number(line.getAttribute('y1'))
    const screen = point.matrixTransform(line.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })

  await page.mouse.click(clickPoint.x, clickPoint.y)
  await expect(page.getByRole('heading', { name: 'Add breaker first' })).toBeVisible()
  expect(
    await stage
      .locator('[data-shape-id]')
      .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
  ).toBe(beforeShapeIds.length)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('C')
  await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
  await expect
    .poll(() =>
      stage
        .locator('[data-shape-id]')
        .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
    )
    .toBeGreaterThan(beforeShapeIds.length + 3)
  await expect(page.getByRole('textbox', { name: 'Circuit family' })).toHaveCount(0)
  await expect(addSwitch).toHaveAttribute('aria-pressed', 'true')

  const addedLines = await stage.locator('line[data-shape-id]').evaluateAll((lines, previousIds) => {
    const previous = new Set(previousIds)
    return lines
      .filter((line) => !previous.has(line.getAttribute('data-shape-id') ?? ''))
      .map((line) => ({
        x1: Number(line.getAttribute('x1')),
        x2: Number(line.getAttribute('x2')),
        y1: Number(line.getAttribute('y1')),
        y2: Number(line.getAttribute('y2'))
      }))
  }, beforeShapeIds)
  const verticalLines = addedLines.filter((line) => line.x1 === line.x2)
  expect(verticalLines.length).toBeGreaterThanOrEqual(2)
  expect(verticalLines.some((line) => line.y1 === railBefore.y || line.y2 === railBefore.y)).toBe(true)
  for (const line of verticalLines) expect(line.x1).toBeCloseTo(verticalLines[0].x1)

  const railAfter = await rail.evaluate((line) => ({
    x1: Number(line.getAttribute('x1')),
    x2: Number(line.getAttribute('x2'))
  }))
  expect(railAfter.x2 - railAfter.x1).toBeGreaterThanOrEqual(railBefore.x2 - railBefore.x1)
  const breakerAxis = verticalLines.find((line) => line.y1 === railBefore.y || line.y2 === railBefore.y)!.x1
  expect(railAfter.x1).toBeCloseTo(railBefore.x1)
  expect(railAfter.x2).toBeCloseTo(railBefore.x2)
  expect(breakerAxis - railAfter.x1).toBeGreaterThanOrEqual(20)
  expect(breakerAxis - railAfter.x1).toBeLessThanOrEqual(40)

  const existingSwitch = stage.locator('g[data-selected="true"]')
  const switchBounds = await existingSwitch.boundingBox()
  if (!switchBounds) throw new Error('The newly connected switch is not visible.')
  const beforeExtensionCount = await stage
    .locator('[data-shape-id]')
    .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
  await closePropertiesForDrawing(page)
  await page.getByRole('button', { name: 'Add load' }).click()
  await page.mouse.click(switchBounds.x + switchBounds.width / 2, switchBounds.y + switchBounds.height / 2)
  await expect
    .poll(() =>
      stage
        .locator('[data-shape-id]')
        .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
    )
    .toBe(beforeExtensionCount + 2)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const extension = await stage.locator('line[data-selected="true"]').evaluate((line) => ({
    y1: Number(line.getAttribute('y1')),
    y2: Number(line.getAttribute('y2'))
  }))
  expect(extension.y1).toBeCloseTo(extension.y2)

  await closePropertiesForDrawing(page)
  await page.getByRole('button', { name: 'Add breaker' }).first().click()
  const secondBreakerPoint = await rail.evaluate((line) => {
    const point = line.ownerSVGElement?.createSVGPoint()
    if (!point) throw new Error('Missing SVG point factory.')
    point.x =
      Number(line.getAttribute('x1')) + (Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'))) * 0.3
    point.y = Number(line.getAttribute('y1'))
    const screen = point.matrixTransform(line.getScreenCTM() ?? new DOMMatrix())
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(secondBreakerPoint.x, secondBreakerPoint.y)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('D')
  await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
  const existingBreaker = stage.locator('g.shape-symbol')
    .filter({ has: page.locator('title', { hasText: /^Automaat$/ }) }).last()
  await page.getByRole('button', { name: 'Fit page', exact: true }).click()
  const beforeSwitchCount = await stage
    .locator('[data-shape-id]')
    .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
  await closePropertiesForDrawing(page)
  await addSwitch.click()
  // Click the painted conductor, since the SVG viewport also contains empty
  // space and becomes a larger click target when the device size increases.
  const breakerPoint = await existingBreaker.locator('path').first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(2)
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(breakerPoint.x, breakerPoint.y)
  await expect
    .poll(() =>
      stage
        .locator('[data-shape-id]')
        .evaluateAll((items) => new Set(items.map((item) => item.getAttribute('data-shape-id'))).size)
    )
    .toBe(beforeSwitchCount + 2)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const switchConnection = await stage.locator('line[data-selected="true"]').evaluate((line) => ({
    x1: Number(line.getAttribute('x1')),
    x2: Number(line.getAttribute('x2'))
  }))
  expect(switchConnection.x1).toBeCloseTo(switchConnection.x2)

  const breakerId = await existingBreaker.evaluate((element) =>
    element.closest('[data-shape-id]')?.getAttribute('data-shape-id')
  )
  if (!breakerId) throw new Error('The existing breaker has no shape identity.')
  const railIdsBeforeSecondRail = await stage
    .locator('line.shape-line')
    .evaluateAll((lines) => lines.map((line) => line.getAttribute('data-shape-id')).filter(Boolean))
  await closePropertiesForDrawing(page)
  await page.getByRole('button', { name: 'Add kamrail' }).click()
  const secondRailPoint = await stage.locator('.print-safe-area').evaluate((area) => {
    const rect = area as SVGRectElement
    const point = rect.ownerSVGElement!.createSVGPoint()
    point.x = rect.x.baseVal.value + rect.width.baseVal.value * 0.15
    point.y = rect.y.baseVal.value + rect.height.baseVal.value * 0.12
    const screen = point.matrixTransform(rect.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(secondRailPoint.x, secondRailPoint.y)
  const secondRailId = await stage.locator('line.shape-line').evaluateAll((lines, previousIds) => {
    const previous = new Set(previousIds)
    return lines.map((line) => line.getAttribute('data-shape-id')).find((id) => id && !previous.has(id))
  }, railIdsBeforeSecondRail)
  if (!secondRailId) throw new Error('The second rail has no shape identity.')
  const secondRail = stage.locator(`line[data-shape-id="${secondRailId}"]`)
  await closePropertiesForDrawing(page)
  await page.getByRole('button', { name: 'Add breaker' }).first().click()
  await secondRail.evaluate((line) => {
    const init = { bubbles: true, composed: true, pointerId: 1, pointerType: 'mouse', button: 0 }
    line.dispatchEvent(new PointerEvent('pointerdown', init))
    line.dispatchEvent(new PointerEvent('pointerup', init))
  })
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('E')
  await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
  // An overcrowded drawing can put the independent rail on a continuation sheet.
  // Deleting a breaker must preserve that other rail across the entire project.
  const savedShape = (id: string) => page.locator('app-shell').evaluate((element: any, id) => {
    for (const [key, page] of Object.entries(element.project.pages) as [string, any][]) {
      const shapes = page.schema?.objects?.find((item: any) => item.kind === 'cadle-native-svg-document')?.payload?.shapes ?? []
      const shape = shapes.find((shape: any) => shape.id === id)
      if (shape) return { key, shape }
    }
    return null
  }, id)
  const secondRailBeforeDelete = await savedShape(secondRailId)
  expect(secondRailBeforeDelete).not.toBeNull()
  const breakerPage = await savedShape(breakerId)
  expect(breakerPage).not.toBeNull()
  await page.locator('app-shell').evaluate(async (element: any, key) => { await element.loadPage(key) }, breakerPage!.key)
  await page.locator('cadle-app').evaluate(async (element: any) => { await element.exportA4PNG() })
  await closePropertiesForDrawing(page)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  const deletePoint = await stage.locator(`[data-shape-id="${breakerId}"] path`).first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(2)
    const screen = point.matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(deletePoint.x, deletePoint.y)
  await page.keyboard.press('Delete')
  await page.locator('cadle-app').evaluate(async (element: any) => { await element.flushPendingSave() })
  expect(await savedShape(secondRailId)).toEqual(secondRailBeforeDelete)
})
