import { expect, test } from '@playwright/test'
import { buildKamrailCircuitBundle } from '../../src/editor/layout/onewire-helpers.ts'
import { buildSolarInstallation } from '../../src/editor/layout/solar-installation-layout.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor, oneWireSymbolTerminalInfo } from '../../src/editor/layout/onewire-symbol-nodes.ts'
import { oneWireSymbolConnectionAnchors } from '../../src/editor/layout/onewire-connections.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import { pageLayout } from '../../src/editor/layout/page-layout.ts'
import type { LineShape, SymbolShape } from '../../src/editor/model/types.ts'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { AppShell } from '../../src/shell/app-shell.ts'

const state = (shapes: unknown[]) => ({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
  shapes, selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 })

test('resizes a busbar without moving its circuits or their connections', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const root = '00000000-0000-4000-8000-000000000104'
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), root)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), root)).toBe(true)
  const rail: LineShape = { id: 'resize-rail', kind: 'line', start: { x: 300, y: 1200 },
    end: { x: 1500, y: 1200 }, groupId: 'onewire-kamrail-resize', strokeWidth: 4 }
  let sequence = 0
  const solar = buildSolarInstallation({
    panel: { manufacturer: 'Osda', model: 'ODA460', powerWp: 460 },
    panelCount: 24, stringCount: 2, inverterManufacturer: 'Huawei', inverterModel: 'SUN2000',
    inverterPowerW: 8000, phases: 3, breakerCurrentA: 32
  }, rail.id, { x: 400, y: 1200 }, () => `resize-solar-${++sequence}`)
  const circuits = ['B', 'C'].flatMap((family, index) => buildKamrailCircuitBundle({
    rail, anchorX: 650 + index * 450, options: { family, amps: 20, autoIncludeFamily: true },
    familyComponents: [{ bindingId: `${family}1`, kind: 'load',
      sourcePath: 'symbols/Consumption appliances/Lighting.svg' }],
    nextShapeId: () => `resize-circuit-${++sequence}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
    symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!, branchStroke: '#000000'
  })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id })))
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'resize-rail.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state([rail, ...solar, ...circuits])))
  })
  const saved = async () => {
    await app.evaluate((element) => (element as CadleApp).flushPendingSave())
    return shell.evaluate((element, key) => {
      const schema = (element as AppShell).project!.pages[key].schema!
      return schema.objects.find((object) => object.kind === 'cadle-native-svg-document')!.payload.shapes
    }, root)
  }
  const initial = await saved()
  expect(initial.some((shape: SymbolShape) => shape.kind === 'symbol' && shape.name === 'PV automaat')).toBe(true)
  expect(initial.some((shape: LineShape) => shape.kind === 'line' &&
    shape.start.x === 400 && shape.start.y === 1200)).toBe(true)
  const railLine = app.locator('line[data-shape-id="resize-rail"]')
  const clickPoint = await railLine.evaluate((line: SVGLineElement) => {
    const point = new DOMPoint(850, 1200).matrixTransform(line.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(clickPoint.x, clickPoint.y)
  await expect(railLine).toHaveAttribute('data-selected', 'true')
  const layout = page.locator('object-pane [data-property-section="layout"]')
  await layout.locator('summary').click()
  await layout.locator('button[title="Extend by one grid block"]').click()
  const extended = await saved()
  const afterRail = extended.find((shape: LineShape) => shape.id === rail.id) as LineShape
  expect(afterRail.start.x).toBe(rail.start.x - 5)
  expect(afterRail.end.x).toBe(rail.end.x + 5)
  expect(extended.filter((shape: LineShape) => shape.id !== rail.id))
    .toEqual(initial.filter((shape: LineShape) => shape.id !== rail.id))
  let alertMessage = ''
  page.once('dialog', (dialog) => {
    alertMessage = dialog.message()
    void dialog.accept()
  })
  const length = layout.locator('label:has-text("Busbar length") + .native-row input')
  await length.fill('4')
  await length.press('Tab')
  expect(alertMessage).toContain('zonder een aansluiting los te maken')
  const shortened = await saved()
  const shortRail = shortened.find((shape: LineShape) => shape.id === rail.id) as LineShape
  expect(shortRail.start.x).toBeLessThanOrEqual(400)
  expect(shortRail.end.x).toBeGreaterThanOrEqual(1100)
  expect(shortened.filter((shape: LineShape) => shape.id !== rail.id))
    .toEqual(initial.filter((shape: LineShape) => shape.id !== rail.id))
  await app.evaluate((element) => (element as CadleApp).undo())
  expect(await saved()).toEqual(extended)
  await app.evaluate((element) => (element as CadleApp).redo())
  expect(await saved()).toEqual(shortened)
  await shell.evaluate((element) => (element as AppShell).loadPage('00000000-0000-4000-8000-000000000102'))
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), root)
  expect(await saved()).toEqual(shortened)
})

test('keeps the rail start close to the first circuit when a fixed feeder is on the right', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const root = '00000000-0000-4000-8000-000000000104'
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), root)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), root)).toBe(true)
  const rail: LineShape = { id: 'rail-short-start', kind: 'line', start: { x: 200, y: 1200 },
    end: { x: 1800, y: 1200 }, groupId: 'onewire-kamrail-short-start', strokeWidth: 4 }
  const feeder: LineShape = { id: 'right-feeder', kind: 'line', start: { x: 1600, y: 1200 },
    end: { x: 1600, y: 1350 }, connection: { kind: 'wire', showLabel: false } }
  let sequence = 0
  const circuits = ['A', 'B'].flatMap((family, index) => buildKamrailCircuitBundle({
    rail, anchorX: 550 + index * 250, options: { family, amps: 16, autoIncludeFamily: true },
    familyComponents: [{ bindingId: `${family}1`, kind: 'load',
      sourcePath: 'symbols/Consumption appliances/Lighting.svg' }],
    nextShapeId: () => `short-start-${++sequence}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
    symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!, branchStroke: '#000000'
  })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id })))
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'rail-short-start.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...state([rail, feeder, ...circuits]),
      oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION - 1 }))
  })
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  const project = await shell.evaluate((element) => (element as AppShell).project!)
  const shapes = project.pages[root].schema!.objects.find((object) => object.kind === 'cadle-native-svg-document')!.payload.shapes
  const updatedRail = shapes.find((shape: LineShape) => shape.id === rail.id) as LineShape
  const updatedFeeder = shapes.find((shape: LineShape) => shape.id === feeder.id) as LineShape
  const breakers = shapes.filter((shape: SymbolShape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker') as SymbolShape[]
  const firstX = Math.min(...breakers.map((breaker) =>
    breaker.position.x + oneWireSymbolTerminalInfo(breaker.path, breaker.scale)!.bottom.x))
  expect(firstX - updatedRail.start.x).toBeCloseTo(20)
  expect(firstX).toBeGreaterThan(pageLayout(2376, 1680).content.x + 96)
  expect(updatedRail.end.x - updatedFeeder.start.x).toBeCloseTo(20)
  expect(updatedFeeder.start.y).toBeCloseTo(updatedRail.start.y)
})

