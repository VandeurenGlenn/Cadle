import { expect, test, type Page } from '@playwright/test'
import type { AppShell } from '../../src/shell/app-shell.ts'
import type { CatalogItem } from '../../src/elements/catalog/item.ts'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { Catalog } from '../../src/types.ts'

test.use({ serviceWorkers: 'block' })

const openProject = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.evaluate(() => localStorage.removeItem('cadle.catalog.recentSymbols'))
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await expect.poll(() => page.locator('cadle-app:not([read-only])').evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
}

test('shares SVG loading and measurements between catalog categories and recent picks', async ({ page }) => {
  await openProject(page)
  let requests = 0
  await page.route('**/app-performance-preview.svg', async (route) => {
    requests++
    await route.fulfill({ contentType: 'image/svg+xml', body:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" data-perf-catalog="true"><rect x="2" y="2" width="20" height="20" fill="none" stroke="black"/></svg>' })
  })
  const metrics = await page.evaluateHandle(() => {
    let parses = 0, measurements = 0
    const parse = DOMParser.prototype.parseFromString
    const measure = SVGGraphicsElement.prototype.getBBox
    DOMParser.prototype.parseFromString = function (this: DOMParser, ...args: Parameters<DOMParser['parseFromString']>) {
      if (String(args[0]).includes('data-perf-catalog')) parses++
      return parse.apply(this, args)
    }
    SVGGraphicsElement.prototype.getBBox = function (this: SVGGraphicsElement, ...args: Parameters<SVGGraphicsElement['getBBox']>) {
      if (this.hasAttribute('data-perf-catalog')) measurements++
      return measure.apply(this, args)
    }
    return { counts: () => ({ parses, measurements }), restore: () => {
      DOMParser.prototype.parseFromString = parse
      SVGGraphicsElement.prototype.getBBox = measure
    } }
  })
  const symbol = { kind: 'test', name: 'Shared preview', path: 'app-performance-preview.svg' }
  const catalog: Catalog = ['First group', 'Second group'].map((category) => ({ category, symbols: [symbol] }))
  await page.locator('app-shell').evaluate((element, catalog) => { (element as AppShell).catalog = catalog }, catalog)
  await page.getByRole('tab', { name: 'Symbols catalog', exact: true }).click()
  const drawer = page.locator('project-pane catalog-element')
  await drawer.locator('catalog-category').evaluateAll((categories) => {
    for (const category of categories) (category as HTMLElement & { open: boolean }).open = true
  })
  await expect(drawer.locator('catalog-item .preview svg[data-perf-catalog]')).toHaveCount(2)
  expect.soft(requests, 'all visible copies must share one SVG request').toBe(1)
  expect.soft(await metrics.evaluate((counter) => counter.counts()),
    'full and compact previews must be parsed and measured only once each').toEqual({ parses: 2, measurements: 2 })
  await drawer.evaluate((element, symbol) => {
    element.dispatchEvent(new CustomEvent('catalog-symbol-picked', {
      detail: { category: 'First group', symbol }, bubbles: true, composed: true
    }))
  }, symbol)
  await expect(drawer.locator('catalog-item .preview svg[data-perf-catalog]')).toHaveCount(3)
  expect.soft(requests).toBe(1)
  expect.soft(await metrics.evaluate((counter) => counter.counts())).toEqual({ parses: 2, measurements: 2 })
  await metrics.evaluate((counter) => counter.restore())
  await metrics.dispose()
})

test('retains visited project and catalog LiteElements when changing sidebar tabs', async ({ page }) => {
  await openProject(page)
  await page.getByRole('tab', { name: 'Project pages', exact: true }).click()
  const project = await page.locator('project-pane project-element').elementHandle()
  await page.getByRole('tab', { name: 'Symbols catalog', exact: true }).click()
  const catalog = page.locator('project-pane catalog-element')
  const original = await catalog.elementHandle()
  await catalog.locator('input[name="search_catalog"]').fill('Refrigerator')
  await expect(catalog.locator('.search-status')).toContainText('Refrigerator')
  await expect(catalog.locator('catalog-item').first()).toBeVisible()
  await page.getByRole('tab', { name: 'Project pages', exact: true }).click()
  expect.soft(await original!.evaluate((element) => element.isConnected)).toBe(true)
  expect.soft(await project!.evaluate((element) => element.isConnected)).toBe(true)
  await page.getByRole('tab', { name: 'Symbols catalog', exact: true }).click()
  expect.soft(await original!.evaluate((element) => element.isConnected)).toBe(true)
  await expect(catalog.locator('input[name="search_catalog"]')).toHaveValue('Refrigerator')
  await expect(catalog.locator('catalog-item').first()).toBeVisible()
  await original!.dispose()
  await project!.dispose()
})

test('retries failed preview loads and refreshes changed SVG sources', async ({ page }) => {
  await openProject(page)
  let failing = true, requests = 0
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/app-performance-retry.svg', async (route) => {
    requests++
    await route.fulfill(failing ? { status: 503 } : {
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>'
    })
  })
  await page.evaluate(() => {
    const item = document.createElement('catalog-item')
    item.symbol = { name: 'Retry preview', path: 'app-performance-retry.svg' }
    document.body.append(item)
  })
  const item = page.locator('body > catalog-item')
  await expect(item.locator('.preview img')).toHaveCount(1)
  await expect.poll(() => item.locator('img').evaluate((image: HTMLImageElement) => image.complete)).toBe(true)
  expect(errors.some((error) => error.includes('Symboolvoorbeeld laden mislukt.'))).toBe(true)
  const failedRequests = requests
  failing = false
  await item.evaluate((element) => { const card = element as CatalogItem; card.symbol = { ...card.symbol! } })
  await expect(item.locator('.preview svg rect')).toHaveCount(1)
  expect(requests).toBe(failedRequests + 1)
  await item.evaluate((element) => {
    const card = element as CatalogItem
    card.symbol = { name: 'Changed preview', path: 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8"/></svg>') }
  })
  await expect(item.locator('.preview svg circle')).toHaveCount(1)
  await expect(item.locator('.preview svg rect')).toHaveCount(0)
  expect(requests).toBe(failedRequests + 1)
})

test('does not construct inactive routes or closed catalog editor content, and derives linked context once', async ({ page }) => {
  await openProject(page)
  const shell = page.locator('app-shell')
  const linkedReads = await shell.evaluate((element) => {
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'linkedPageKey')!.get!
    let calls = 0
    Object.defineProperty(element, 'linkedPageKey', { configurable: true, get() { calls++; return original.call(this) } })
    try { (element as AppShell).render(); return calls }
    finally { Reflect.deleteProperty(element, 'linkedPageKey') }
  })
  expect.soft(linkedReads).toBe(1)
  expect.soft(await shell.locator('projects-field,settings-field,create-project-field,add-page-field,home-field').count()).toBe(0)
  await page.getByRole('tab', { name: 'Symbols catalog', exact: true }).click()
  const editor = page.locator('project-pane catalog-editor')
  await expect.soft(editor.locator('.panel')).toHaveCount(0)
  await shell.evaluate((element) => (element as AppShell).openCatalogEditor())
  await expect(editor.getByRole('heading', { name: 'Catalog editor', exact: true })).toBeVisible()
  await editor.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(editor.locator('.panel')).toHaveCount(0)
  await page.getByRole('button', { name: 'Instellingen en back-ups', exact: true }).click()
  await expect(page.locator('settings-field')).toBeVisible()
  await expect(page.locator('cadle-app')).toHaveCount(0)
  await page.goBack()
  await expect(page.locator('cadle-app:not([read-only]) .stage')).toBeVisible()
  await expect(shell.locator('projects-field,settings-field,create-project-field,add-page-field,home-field')).toHaveCount(0)
})
