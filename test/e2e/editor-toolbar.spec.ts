import { expect, test } from '@playwright/test'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { SymbolShape } from '../../src/editor/model/types.ts'

test('keeps page context and tools visible, with accessible menus on wide and narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const pages = page.locator('project-element')
  await pages.locator('custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const header = page.locator('.editor-header')
  const toolbar = page.getByRole('toolbar', { name: 'Drawing toolbar' })
  await expect(header.getByRole('heading', { name: 'One-wire circuits', exact: true })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Add breaker', exact: true })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Draw wall', exact: true })).toBeHidden()
  await expect(toolbar.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()

  const more = toolbar.getByRole('button', { name: 'More drawing tools', exact: true })
  await more.focus()
  await page.keyboard.press('Enter')
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Draw wall', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(more).toBeFocused()
  await more.click()
  await page.getByRole('button', { name: 'Draw circle', exact: true }).click()
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(more).toHaveAttribute('active', '')
  await toolbar.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(more).not.toHaveAttribute('active')

  const connections = toolbar.getByRole('button', { name: 'Elektrische verbindingen', exact: true })
  await connections.click()
  await expect(page.getByRole('button', { name: 'Teken kabel', exact: true })).toBeVisible()
  await header.getByRole('heading').click()
  await expect(connections).toHaveAttribute('aria-expanded', 'false')
  await page.screenshot({ path: '/private/tmp/cadle-toolbar-desktop.png' })

  for (const width of [960, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(toolbar.getByRole('button', { name: 'Add breaker', exact: true })).toBeInViewport()
    await expect(toolbar.getByRole('button', { name: 'More drawing tools', exact: true })).toBeInViewport()
    const fits = await toolbar.evaluate((element) => {
      const root = element.getBoundingClientRect()
      const actions = element.querySelector('cadle-actions')!
      const native = [...actions.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')]
      const electrical = [...actions.querySelector('onewire-actions')!.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')]
      return [...native, ...electrical].filter((button) => button.checkVisibility()).every((button) => {
        const b = button.getBoundingClientRect()
        return b.left >= root.left && b.right <= root.right && b.top >= root.top && b.bottom <= root.bottom
      })
    })
    expect(fits).toBe(true)
    await connections.click()
    const menu = page.locator('onewire-actions #connection-options')
    await expect(menu).toBeInViewport()
    await page.keyboard.press('Escape')
  }
  await page.screenshot({ path: '/private/tmp/cadle-toolbar-mobile.png' })
  await page.getByRole('button', { name: 'Open project menu' }).click()
  await pages.locator('custom-drawer-item[data-project="00000000-0000-4000-8000-000000000102"]').click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(toolbar.getByRole('button', { name: 'Draw wall', exact: true })).toBeVisible()
  await expect(page.locator('onewire-actions')).toHaveCount(0)
  await page.screenshot({ path: '/private/tmp/cadle-toolbar-floorplan.png' })
})

test('keeps large drawings stable and skips committed SVG work during previews, panning and zooming', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  const path = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="white" stroke="black"/><text x="4" y="16">A</text></svg>')}`
  const shapes: SymbolShape[] = Array.from({ length: 200 }, (_, index) => ({
    id: `perf-${index}`, kind: 'symbol', name: 'Editable symbol', path, scale: 1.5,
    position: { x: 250 + (index % 20) * 70, y: 250 + Math.floor(index / 20) * 90 },
    groupId: index % 4 === 0 ? undefined : `perf-group-${Math.floor(index / 4)}`,
    symbolTextOverrides: { 'text:1': '16A' }
  }))
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'render-performance.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1,
      shapes: [{ ...shapes[0], id: 'perf-hidden', hidden: true }, ...shapes],
      selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, drawingScale: 100,
      worldWidth: 2376, worldHeight: 1680 }))
  })
  const symbols = app.locator('g.shape-symbol[data-shape-id^="perf-"]')
  await expect(symbols.locator('svg rect')).toHaveCount(200)
  await expect(symbols.first().locator('text')).toHaveText('16A')
  const metrics = await page.evaluateHandle(() => {
    let parses = 0
    const original = DOMParser.prototype.parseFromString
    DOMParser.prototype.parseFromString = function (this: DOMParser, ...args: Parameters<DOMParser['parseFromString']>) {
      if (args[1] === 'image/svg+xml') parses++
      return original.apply(this, args)
    }
    return { count: () => parses, reset: () => { parses = 0 }, restore: () => { DOMParser.prototype.parseFromString = original } }
  })
  const points = await app.locator('.world').evaluate((world: SVGGraphicsElement) => {
    const matrix = world.getScreenCTM()!
    return [{ x: 500, y: 1200 }, { x: 800, y: 1350 }].map(({ x, y }) => {
      const point = new DOMPoint(x, y).matrixTransform(matrix)
      return { x: point.x, y: point.y }
    })
  })
  await page.getByRole('button', { name: 'More drawing tools', exact: true }).click()
  await page.getByRole('button', { name: 'Draw circle', exact: true }).click()
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await expect(app.locator('.draft')).toBeVisible()
  const draftWidth = await app.locator('.draft').evaluate((node: SVGGraphicsElement) => node.getBBox().width)
  await metrics.evaluate((counter) => counter.reset())
  await page.mouse.move(points[1].x, points[1].y, { steps: 12 })
  await expect.poll(() => app.locator('.draft').evaluate((node: SVGGraphicsElement) => node.getBBox().width)).toBeGreaterThan(draftWidth)
  expect.soft(await metrics.evaluate((counter) => counter.count()), 'preview must not reparse the 200 committed symbols').toBe(0)
  await page.mouse.up()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Select', exact: true }).first().click()
  await page.keyboard.down('Space')
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await app.evaluate((element) => (element as CadleApp).rendered)
  await metrics.evaluate((counter) => counter.reset())
  const transform = await app.locator('.world').getAttribute('transform')
  await page.mouse.move(points[0].x + 30, points[0].y + 20, { steps: 6 })
  await expect(app.locator('.world')).not.toHaveAttribute('transform', transform!)
  expect.soft(await metrics.evaluate((counter) => counter.count()), 'panning must not reparse committed symbols').toBe(0)
  await page.mouse.up()
  await page.keyboard.up('Space')
  await app.evaluate((element) => (element as CadleApp).rendered)
  await metrics.evaluate((counter) => counter.reset())
  const zoom = await app.getByRole('status', { name: 'Current zoom' }).textContent()
  await app.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(app.getByRole('status', { name: 'Current zoom' })).not.toHaveText(zoom!)
  expect.soft(await metrics.evaluate((counter) => counter.count()), 'zoom must update only the viewport').toBe(0)
  await metrics.evaluate((counter) => counter.reset())
  await app.locator('g.shape-symbol[data-shape-id="perf-4"] > svg').click()
  await expect(page.locator('app-shell #object-inspector')).toHaveAttribute('data-open', 'true')
  await app.locator('g.shape-symbol[data-shape-id="perf-0"] > svg').click()
  await app.evaluate((element) => (element as CadleApp).rendered)
  expect.soft(await metrics.evaluate((counter) => counter.count()),
    'selection changes may inspect the source once, not reparse every symbol').toBeLessThanOrEqual(1)
  await metrics.evaluate((counter) => counter.reset())
  const exported = await app.evaluate((element) => (element as CadleApp).toSVG())
  expect(exported).toContain('>16A</text>')
  expect.soft(await metrics.evaluate((counter) => counter.count()),
    'export must reuse text transformations already displayed by the editor').toBe(0)
  await page.locator('object-pane').getByText('Symbol labels', { exact: true }).click()
  await metrics.evaluate((counter) => counter.reset())
  await page.locator('object-pane').getByPlaceholder('Text 1', { exact: true }).fill('20A')
  await expect(app.locator('g.shape-symbol[data-shape-id="perf-0"] text')).toHaveText('20A')
  await expect(app.locator('g.shape-symbol[data-shape-id="perf-4"] text')).toHaveText('16A')
  expect(await app.evaluate((element) => (element as CadleApp).toSVG())).toContain('>20A</text>')
  expect.soft(await metrics.evaluate((counter) => counter.count()),
    'editing one label must parse only the changed variant').toBeLessThanOrEqual(1)
  await metrics.evaluate((counter) => counter.reset())
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(app.locator('g.shape-symbol[data-shape-id="perf-0"] text')).toHaveText('16A')
  expect.soft(await metrics.evaluate((counter) => counter.count()), 'undo must reuse the earlier text variant').toBe(0)
  await metrics.evaluate((counter) => counter.restore())
  await metrics.dispose()

  const retained = await app.evaluateHandle((element) =>
    [...element.shadowRoot!.querySelectorAll('g.shape-symbol[data-shape-id^="perf-"]')]
      .filter((node) => node.getAttribute('data-shape-id') !== 'perf-0').map((node) => node.querySelector('svg')!))
  const first = app.locator('g.shape-symbol[data-shape-id="perf-0"]')
  await first.locator('svg').click()
  await page.keyboard.press('Delete')
  await expect(first).toHaveCount(0)
  expect.soft(await retained.evaluate((nodes) => nodes.filter((node) => !node.isConnected).length),
    'deleting one symbol must retain every unrelated SVG node').toBe(0)
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(first.locator('text')).toHaveText('16A')
  expect.soft(await retained.evaluate((nodes) => nodes.filter((node) => !node.isConnected).length),
    'undo must also retain unrelated SVG nodes').toBe(0)
  await retained.dispose()
})