test('places BP beside a continuous feed and persists the inspector label position in the drawing and export', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const root = '00000000-0000-4000-8000-000000000104'
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), root)
  const rail: LineShape = { id: 'rail', kind: 'line', start: { x: 200, y: 1000 }, end: { x: 1800, y: 1000 },
    groupId: 'onewire-kamrail-BP', strokeWidth: 4 }
  let sequence = 0
  const bundle = buildKamrailCircuitBundle({
    rail, anchorX: 600, options: { family: 'BP', amps: 16, autoIncludeFamily: true },
    familyComponents: [{ bindingId: 'BP1', kind: 'load', sourcePath: 'symbols/Consumption appliances/Motor.svg' }],
    nextShapeId: () => `bp-${++sequence}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!
  const feed: LineShape = { id: 'supply-BP', kind: 'line', start: { x: 600, y: 1000 }, end: { x: 600, y: 1250 },
    bindingId: 'BP', connection: { kind: 'wire', showLabel: false } }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'continuous-feed-BP.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state([rail, feed, ...bundle.shapes])))
  })
  const heading = app.locator('text.shape-text').filter({ hasText: /^BP$/ })
  await expect(heading).toHaveCount(1)
  const bounds = () => heading.evaluate((node: SVGTextElement) => {
    const box = node.getBBox()
    return { x: box.x, right: box.x + box.width, y: Number(node.getAttribute('y')) }
  })
  const automatic = await bounds()
  expect(automatic.right).toBeLessThan(feed.start.x - 4)
  await expect(app.locator('.binding-label-text').filter({ hasText: /^BP$/ })).toHaveCount(0)
  const breakerId = bundle.shapes.find((shape) => shape.sourceLink?.role === 'breaker')!.id
  const point = await app.locator(`g.shape-symbol[data-shape-id="${breakerId}"] svg path`).first()
    .evaluate((node: SVGPathElement) => {
      const point = node.getPointAtLength(2).matrixTransform(node.getScreenCTM()!)
      return { x: point.x, y: point.y }
    })
  await page.mouse.click(point.x, point.y)
  const layout = page.locator('object-pane [data-property-section="layout"]')
  await layout.locator('summary').click()
  await layout.getByRole('button', { name: 'Right', exact: true }).click()
  const right = await bounds()
  expect(right.x).toBeGreaterThan(feed.start.x + 4)
  await layout.getByRole('button', { name: 'Right', exact: true }).click()
  expect(await bounds()).toEqual(right)
  await layout.getByRole('button', { name: 'Left', exact: true }).click()
  expect((await bounds()).right).toBeLessThan(feed.start.x - 4)
  await app.evaluate((element) => (element as CadleApp).undo())
  expect(await bounds()).toEqual(right)
  await app.evaluate((element) => (element as CadleApp).redo())
  expect((await bounds()).right).toBeLessThan(feed.start.x - 4)
  await layout.getByRole('button', { name: 'Auto', exact: true }).click()
  expect(await bounds()).toEqual(automatic)
  await layout.getByRole('button', { name: 'Right', exact: true }).click()
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  await shell.evaluate((element) => (element as AppShell).loadPage('00000000-0000-4000-8000-000000000102'))
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), root)
  expect(await bounds()).toEqual(right)
  const exported = await app.evaluate((element) => {
    const svg = new DOMParser().parseFromString((element as CadleApp).toSVG(), 'image/svg+xml')
    return [...svg.querySelectorAll('text')].filter((node) => node.textContent === 'BP').map((node) => Number(node.getAttribute('x')))
  })
  expect(exported).toHaveLength(1)
  expect(exported[0]).toBeGreaterThan(feed.start.x + 4)
  const savedFeed = await app.locator('.connection-conductor[data-shape-id="supply-BP"]').evaluate((node: SVGGeometryElement) => {
    const start = node.getPointAtLength(0), end = node.getPointAtLength(node.getTotalLength())
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } }
  })
  expect(savedFeed).toEqual({ start: feed.start, end: feed.end })
})

test('keeps an upstream differential and its feeders fixed when adding breakers or editing cable properties', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const root = '00000000-0000-4000-8000-000000000104'
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), root)
  const rail: LineShape = { id: 'consumer-rail', kind: 'line', start: { x: 200, y: 1000 }, end: { x: 1800, y: 1000 },
    groupId: 'onewire-kamrail-consumers', strokeWidth: 4 }
  const path = 'symbols/Protection devices/Residual-current circuit breaker.svg'
  const scale = oneWireSymbolScaleFor(path)!
  const top = oneWireSymbolTerminalInfo(path, scale)!.top!
  const differential: SymbolShape = { id: 'fixed-differential', kind: 'symbol', name: 'Differentieel',
    path, scale, position: { x: 680 - top.x, y: 1040 - top.y },
    electrical: { role: 'protection', poles: 4, rcdSensitivityMa: 30 } }
  const bottom = oneWireSymbolConnectionAnchors(differential).find((anchor) => anchor.side === 'bottom')!.point
  const feeder: LineShape = { id: 'fixed-feeder', kind: 'line', start: { x: 680, y: 1000 }, end: { x: 680, y: 1040 },
    connection: { kind: 'wire', showLabel: false } }
  const supply: LineShape = { id: 'fixed-supply', kind: 'line', start: { x: 400, y: bottom.y }, end: { x: 2000, y: bottom.y },
    connection: { kind: 'wire', showLabel: false } }
  let sequence = 0
  const bundle = buildKamrailCircuitBundle({
    rail, anchorX: 600, options: { family: 'BH', amps: 20, autoIncludeFamily: true },
    familyComponents: [{ bindingId: 'BH1', kind: 'load', sourcePath: 'symbols/Consumption appliances/Motor.svg' }],
    nextShapeId: () => `consumer-${++sequence}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'fixed-upstream-differential.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state([rail, differential, feeder, supply, ...bundle.shapes])))
  })
  await expect(app.locator('g.shape-symbol[data-shape-id="fixed-differential"]')).toHaveCount(1)
  const fixed = async () => {
    await app.evaluate((element) => (element as CadleApp).flushPendingSave())
    return shell.evaluate((element, key) => {
      const objects = (element as AppShell).project.pages[key].schema.objects
      const document = objects.find((object) => 'kind' in object && object.kind === 'cadle-native-svg-document') as
        { payload: { shapes: Array<LineShape | SymbolShape> } }
      return document.payload.shapes.filter((shape) => ['fixed-differential', 'fixed-feeder', 'fixed-supply'].includes(shape.id))
    }, root)
  }
  const original = await fixed()
  const expectFixed = async () => {
    expect(await fixed()).toEqual(original)
    const span = await app.locator('line[data-shape-id="consumer-rail"]').evaluate((node: SVGLineElement) => ({
      start: node.x1.baseVal.value, end: node.x2.baseVal.value, y: node.y1.baseVal.value
    }))
    expect((span.start + span.end) / 2).toBeCloseTo(1000, 6)
    expect(span.y).toBe(feeder.start.y)
    expect(span.start).toBeLessThanOrEqual(feeder.start.x)
    expect(span.end).toBeGreaterThanOrEqual(feeder.start.x)
    await expect(app.locator('.onewire-connection-issues [data-wire-id="fixed-feeder"]')).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Add breaker', exact: true }).first().click()
  const point = await app.locator('line[data-shape-id="consumer-rail"]').evaluate((node: SVGLineElement) => {
    const point = new DOMPoint(1000, node.y1.baseVal.value).matrixTransform(node.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(point.x, point.y)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('BI')
  await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
  await expect(app.locator('text.shape-text').filter({ hasText: /^BI$/ })).toHaveCount(1)
  await expectFixed()
  const cableId = bundle.shapes.find((shape) => shape.kind === 'line' && shape.connection?.kind === 'cable')!.id
  const cablePoint = await app.locator(`.connection-conductor[data-shape-id="${cableId}"]`).evaluate((node: SVGGeometryElement) => {
    const point = node.getPointAtLength(node.getTotalLength() / 2).matrixTransform(node.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.getByRole('button', { name: 'Select', exact: true }).first().click()
  await page.mouse.click(cablePoint.x, cablePoint.y)
  await page.locator('object-pane').getByLabel('Benaming verbinding').fill('Voeding van de technische installatie met afzonderlijke kabel voor de motor in de garage')
  await expectFixed()
  await app.evaluate((element) => (element as CadleApp).undo())
  await expectFixed()
  await app.evaluate((element) => (element as CadleApp).redo())
  await expectFixed()
  await shell.evaluate((element) => (element as AppShell).loadPage('00000000-0000-4000-8000-000000000102'))
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), root)
  await expectFixed()
})

test('keeps adjacent busbars independently positioned when inserting breakers and reopening the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const root = '00000000-0000-4000-8000-000000000104'
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element: any) =>
    element.waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, root)
  const rails: LineShape[] = [
    { id: 'left-rail', kind: 'line', start: { x: 200, y: 1100 }, end: { x: 840, y: 1100 },
      strokeWidth: 4, groupId: 'onewire-kamrail-left' },
    { id: 'right-rail', kind: 'line', start: { x: 1320, y: 1100 }, end: { x: 1960, y: 1100 },
      strokeWidth: 4, groupId: 'onewire-kamrail-right' },
    { id: 'lower-rail', kind: 'line', start: { x: 800, y: 1450 }, end: { x: 1800, y: 1450 },
      strokeWidth: 4, groupId: 'onewire-kamrail-lower' }
  ]
  const feeder: LineShape = {
    id: 'manual-feeder', kind: 'line', start: { x: 520, y: 1100 }, end: { x: 800, y: 1450 },
    connection: { kind: 'wire', showLabel: false, via: [{ x: 520, y: 1300 }, { x: 800, y: 1300 }] }
  }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'adjacent-busbars.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state([...rails, feeder])))
  })
  await expect(app.locator('line[data-shape-id="left-rail"]')).toHaveCount(1)
  const geometry = () => app.evaluate((element: any) => {
    const svg = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    // Reload normalizes the cached symbol stroke; it must not change any geometry.
    for (const symbol of svg.querySelectorAll<SVGSVGElement>('svg')) symbol.style.removeProperty('--symbol-stroke-width')
    return Object.fromEntries([...svg.querySelectorAll('[data-shape-id]')]
      .map((shape) => [shape.getAttribute('data-shape-id')!, shape.outerHTML]))
  })
  const assertRailCoverage = async () => {
    for (const rail of rails) {
      const line = app.locator(`line[data-shape-id="${rail.id}"]`)
      const actual = await line.evaluate((node) => ({
        start: Number(node.getAttribute('x1')), end: Number(node.getAttribute('x2')),
        y1: Number(node.getAttribute('y1')), y2: Number(node.getAttribute('y2'))
      }))
      expect(actual.start).toBeLessThanOrEqual(rail.start.x)
      expect(actual.end).toBeGreaterThanOrEqual(rail.end.x)
      expect(actual.y1).toBe(rail.start.y)
      expect(actual.y2).toBe(rail.end.y)
    }
  }
  const addBreaker = async (railId: string, family: string, untouchedIds: string[]) => {
    const before = await geometry()
    const inspector = shell.locator('#object-inspector')
    if (await inspector.getAttribute('data-open') === 'true') {
      await inspector.getByRole('button', { name: 'Close properties' }).click()
    }
    await page.getByRole('button', { name: 'Add breaker', exact: true }).first().click()
    const point = await app.locator(`line[data-shape-id="${railId}"]`).evaluate((node: SVGLineElement) => {
      const point = new DOMPoint(node.x1.baseVal.value + (node.x2.baseVal.value - node.x1.baseVal.value) * 0.8,
        node.y1.baseVal.value).matrixTransform(node.getScreenCTM()!)
      return { x: point.x, y: point.y }
    })
    await page.mouse.click(point.x, point.y)
    await page.getByRole('textbox', { name: 'Circuit family' }).fill(family)
    await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
    await expect.poll(async () => Object.keys(await geometry()).length).toBeGreaterThan(Object.keys(before).length)
    await assertRailCoverage()
    const after = await geometry()
    for (const id of untouchedIds) expect(after[id], `Unchanged ${id} after adding ${family}`).toBe(before[id])
    return [railId, ...Object.keys(after).filter((id) => !before[id])]
  }
  const fixedIds = ['lower-rail', feeder.id]
  const leftIds = await addBreaker('left-rail', 'XA', ['right-rail', ...fixedIds])
  const rightIds = await addBreaker('right-rail', 'XC', [...leftIds, ...fixedIds])
  leftIds.push(...await addBreaker('left-rail', 'XB', [...rightIds, ...fixedIds]))
  const beforeLast = await geometry()
  await addBreaker('right-rail', 'XD', [...leftIds, ...fixedIds])
  const completed = await geometry()
  await app.evaluate((element: any) => element.undo())
  await expect.poll(geometry).toEqual(beforeLast)
  await app.evaluate((element: any) => element.redo())
  await expect.poll(geometry).toEqual(completed)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000102') })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, root)
  await expect.poll(geometry).toEqual(completed)
  await assertRailCoverage()
})

