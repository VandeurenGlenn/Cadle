import { expect, test } from '@playwright/test'
import { oneWireSymbolScaleFor } from '../../src/editor/layout/onewire-symbol-nodes.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'

test('previews and places catalog symbols at the page-specific size without resizing existing objects', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  const items = [
    { name: 'Switch general symbol', path: 'symbols/Switches/Switch general symbol.svg', ground: 1.3 * 1.05 },
    { name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg', ground: 1.5 * 1.15 },
    { name: 'Spot', path: 'symbols/Consumption appliances/Spot.svg', ground: 1.15 },
    { name: 'Wall outlet with grounding for floorplan', path: 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg', ground: 1.05 }
  ]
  for (const [key, context] of [
    ['00000000-0000-4000-8000-000000000102', 'groundplan'],
    ['00000000-0000-4000-8000-000000000104', 'onewire']
  ] as const) {
    await page.locator('app-shell').evaluate(async (element: any, key) => { await element.loadPage(key) }, key)
    await app.evaluate(async (element: any) => { await element.exportA4PNG() })
    const existing = await app.locator('g.shape-symbol:not(.symbol-preview)').evaluateAll((nodes) =>
      nodes.map((node) => ({ id: node.getAttribute('data-shape-id'), width: node.querySelector('svg')?.getAttribute('width') })))
    await page.getByRole('tab', { name: 'Symbols catalog' }).click()
    for (const [index, item] of items.entries()) {
      const search = page.locator('catalog-element search-element input')
      await search.fill(item.name)
      await expect(page.locator('catalog-element .search-status')).toContainText(item.name)
      await page.locator('catalog-element').getByRole('button', { name: new RegExp(`^Place ${item.name}$`, 'i') }).first().click()
      const point = await app.locator('.world').evaluate((world: SVGGElement, index) => {
        const point = new DOMPoint(1000 + index * 150, 280).matrixTransform(world.getScreenCTM()!)
        return { x: point.x, y: point.y }
      }, index)
      await page.mouse.move(point.x, point.y)
      const expectedWidth = 24 * (context === 'onewire' ? oneWireSymbolScaleFor(item.path)! : item.ground)
      const preview = app.locator('g.symbol-preview > svg')
      await expect(preview).toBeVisible()
      await expect.poll(async () => Number(await preview.getAttribute('width'))).toBeCloseTo(expectedWidth, 5)
      await page.mouse.down()
      await page.mouse.up()
      const placed = app.locator('g.shape-symbol[data-selected="true"]:not(.symbol-preview) > svg')
      await expect(placed).toBeVisible()
      expect(Number(await placed.getAttribute('width'))).toBeCloseTo(expectedWidth, 5)
    }
    for (const shape of existing) {
      await expect(app.locator(`g.shape-symbol[data-shape-id="${shape.id}"] > svg`)).toHaveAttribute('width', shape.width!)
    }
    await page.screenshot({ path: `/private/tmp/cadle-catalog-placement-${context}.png` })
  }
})

test('renders separated, connected multiple sockets in the one-wire diagram and export', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const socket = {
    id: 'multiple-socket', kind: 'symbol', name: 'Wall outlet with grounding for floorplan',
    path: 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg', scale: 1.05,
    position: { x: 600, y: 500 }, rotation: -90, groupId: 'onewire-test',
    electrical: { role: 'load', oneWireEligible: true, circuitType: 'sockets', socketCount: 3 }
  }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'sockets.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
      shapes: [socket], selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680 }))
  })
  const group = app.locator('g.shape-symbol[data-shape-id="multiple-socket"]')
  await expect(group.locator(':scope > svg')).toHaveCount(3)
  await expect(group.locator(':scope > line')).toHaveCount(1)
  const boxes = await group.locator(':scope > svg > g').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom }
    }).sort((a, b) => a.top - b.top))
  expect(boxes).toHaveLength(3)
  expect(boxes[0].bottom).toBeLessThan(boxes[1].top)
  expect(boxes[1].bottom).toBeLessThan(boxes[2].top)
  const exported = await app.evaluate((element: any) => element.toSVG())
  const exportShape = await page.evaluate((markup) => {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const group = doc.querySelector('g[data-shape-id="multiple-socket"]')
    return { copies: group?.querySelectorAll('svg').length, connectors: group?.querySelectorAll('line').length }
  }, exported)
  expect(exportShape).toEqual({ copies: 3, connectors: 1 })
})
