import { expect, test } from '@playwright/test'
import { buildKamrailCircuitBundle } from '../../src/editor/layout/onewire-helpers.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor } from '../../src/editor/layout/onewire-symbol-nodes.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import type { LineShape } from '../../src/editor/model/types.ts'

const state = (shapes: unknown[]) => ({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
  shapes, selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 })

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
  const geometry = () => app.evaluate((element: any) => {
    const svg = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    // Reload normalizes the cached symbol stroke; it must not change any geometry.
    for (const symbol of svg.querySelectorAll<SVGSVGElement>('svg')) symbol.style.removeProperty('--symbol-stroke-width')
    return Object.fromEntries([...svg.querySelectorAll('[data-shape-id]')]
      .map((shape) => [shape.getAttribute('data-shape-id')!, shape.outerHTML]))
  })
  const assertRailCenters = async () => {
    for (const rail of rails) {
      const line = app.locator(`line[data-shape-id="${rail.id}"]`)
      const actual = await line.evaluate((node) => ({
        center: (Number(node.getAttribute('x1')) + Number(node.getAttribute('x2'))) / 2,
        y1: Number(node.getAttribute('y1')), y2: Number(node.getAttribute('y2'))
      }))
      expect(actual).toEqual({ center: (rail.start.x + rail.end.x) / 2, y1: rail.start.y, y2: rail.end.y })
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
    await assertRailCenters()
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
  await assertRailCenters()
})

test('repairs and persists alphabetical circuit placement on an existing rail', async ({ page }) => {
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
    })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id }))
  )]
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'alphabetical-circuits.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...state(shapes), oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION - 1 }))
  })
  const expected = ['U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB']
  const exportedOrder = () => app.evaluate((element: any) => {
    const svg = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    return [...svg.querySelectorAll('text')]
      .filter((text) => /^(?:[U-Z]|AA|AB)$/.test(text.textContent?.trim() ?? ''))
      .sort((left, right) => Number(left.getAttribute('x')) - Number(right.getAttribute('x')))
      .map((text) => text.textContent?.trim())
  })
  const exportedRailPadding = () => app.evaluate((element: any) => {
    const svg = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    const axes = [...svg.querySelectorAll('text')]
      .filter((text) => /^(?:[U-Z]|AA|AB)$/.test(text.textContent?.trim() ?? ''))
      .map((text) => Number(text.getAttribute('x')))
    const rail = svg.querySelector('line[data-shape-id="alphabetical-rail"]')!
    return {
      left: Math.min(...axes) - Number(rail.getAttribute('x1')),
      right: Number(rail.getAttribute('x2')) - Math.max(...axes)
    }
  })
  await expect.poll(exportedOrder).toEqual(expected)
  for (const padding of Object.values(await exportedRailPadding())) expect(padding).toBeCloseTo(20, 6)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000102') })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, root)
  await expect.poll(() => app.evaluate((element: any, key) => element.waitForPageReady(key), root)).toBe(true)
  await expect.poll(exportedOrder).toEqual(expected)
  for (const padding of Object.values(await exportedRailPadding())) expect(padding).toBeCloseTo(20, 6)
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