test('repairs and persists alphabetical circuit placement with manual and generated protections on an existing rail', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const root = '00000000-0000-4000-8000-000000000104'
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element: any) =>
    element.waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await page.locator(`project-element custom-drawer-item[data-project="${root}"]`).click()
  await expect.poll(() => app.evaluate((element: any, key) => element.waitForPageReady(key), root)).toBe(true)
  let sequence = 0
  const rail: LineShape = { id: 'alphabetical-rail', kind: 'line', start: { x: 80, y: 1200 }, end: { x: 2200, y: 1200 },
    groupId: 'onewire-kamrail-alphabetical', strokeWidth: 4 }
  const shapes = [rail, ...['U', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'V'].flatMap((family, index) =>
    buildKamrailCircuitBundle({
      rail, anchorX: 200 + index * 240, options: { family, amps: 16, autoIncludeFamily: true },
      familyComponents: [{ bindingId: `${family}1`, kind: 'load',
        sourcePath: 'symbols/Consumption appliances/Lighting.svg', sourceShapeId: `${family}-light` }],
      nextShapeId: () => `alphabetical-${++sequence}`,
      oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
      oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
      symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!, branchStroke: '#000000'
    })!.shapes.map((shape) => {
      if (family !== 'U' && family !== 'W') return { ...shape, oneWireRailId: rail.id }
      const { generationKey, sourceLink, bindingId, ...manual } = shape
      return { ...manual, groupId: `manual-${family}`,
        ...(sourceLink?.role === 'breaker' ? { bindingId: family } : {}) }
    })
  )]
  const manualBreaker = shapes.find((shape) => shape.kind === 'symbol' && shape.bindingId === 'U')
  if (manualBreaker?.kind !== 'symbol') throw new Error('Missing manual circuit U.')
  const top = oneWireSymbolConnectionAnchors(manualBreaker).find((anchor) => anchor.side === 'top')!.point
  const feeder: LineShape = { id: 'manual-top-feeder', kind: 'line', start: top,
    end: { x: top.x, y: top.y - 100 }, connection: { kind: 'wire', showLabel: false } }
  const meter: SymbolShape = { id: 'manual-ungrouped-meter', kind: 'symbol', name: 'kWh meter',
    path: 'symbols/Consumption appliances/kWh meter.svg', scale: 3, position: { x: 0, y: 0 } }
  const meterBottom = oneWireSymbolConnectionAnchors(meter).find((anchor) => anchor.side === 'bottom')!.point
  meter.position = { x: feeder.end.x - meterBottom.x, y: feeder.end.y - meterBottom.y }
  const rcdPath = 'symbols/Protection devices/Residual-current circuit breaker.svg'
  const rcdScale = oneWireSymbolScaleFor(rcdPath)!
  const rcdBottom = oneWireSymbolTerminalInfo(rcdPath, rcdScale)!.bottom
  const unlabelled: SymbolShape = { id: 'manual-unlabelled-rcd', kind: 'symbol', name: 'Differentieel',
    path: rcdPath, scale: rcdScale, position: { x: 2100 - rcdBottom.x, y: rail.start.y - rcdBottom.y },
    electrical: { role: 'protection', poles: 4, rcdSensitivityMa: 30 } }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'alphabetical-circuits.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...state([...shapes, feeder, meter, unlabelled]), oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION - 1 }))
  })
  const expected = ['U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB']
  const exportedOrder = () => app.evaluate((element: any) => {
    const svg = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    return [...svg.querySelectorAll('text.shape-text')]
      .filter((text) => /^(?:[T-Z]|AA|AB)$/.test(text.textContent?.trim() ?? ''))
      .sort((left, right) => Number(left.getAttribute('x')) - Number(right.getAttribute('x')))
      .map((text) => text.textContent?.trim())
  })
  const exportedRailPadding = () => app.evaluate((element: any) => {
    const svg = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    const axes = [...svg.querySelectorAll('text.shape-text')]
      .filter((text) => /^(?:[T-Z]|AA|AB)$/.test(text.textContent?.trim() ?? ''))
      .map((text) => Number(text.getAttribute('x')))
    const rail = svg.querySelector('line[data-shape-id="alphabetical-rail"]')!
    return {
      left: Math.min(...axes) - Number(rail.getAttribute('x1')),
      right: Number(rail.getAttribute('x2')) - Math.max(...axes)
    }
  })
  await expect.poll(exportedOrder).toEqual(expected)
  expect((await exportedRailPadding()).left).toBeGreaterThanOrEqual(20 - 1e-6)
  expect((await exportedRailPadding()).right).toBeGreaterThan(20)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  const saved = await shell.evaluate((element: any, key) =>
    element.project.pages[key].schema.objects.find((object: any) => object.kind === 'cadle-native-svg-document').payload.shapes, root)
  const updatedRcd = saved.find((shape: any) => shape.id === unlabelled.id)
  const updatedRail = saved.find((shape: any) => shape.id === rail.id)
  expect(updatedRail.end.x - updatedRcd.position.x - rcdBottom.x).toBeCloseTo(20, 6)
  expect(updatedRcd.position.y + rcdBottom.y).toBeCloseTo(updatedRail.start.y, 6)
  const assertMeterBranch = async () => {
    await app.evaluate(async (element: any) => { await element.flushPendingSave() })
    const stored = await shell.evaluate((element: any, key) =>
      element.project.pages[key].schema.objects.find((object: any) => object.kind === 'cadle-native-svg-document').payload.shapes, root)
    const breaker = stored.find((shape: any) => shape.id === manualBreaker.id)
    const line = stored.find((shape: any) => shape.id === feeder.id)
    const device = stored.find((shape: any) => shape.id === meter.id)
    const start = oneWireSymbolConnectionAnchors(breaker).find((anchor) => anchor.side === 'top')!.point
    const end = oneWireSymbolConnectionAnchors(device).find((anchor) => anchor.side === 'bottom')!.point
    expect(line.start.x).toBeCloseTo(start.x, 6)
    expect(line.start.y).toBeCloseTo(start.y, 6)
    expect(line.end.x).toBeCloseTo(end.x, 6)
    expect(line.end.y).toBeCloseTo(end.y, 6)
    expect(line.start.x).toBeCloseTo(line.end.x, 6)
    expect(line.connection.routing).toBe(feeder.connection?.routing)
    expect(line.connection.via).toBeUndefined()
    const length = await app.locator(`[data-shape-id="${feeder.id}"] .connection-conductor`)
      .evaluate((node: SVGGeometryElement) => node.getTotalLength())
    expect(length).toBeCloseTo(Math.abs(feeder.start.y - feeder.end.y), 3)
    expect(device.position.x - breaker.position.x).toBeCloseTo(meter.position.x - manualBreaker.position.x, 6)
    expect(device.position.y - breaker.position.y).toBeCloseTo(meter.position.y - manualBreaker.position.y, 6)
  }
  await assertMeterBranch()
  for (const family of ['U', 'W']) {
    const original = shapes.find((shape) => shape.kind === 'symbol' && shape.bindingId === family)
    if (original?.kind !== 'symbol') throw new Error(`Missing manual circuit ${family}.`)
    const updated = saved.find((shape: any) => shape.id === original.id)
    const dx = updated.position.x - original.position.x, dy = updated.position.y - original.position.y
    for (const shape of shapes.filter((shape) => shape.groupId === `manual-${family}`)) {
      const current = saved.find((candidate: any) => candidate.id === shape.id)
      const before = shape.kind === 'line' ? [shape.start, shape.end] : [shape.position]
      const after = shape.kind === 'line' ? [current.start, current.end] : [current.position]
      before.forEach((point, index) => {
        expect(after[index].x).toBeCloseTo(point.x + dx, 6)
        expect(after[index].y).toBeCloseTo(point.y + dy, 6)
      })
    }
  }
  await page.getByRole('button', { name: 'Add breaker', exact: true }).first().click()
  const railPoint = await app.locator('line[data-shape-id="alphabetical-rail"]').evaluate((line: SVGLineElement) => {
    const point = new DOMPoint(line.x2.baseVal.value - 2, line.y2.baseVal.value).matrixTransform(line.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(railPoint.x, railPoint.y)
  await page.getByRole('textbox', { name: 'Circuit family' }).fill('T')
  await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
  expected.unshift('T')
  await expect.poll(exportedOrder).toEqual(expected)
  await assertMeterBranch()
  await app.evaluate((element: any) => element.undo())
  await expect.poll(exportedOrder).toEqual(expected.slice(1))
  await assertMeterBranch()
  await app.evaluate((element: any) => element.redo())
  await expect.poll(exportedOrder).toEqual(expected)
  await assertMeterBranch()
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000102') })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, root)
  await expect.poll(() => app.evaluate((element: any, key) => element.waitForPageReady(key), root)).toBe(true)
  await expect.poll(exportedOrder).toEqual(expected)
  await assertMeterBranch()
  expect((await exportedRailPadding()).left).toBeGreaterThanOrEqual(20 - 1e-6)
  expect((await exportedRailPadding()).right).toBeGreaterThan(20)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  const finalRcdPosition = await shell.evaluate((element: any, key) =>
    element.project.pages[key].schema.objects.find((object: any) => object.kind === 'cadle-native-svg-document')
      .payload.shapes.find((shape: any) => shape.id === 'manual-unlabelled-rcd').position, root)
  expect(finalRcdPosition).toEqual(updatedRcd.position)
})

test('creates continuation sheets without shrinking, and undo restores the whole redistribution', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const root = '00000000-0000-4000-8000-000000000104'
  await page.locator(`project-element custom-drawer-item[data-project="${root}"]`).click()
  const app = page.locator('cadle-app:not([read-only])')
  const shell = page.locator('app-shell')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  let sequence = 0
  const nextId = () => `pagination-${++sequence}`
  const rail: LineShape = { id: 'pagination-rail', kind: 'line', start: { x: 80, y: 1200 }, end: { x: 12000, y: 1200 },
    groupId: 'onewire-kamrail-test', strokeWidth: 4 }
  const families = ['U', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'V',
    ...Array.from({ length: 16 }, (_, index) => String.fromCharCode(65 + index))]
  const shapes = [rail, ...families.map((family, index) => {
    return buildKamrailCircuitBundle({ rail, anchorX: 400 + index * 600, options: { family, amps: 16, autoIncludeFamily: true },
      familyComponents: [1, 2, 3].map((number) => ({ bindingId: `${family}${number}`, kind: 'load' as const,
        sourcePath: 'symbols/Consumption appliances/Lighting.svg', sourceShapeId: `${family}-light-${number}` })),
      nextShapeId: nextId, oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
      oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
      branchStroke: '#000000' })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id }))
  }).flat()]
  const deviceIds = shapes.filter((shape) => shape.sourceLink?.kind === 'device').map((shape) => shape.id).sort()
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'overflow.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state(shapes))) })
  const children = () => shell.evaluate((element: any, root) => Object.entries(element.project.pages)
    .filter(([, page]: any) => page.oneWireOverflowOf === root).map(([key]) => key), root)
  await expect.poll(async () => (await children()).length).toBeGreaterThan(0)
  const keys = await children()
  const collected = () => shell.evaluate((element: any, root) => Object.entries(element.project.pages)
    .filter(([key, page]: any) => key === root || page.oneWireOverflowOf === root)
    .flatMap(([, page]: any) => page.schema.objects[0].payload.shapes)
    .filter((shape: any) => shape.sourceLink?.kind === 'device').map((shape: any) => shape.id).sort(), root)
  const circuitOrder = () => shell.evaluate((element: any, root) => Object.entries(element.project.pages)
    .filter(([key, page]: any) => key === root || page.oneWireOverflowOf === root)
    .flatMap(([, page]: any) => page.schema.objects[0].payload.shapes)
    .filter((shape: any) => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker')
    .map((shape: any) => shape.sourceLink.id), root)
  const expectedOrder = [...Array.from({ length: 16 }, (_, index) => String.fromCharCode(65 + index)),
    'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB']
  expect(await collected()).toEqual(deviceIds)
  expect(await circuitOrder()).toEqual(expectedOrder)
  await app.evaluate((element: any) => element.undo())
  await expect.poll(async () => (await children()).length).toBe(0)
  await app.evaluate((element: any) => element.redo())
  await expect.poll(async () => (await children()).length).toBe(keys.length)
  expect(await collected()).toEqual(deviceIds)
  expect(await circuitOrder()).toEqual(expectedOrder)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, keys[0])
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  expect(await app.evaluate((element: any) => element.toSVG())).toContain('VAN BLAD')
  await page.screenshot({ path: '/private/tmp/cadle-continuation-sheet.png' })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, root)
  expect(await collected()).toEqual(deviceIds)
})

test('marks missed contacts in the editor without exporting the guidance', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'contact.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state([
      { id: 'lamp', kind: 'symbol', name: 'Lamp', path: 'symbols/Consumption appliances/Lighting.svg', scale: 1.5, position: { x: 600, y: 500 } },
      { id: 'missed-wire', kind: 'line', start: { x: 600, y: 508 }, end: { x: 600, y: 700 }, connection: { kind: 'wire', showLabel: false },
        sourceLink: { kind: 'board', id: 'main', role: 'grid-incoming' } }
    ]))) })
  await expect(app.locator('.onewire-connection-issues')).toHaveAttribute('data-issue-count', '1')
  await expect(app.locator('[data-wire-id="missed-wire"] circle')).toHaveAttribute('stroke', '#d97706')
  const exported = await app.evaluate((element: any) => element.toSVG())
  expect(exported).not.toContain('onewire-connection-issues')
  expect(exported).not.toContain('Aansluiting net gemist')
  await page.screenshot({ path: '/private/tmp/cadle-missed-contact.png' })
})
