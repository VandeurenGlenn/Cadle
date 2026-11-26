import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { Project } from '../../src/types.ts'
import type { AppShell } from '../../src/shell/app-shell.ts'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { Shape } from '../../src/editor/model/types.ts'
import { nativeStateForProjectPage } from '../../src/data/project-document.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import { oneWireSymbolConnectionAnchors } from '../../src/editor/layout/onewire-connections.ts'
import { findConnectionIssues } from '../../src/editor/layout/connection-issues.ts'
import { buildSolarInstallation } from '../../src/editor/layout/solar-installation-layout.ts'
import { jsPDF } from 'jspdf'

const openProject = async (page: Page, shapes: Shape[]) => {
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.goto('/#!/projects')
  await expect(page.locator('projects-field')).toBeVisible()
  const pageKey = randomUUID()
  const project: Project = {
    uuid: randomUUID(), creationTime: 1, name: 'PV-installatie',
    customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' }, company: '',
    address: { street: '', number: '', postalCode: '', city: '' },
    pages: { [pageKey]: { creationTime: 1, name: 'Eendraads', pageType: 'onewire',
      schema: { version: 'native-svg-1', objects: [{ kind: 'cadle-native-svg-document', payload: {
        version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
        shapes, selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680
      } }] } } }
  }
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
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  const shell = page.locator('app-shell')
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  const stored = async () => {
    await app.evaluate((element) => (element as CadleApp).flushPendingSave())
    const saved = await shell.evaluate((element) => (element as AppShell).project)
    return nativeStateForProjectPage(saved!, pageKey)!.shapes
  }
  return { app, shell, stored, pageKey }
}

const clickPlacementPoint = async (page: Page, x = 0.62, y = 0.55) => {
  const stage = page.locator('cadle-app:not([read-only]) svg.stage')
  const bounds = await stage.boundingBox()
  if (!bounds) throw new Error('The one-wire drawing stage is not visible.')
  await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y)
}

const clickRail = async (page: Page, railId: string) => {
  const line = page.locator(`cadle-app:not([read-only]) svg.stage line[data-shape-id="${railId}"]`)
  const point = await line.evaluate((element: SVGLineElement) => {
    const world = { x: (element.x1.baseVal.value + element.x2.baseVal.value) / 2,
      y: (element.y1.baseVal.value + element.y2.baseVal.value) / 2 }
    const screen = new DOMPoint(world.x, world.y).matrixTransform(element.getScreenCTM()!)
    return { ...world, screenX: screen.x, screenY: screen.y }
  })
  await page.mouse.click(point.screenX, point.screenY)
  return point
}

const expectPvPlacementMode = (page: Page) =>
  expect(page.getByRole('button', { name: 'PV-installatie plaatsen', exact: true })).toHaveAttribute('aria-pressed', 'true')

test('does not automatically rearrange an older installation with multiple strings', async ({ page }) => {
  const rail: Shape = { id: 'rail', kind: 'line', start: { x: 300, y: 1200 }, end: { x: 1700, y: 1200 },
    groupId: 'onewire-kamrail-test', strokeWidth: 4 }
  const installation = { panel: { manufacturer: 'Test', model: 'P470', powerWp: 470 },
    panelCount: 12, stringCount: 2, inverterManufacturer: 'Test', inverterModel: 'INV',
    inverterPowerW: 5000, phases: 1 as const, breakerCurrentA: 25 }
  let sequence = 0
  const legacy = buildSolarInstallation({ ...installation, stringCount: 1 }, rail.id, { x: 700, y: 1200 },
    () => `legacy-${++sequence}`).map((shape): Shape =>
    shape.kind === 'symbol' && shape.electrical
      ? { ...shape, electrical: { ...shape.electrical, solar: installation } } : shape)
  const { app, stored, pageKey } = await openProject(page, [rail, ...legacy])
  const before = await stored()
  expect(before.filter((shape) => shape.kind === 'symbol' && shape.name === 'Zonnepanelen')).toHaveLength(1)
  expect(before.some((shape) => shape.sourceLink?.role === 'solar-string-connection')).toBe(false)
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  expect(await stored()).toEqual(before)
})

test('moves PV descriptions independently and keeps their position after editing and reloading', async ({ page }) => {
  const rail: Shape = { id: 'rail', kind: 'line', start: { x: 300, y: 1200 }, end: { x: 1700, y: 1200 },
    groupId: 'onewire-kamrail-test', strokeWidth: 4 }
  let sequence = 0
  const solar = buildSolarInstallation({
    panel: { manufacturer: 'Osda', model: 'ODA460', powerWp: 460 },
    panelCount: 24, stringCount: 2, inverterManufacturer: 'Huawei', inverterModel: 'SUN2000',
    inverterPowerW: 8000, phases: 3, breakerCurrentA: 32
  }, rail.id, { x: 700, y: 1200 }, () => `solar-${++sequence}`)
  const { app, stored, pageKey } = await openProject(page, [rail, ...solar])
  const before = await stored()
  const description = before.find((shape) => shape.kind === 'text' && shape.text.startsWith('Osda'))
  if (!description || description.kind !== 'text') throw new Error('PV description not found')
  const hitArea = app.locator(`rect.solar-text-hit-area[data-shape-id="${description.id}"]`)
  const bounds = await hitArea.boundingBox()
  if (!bounds) throw new Error('PV description hit area not found')
  const origin = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 90, origin.y - 35, { steps: 4 })
  await page.mouse.up()
  const moved = await stored()
  const movedText = moved.find((shape) => shape.id === description.id)
  expect(movedText?.kind).toBe('text')
  if (!movedText || movedText.kind !== 'text') throw new Error('Moved PV description not found')
  expect(movedText.position.x).toBeGreaterThan(description.position.x + 20)
  expect(moved.filter((shape) => shape.id !== description.id)).toEqual(before.filter((shape) => shape.id !== description.id))
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  expect((await stored()).find((shape) => shape.id === description.id)).toEqual(movedText)
  await app.locator(`rect.solar-text-hit-area[data-shape-id="${description.id}"]`).click()
  await page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true }).click()
  const dialog = page.locator('solar-installation-dialog')
  await dialog.getByLabel('Aantal panelen', { exact: true }).fill('26')
  await dialog.getByRole('button', { name: 'Installatie bijwerken', exact: true }).click()
  const edited = (await stored()).find((shape) => shape.kind === 'text' && shape.text.startsWith('Osda'))
  expect(edited?.kind).toBe('text')
  if (!edited || edited.kind !== 'text') throw new Error('Edited PV description not found')
  expect(edited.position.x).toBeCloseTo(movedText.position.x, 6)
  expect(edited.position.y).toBeCloseTo(movedText.position.y, 6)
})

test('places a catalog PV breaker connected to the nearest kamrail', async ({ page }) => {
  const rail: Shape = {
    id: 'pv-manual-test-rail', kind: 'line', start: { x: 500, y: 900 }, end: { x: 1500, y: 900 },
    stroke: '#000000', strokeWidth: 4, groupId: 'onewire-kamrail-pv-manual-test'
  }
  const { app, stored, pageKey } = await openProject(page, [rail])
  await page.getByRole('button', { name: 'Add symbol', exact: true }).click()
  const picker = page.locator('symbol-picker-dialog')
  const search = picker.locator('catalog-element search-element input')
  await search.fill('Automaat')
  await expect(picker.locator('.search-status')).toContainText('Automaat')
  await picker.getByRole('button', { name: 'Place automaat', exact: true }).first().click()

  const stage = app.locator('svg.stage')
  const point = await stage.locator('line[data-shape-id="pv-manual-test-rail"]').evaluate((line: SVGLineElement) => {
    const point = new DOMPoint((line.x1.baseVal.value + line.x2.baseVal.value) / 2,
      (line.y1.baseVal.value + line.y2.baseVal.value) / 2).matrixTransform(line.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(point.x, point.y)

  const shapes = await stored()
  const breaker = shapes.find((shape) => shape.kind === 'symbol' && shape.path.endsWith('/Automaat.svg'))
  expect(breaker?.kind).toBe('symbol')
  if (!breaker || breaker.kind !== 'symbol') throw new Error('Manual PV breaker was not placed.')
  expect(breaker.oneWireRailId).toBe('pv-manual-test-rail')
  const terminal = oneWireSymbolConnectionAnchors(breaker).find((anchor) => anchor.side === 'bottom')?.point
  expect(terminal).toBeDefined()
  const connector = shapes.find((shape) => shape.kind === 'line' &&
    shape.oneWireRailId === 'pv-manual-test-rail' && shape.connection?.kind === 'wire')
  expect(connector?.kind).toBe('line')
  if (!connector || connector.kind !== 'line' || !terminal) throw new Error('Manual PV breaker connector was not created.')
  expect(connector.end).toEqual(terminal)
  expect(Math.abs(connector.start.x - 1000)).toBeLessThan(3)
  expect(connector.start.y).toBeCloseTo(898, 5)
  const binding = page.locator('object-pane input.native-binding-input')
  await binding.fill('A')
  await binding.press('Enter')
  const label = app.locator(`.binding-label[data-shape-id="${breaker.id}"] text`)
  await expect(label).toHaveText('A')
  await expect(label).toHaveAttribute('x', String(connector.start.x))
  await expect(label).toHaveAttribute('y', '924')
  await expect(label).toHaveAttribute('style', /font-size:22px;font-weight:500/)
  const exportedLabel = await app.evaluate((element, id) => {
    const svg = new DOMParser().parseFromString((element as CadleApp).toSVG(), 'image/svg+xml')
    const text = svg.querySelector(`.binding-label[data-shape-id="${id}"] text`)
    return { x: text?.getAttribute('x'), y: text?.getAttribute('y'), text: text?.textContent }
  }, breaker.id)
  expect(exportedLabel).toEqual({ x: String(connector.start.x), y: '924', text: 'A' })
  await stored()
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  await expect(label).toHaveText('A')
  await expect(label).toHaveAttribute('x', String(connector.start.x))
  await expect(label).toHaveAttribute('y', '924')
})

test('reads panel and inverter PDFs and preserves an editable 11/12 split for 23 panels', async ({ page }, testInfo) => {
  const { app, stored, pageKey } = await openProject(page, [])
  const trigger = page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true })
  await trigger.click()
  const dialog = page.locator('solar-installation-dialog')
  const panelInput = dialog.getByLabel('PDF of afbeelding van paneelfiche', { exact: true })
  await panelInput.setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await expect(dialog.getByRole('alert')).toContainText('Lezen mislukt')
  await expect(panelInput).toBeEnabled()
  const panels = new jsPDF({ unit: 'pt', format: 'a4' })
  panels.setFontSize(12)
  panels.text('Panel product brochure', 40, 40)
  panels.addPage()
  panels.text([
    'SPECIFICATION (STC)',
    'MODEL TYPE TEST470',
    'Rated Peak Power-Pmax(Wp) 470',
    'Maximum Power Voltage-Vmp(V) 29.55',
    'Maximum Power Current-Imp(A) 15.91',
    'Open Circuit Voltage-Voc(V) 34.77',
    'Short Circuit Current-Isc(A) 16.90'
  ], 40, 40)
  await panelInput.setInputFiles({
    name: 'panels.pdf', mimeType: 'application/pdf', buffer: Buffer.from(panels.output('arraybuffer'))
  })
  await expect(dialog.getByLabel('Paneelmodel', { exact: true })).toHaveValue('TEST470')
  await expect(dialog.getByLabel('Paneelvermogen STC (Wp)', { exact: true })).toHaveValue('470')
  await expect(dialog.getByLabel('Voc (V)', { exact: true })).toHaveValue('34.77')
  const inverter = new jsPDF({ unit: 'pt', format: 'a4' })
  inverter.setFontSize(12)
  inverter.text([
    'Manufacturer: TestInverter',
    'Model INV-10000',
    'Max input voltage 600 V',
    'Number of MPPT trackers 2',
    'Rated output power 10000 W',
    'Rated output voltage 3 W/N + PE'
  ], 40, 40)
  await dialog.getByLabel('PDF of afbeelding van omvormerfiche', { exact: true }).setInputFiles({
    name: 'inverter.pdf', mimeType: 'application/pdf', buffer: Buffer.from(inverter.output('arraybuffer'))
  })
  await expect(dialog.getByLabel('Omvormermodel', { exact: true })).toHaveValue('INV-10000')
  await expect(dialog.getByLabel('Nominaal AC-vermogen omvormer (W)', { exact: true })).toHaveValue('10000')
  await expect(dialog.getByLabel('Fasen omvormer', { exact: true })).toHaveValue('3')
  await dialog.getByLabel('PV-automaat (A)', { exact: true }).fill('32')
  await dialog.getByLabel('Aantal panelen', { exact: true }).fill('23')
  await dialog.getByLabel('Aantal strings', { exact: true }).fill('2')
  const firstString = dialog.getByLabel('String 1 – aantal panelen', { exact: true })
  const secondString = dialog.getByLabel('String 2 – aantal panelen', { exact: true })
  await expect(firstString).toHaveValue('11')
  await expect(secondString).toHaveValue('12')
  await firstString.fill('10')
  await dialog.getByRole('button', { name: 'Plaats PV-installatie', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('samen gelijk')
  await firstString.fill('11')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('pdf-pv-unequal-strings.png') })
  await dialog.getByRole('button', { name: 'Plaats PV-installatie', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await expectPvPlacementMode(page)
  await clickPlacementPoint(page)
  const shapes = await stored()
  expect(shapes.filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(4)
  const stringWires = shapes.filter((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'solar-string-connection')
  expect(stringWires).toHaveLength(2)
  expect(new Set(stringWires.map((shape) => shape.kind === 'line' && `${shape.start.x},${shape.start.y}`)).size).toBe(2)
  expect(findConnectionIssues(shapes)).toEqual([])
  expect(shapes.find((shape) => shape.kind === 'symbol' && shape.name === 'Zonnepanelen')).toMatchObject({
    electrical: { solar: { panelCount: 23, stringCount: 2, panelsPerString: [11, 12] } }
  })
  const svg = await app.evaluate((element) => (element as CadleApp).toSVG())
  expect(svg).toContain('String 1: 11 panelen')
  expect(svg).toContain('String 2: 12 panelen')
  expect(svg).not.toContain('11.5 panelen')
  await app.screenshot({ path: testInfo.outputPath('separate-strings.png') })
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  expect((await stored()).filter((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'solar-string-connection')).toHaveLength(2)
  expect(findConnectionIssues(await stored())).toEqual([])
  await app.locator('text.shape-text').filter({ hasText: '23 x 470 Wp = 10.81 kWp' }).click()
  await trigger.click()
  await expect(firstString).toHaveValue('11')
  await expect(secondString).toHaveValue('12')
  await dialog.getByLabel('Batterij toevoegen', { exact: true }).check()
  await dialog.getByLabel('Batterijmodel', { exact: true }).fill('B10')
  await secondString.fill('13')
  await firstString.fill('10')
  await dialog.getByRole('button', { name: 'Installatie bijwerken', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  expect(await app.evaluate((element) => (element as CadleApp).toSVG())).toContain('String 2: 13 panelen')
  const editedShapes = await stored()
  expect(editedShapes.filter((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'solar-string-connection')).toHaveLength(2)
  expect(editedShapes.some((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'solar-battery-connection')).toBe(true)
  expect(findConnectionIssues(editedShapes)).toEqual([])
  await app.screenshot({ path: testInfo.outputPath('separate-strings-and-battery.png') })
  await app.evaluate((element) => (element as CadleApp).undo())
  expect(await app.evaluate((element) => (element as CadleApp).toSVG())).toContain('String 2: 12 panelen')
})

test('cancels PV placement mode with Escape', async ({ page }) => {
  const { stored } = await openProject(page, [])
  await page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true }).click()
  const dialog = page.locator('solar-installation-dialog')
  await dialog.getByLabel('Onderdeel', { exact: true }).selectOption('panels')
  await dialog.getByLabel('Paneelmodel', { exact: true }).fill('P470')
  await dialog.getByLabel('Paneelvermogen STC (Wp)', { exact: true }).fill('470')
  await dialog.getByRole('button', { name: 'Plaats PV-installatie', exact: true }).click()
  await expectPvPlacementMode(page)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect((await stored()).filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(0)
})

test('adds, edits and removes an optional DC battery on an existing PV installation', async ({ page }) => {
  const { app, stored, pageKey } = await openProject(page, [])
  const trigger = page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true })
  const dialog = page.locator('solar-installation-dialog')
  await trigger.click()
  await dialog.getByLabel('Paneelmodel', { exact: true }).fill('P470')
  await dialog.getByLabel('Paneelvermogen STC (Wp)', { exact: true }).fill('470')
  await dialog.getByLabel('Omvormermodel', { exact: true }).fill('INV-5000')
  await dialog.getByLabel('Nominaal AC-vermogen omvormer (W)', { exact: true }).fill('5000')
  await dialog.getByLabel('PV-automaat (A)', { exact: true }).fill('25')
  await dialog.getByRole('button', { name: 'Plaats PV-installatie', exact: true }).click()
  await clickPlacementPoint(page)
  expect((await stored()).some((shape) => shape.kind === 'symbol' && shape.name === 'Batterij')).toBe(false)

  await trigger.click()
  await dialog.getByLabel('Batterij toevoegen', { exact: true }).check()
  await dialog.getByLabel('Merk batterij', { exact: true }).fill('Testmerk')
  await dialog.getByLabel('Batterijmodel', { exact: true }).fill('B10')
  await dialog.getByLabel('Batterijcapaciteit (kWh)', { exact: true }).fill('10')
  await dialog.getByRole('button', { name: 'Installatie bijwerken', exact: true }).click()
  const shapes = await stored()
  const battery = shapes.find((shape) => shape.kind === 'symbol' && shape.name === 'Batterij')
  expect(battery).toMatchObject({ electrical: { solar: { battery: { manufacturer: 'Testmerk', model: 'B10', capacityKWh: 10 } } } })
  expect(shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'solar-battery-connection'))
    .toMatchObject({ energyFlow: 'bidirectional' })
  expect(findConnectionIssues(shapes)).toEqual([])
  expect(await app.evaluate((element) => (element as CadleApp).toSVG())).toContain('10 kWh')

  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  const reloaded = await stored()
  expect(reloaded.find((shape) => shape.id === battery!.id)).toMatchObject(battery!)
  expect(findConnectionIssues(reloaded)).toEqual([])
  const point = await app.locator(`g.shape-symbol[data-shape-id="${battery!.id}"] path`).first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(4).matrixTransform(path.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(point.x, point.y)
  await trigger.click()
  await expect(dialog.getByLabel('Batterij toevoegen', { exact: true })).toBeChecked()
  await expect(dialog.getByLabel('Batterijmodel', { exact: true })).toHaveValue('B10')
  await dialog.getByLabel('Batterij toevoegen', { exact: true }).uncheck()
  await dialog.getByRole('button', { name: 'Installatie bijwerken', exact: true }).click()
  const removed = await stored()
  expect(removed.some((shape) => shape.kind === 'symbol' && shape.name === 'Batterij')).toBe(false)
  expect(removed.some((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'solar-battery-connection')).toBe(false)
  expect(removed.some((shape) => shape.kind === 'symbol' && shape.name === 'Zonnepanelen')).toBe(true)
})

test('edits the PV breaker circuit and cable like a normal breaker and keeps them after PV edits and reload', async ({ page }) => {
  const { app, stored, pageKey } = await openProject(page, [])
  const trigger = page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true })
  await trigger.click()
  const dialog = page.locator('solar-installation-dialog')
  await dialog.getByLabel('Paneelmodel', { exact: true }).fill('P470')
  await dialog.getByLabel('Paneelvermogen STC (Wp)', { exact: true }).fill('470')
  await dialog.getByLabel('Omvormermodel', { exact: true }).fill('INV-5000')
  await dialog.getByLabel('Nominaal AC-vermogen omvormer (W)', { exact: true }).fill('5000')
  await dialog.getByLabel('PV-automaat (A)', { exact: true }).fill('32')
  await dialog.getByRole('button', { name: 'Plaats PV-installatie', exact: true }).click()
  await clickPlacementPoint(page)
  const breaker = (await stored()).find((shape) => shape.kind === 'symbol' && shape.name === 'PV automaat')!
  await app.locator(`g.shape-symbol[data-shape-id="${breaker.id}"] text.onewire-technical-annotation`)
    .filter({ hasText: 'C32A' }).click()
  const pane = page.locator('object-pane')
  const binding = pane.locator('input.native-binding-input')
  await expect(binding).toBeVisible()
  await binding.fill('A')
  await binding.press('Enter')
  await pane.locator('[data-electrical-field="breakerCurrentA"]').selectOption('25')
  await pane.locator('[data-electrical-field="cableSectionMm2"]').selectOption('6')
  await pane.locator('[data-electrical-field="cableType"]').selectOption('XVB')
  await expect.poll(async () => (await stored()).find((shape) =>
    shape.kind === 'text' && shape.sourceLink?.role === 'solar-ac-cable-label'))
    .toMatchObject({ text: '3G6 mm² XVB', rotation: -90 })
  await expect.poll(async () => (await stored()).find((shape) => shape.id === breaker.id))
    .toMatchObject({ bindingId: 'A', electrical: { cableSectionMm2: 6, cableType: 'XVB' } })
  const label = app.locator(`.binding-label[data-shape-id="${breaker.id}"] text`)
  await expect(label).toHaveText('A')
  const placed = await stored()
  const rail = placed.find((shape) => shape.kind === 'line' && shape.id === breaker.oneWireRailId)
  const feeder = placed.find((shape) => shape.kind === 'line' && shape.groupId === breaker.groupId &&
    shape.connection?.kind === 'wire' && shape.oneWireRailId === breaker.oneWireRailId)
  if (!rail || rail.kind !== 'line' || !feeder || feeder.kind !== 'line') throw new Error('PV rail or feeder missing.')
  await expect(label).toHaveAttribute('x', String(feeder.start.x))
  await expect(label).toHaveAttribute('y', String(rail.start.y + 24))
  await expect(label).toHaveAttribute('style', /font-size:22px;font-weight:500/)
  expect(await app.evaluate((element) => (element as CadleApp).toSVG()))
    .toContain(`x="${feeder.start.x}" y="${rail.start.y + 24}" text-anchor="middle">A</text>`)

  await trigger.click()
  await expect(dialog.getByLabel('PV-automaat (A)', { exact: true })).toHaveValue('25')
  await dialog.getByLabel('Aantal panelen', { exact: true }).fill('2')
  await dialog.getByRole('button', { name: 'Installatie bijwerken', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  const saved = await stored()
  const savedBreaker = saved.find((shape) => shape.kind === 'symbol' && shape.name === 'PV automaat')
  expect(savedBreaker)
    .toMatchObject({ bindingId: 'A', electrical: { cableSectionMm2: 6, cableType: 'XVB' } })
  await expect(app.locator(`.binding-label[data-shape-id="${savedBreaker!.id}"] text`))
    .toHaveAttribute('y', String(rail.start.y + 24))
  expect(saved.find((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'solar-ac-cable-label'))
    .toMatchObject({ text: '3G6 mm² XVB', rotation: -90 })
  const cable = saved.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'solar-ac-cable')
  if (!cable || cable.kind !== 'line') throw new Error('PV cable missing.')
  const line = app.locator(`line[data-shape-id="${cable.id}"]`).first()
  const point = await line.evaluate((element: SVGLineElement) => {
    const point = new DOMPoint(element.x1.baseVal.value * 0.75 + element.x2.baseVal.value * 0.25,
      element.y1.baseVal.value * 0.75 + element.y2.baseVal.value * 0.25).matrixTransform(element.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(point.x, point.y)
  await pane.getByLabel('Doorsnede (mm²)', { exact: true }).selectOption('10')
  await expect.poll(async () => (await stored()).find((shape) => shape.kind === 'symbol' && shape.name === 'PV automaat'))
    .toMatchObject({ bindingId: 'A', electrical: { cableSectionMm2: 10, cableType: 'XVB' } })
  await expect.poll(async () => (await stored()).find((shape) =>
    shape.kind === 'text' && shape.sourceLink?.role === 'solar-ac-cable-label'))
    .toMatchObject({ text: '3G10 mm² XVB' })
  await app.locator(`g.shape-symbol[data-shape-id="${savedBreaker!.id}"] text.onewire-technical-annotation`)
    .filter({ hasText: 'C25A' }).click()
  await binding.fill('D')
  await binding.press('Enter')
  const updatedLabel = app.locator(`.binding-label[data-shape-id="${savedBreaker!.id}"] text`)
  await expect(updatedLabel).toHaveText('D')
  await binding.fill('')
  await binding.press('Enter')
  await expect(updatedLabel).toHaveCount(0)
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(updatedLabel).toHaveText('D')
})

test('reads a scanned PDF datasheet using local OCR', async ({ page }) => {
  await openProject(page, [])
  const raster = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1190
    canvas.height = 1684
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#000000'
    context.font = '32px Arial'
    for (const [index, line] of [
      'SPECIFICATION (STC)',
      'MODEL TYPE TEST470',
      'Rated Peak Power-Pmax(Wp) 470',
      'Maximum Power Voltage-Vmp(V) 29.55',
      'Maximum Power Current-Imp(A) 15.91',
      'Open Circuit Voltage-Voc(V) 34.77',
      'Short Circuit Current-Isc(A) 16.90'
    ].entries()) context.fillText(line, 60, 100 + index * 75)
    return canvas.toDataURL('image/png')
  })
  const scan = new jsPDF({ unit: 'pt', format: 'a4' })
  scan.addImage(raster, 'PNG', 0, 0, 595, 842)
  scan.setFontSize(5)
  scan.text('SPECIFICATION STC MODEL TYPE Rated Peak Power-Pmax(Wp) product specification', 10, 838)
  scan.text('1', 570, 820)
  await page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true }).click()
  const dialog = page.locator('solar-installation-dialog')
  await dialog.getByLabel('Onderdeel', { exact: true }).selectOption('panels')
  await dialog.getByLabel('PDF of afbeelding van paneelfiche', { exact: true }).setInputFiles({
    name: 'scanned-panels.pdf', mimeType: 'application/pdf', buffer: Buffer.from(scan.output('arraybuffer'))
  })
  await expect(dialog.getByRole('status')).toContainText('Herkenning klaar', { timeout: 30_000 })
  await expect(dialog.getByLabel('Paneelvermogen STC (Wp)', { exact: true })).toHaveValue('470')
  await expect(dialog.getByLabel('Voc (V)', { exact: true })).toHaveValue('34.77')
  await dialog.getByRole('button', { name: 'Annuleren', exact: true }).click()
})

test('reviews a multivariant STC datasheet, adds and edits a connected PV installation without moving existing equipment', async ({ page }) => {
  const existing: Shape[] = [
    { id: 'rail', kind: 'line', start: { x: 200, y: 450 }, end: { x: 1400, y: 450 }, strokeWidth: 4, groupId: 'onewire-kamrail-existing' },
    { id: 'diff', kind: 'symbol', name: 'Differentieel', path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
      position: { x: 480, y: 250 }, scale: 1.5, electrical: { role: 'protection', oneWireEligible: true, rcdType: 'A', rcdSensitivityMa: 300 } },
    { id: 'note', kind: 'text', text: 'Bewaren', position: { x: 1600, y: 300 }, scale: 1 }
  ]
  const { app, stored, pageKey } = await openProject(page, existing)
  const initial = await stored()
  const trigger = page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true })
  await trigger.click()
  const dialog = page.locator('solar-installation-dialog')
  await dialog.getByRole('button', { name: 'Annuleren' }).click()
  expect(await stored()).toEqual(initial)
  await trigger.click()
  await dialog.locator('fieldset[data-equipment="panels"] summary').click()
  await dialog.getByRole('textbox', { name: 'Tekst van paneelfiche' }).fill(`SPECIFICATION (STC)
MODEL TYPE ODA450-24V-MHDBRz ODA470-24V-MHDBRz
Rated Peak Power-Pmax(Wp)* 450.00 470.00
Maximum Power Voltage-Vmp(V) 29.38 29.55
Maximum Power Current-Imp(A) 15.31 15.91
Open Circuit Voltage-Voc(V)* 34.57 34.77
Short Circuit Current-Isc(A)* 16.27 16.90
ELECTRICAL DATA(BNPI)
Rated Peak Power-Pmax(Wp)* 499.00 521.00`)
  await dialog.getByRole('button', { name: 'Paneeltekst verwerken' }).click()
  await expect(dialog.getByLabel('Paneelvariant', { exact: true })).toHaveValue('')
  await dialog.getByLabel('Paneelvariant', { exact: true }).selectOption('1')
  await expect(dialog.getByLabel('Paneelvermogen STC (Wp)', { exact: true })).toHaveValue('470')
  await expect(dialog.getByLabel('Voc (V)', { exact: true })).toHaveValue('34.77')
  await dialog.getByLabel('Merk panelen', { exact: true }).fill('OSDA')
  await dialog.getByLabel('Aantal panelen', { exact: true }).fill('12')
  await dialog.getByLabel('Aantal strings', { exact: true }).fill('5')
  await dialog.getByLabel('String 1 – aantal panelen', { exact: true }).fill('1')
  await dialog.getByLabel('Omvormermodel', { exact: true }).fill('INV-5000')
  await dialog.getByLabel('Nominaal AC-vermogen omvormer (W)', { exact: true }).fill('5000')
  await dialog.getByLabel('PV-automaat (A)', { exact: true }).fill('25')
  await dialog.getByRole('button', { name: 'Plaats PV-installatie' }).click()
  await expect(dialog.getByRole('alert')).toContainText('samen gelijk')
  await dialog.getByLabel('Aantal strings', { exact: true }).fill('2')
  await dialog.getByRole('button', { name: 'Plaats PV-installatie' }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await expectPvPlacementMode(page)
  const placementPoint = await clickRail(page, 'rail')
  await expect(app.locator('text.shape-text').filter({ hasText: '12 x 470 Wp = 5.64 kWp' })).toHaveCount(1)
  const added = await stored()
  expect(added.filter((shape) => initial.some((before) => before.id === shape.id))).toEqual(initial)
  expect(added.filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(4)
  const inverter = added.find((shape) => shape.kind === 'symbol' && shape.name === 'PV automaat')
  const feeder = added.find((shape) => shape.kind === 'line' && shape.groupId === inverter?.groupId &&
    shape.oneWireRailId === 'rail' && Math.abs(shape.start.y - placementPoint.y) < 0.01)
  expect(feeder?.kind).toBe('line')
  if (feeder?.kind !== 'line') throw new Error('The PV feeder was not placed on the selected rail.')
  expect(Math.abs(feeder.start.x - placementPoint.x)).toBeLessThan(4)
  expect(await app.evaluate((element) => (element as CadleApp).toSVG())).toContain('Voc 34.77 V')
  await trigger.click()
  await expect(dialog.getByLabel('Paneelmodel', { exact: true })).toHaveValue('ODA470-24V-MHDBRz')
  await dialog.getByLabel('Aantal panelen', { exact: true }).fill('18')
  await dialog.getByLabel('Aantal strings', { exact: true }).fill('3')
  await dialog.getByRole('button', { name: 'Installatie bijwerken' }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await expect(app.locator('text.shape-text').filter({ hasText: '18 x 470 Wp = 8.46 kWp' })).toHaveCount(1)
  expect((await stored()).filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(5)
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(app.locator('text.shape-text').filter({ hasText: '12 x 470 Wp = 5.64 kWp' })).toHaveCount(1)
  await app.evaluate((element) => (element as CadleApp).redo())
  await stored()
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  await expect(app.locator('text.shape-text').filter({ hasText: '18 x 470 Wp = 8.46 kWp' })).toHaveCount(1)
  const saved = await stored()
  expect(saved.filter((shape) => initial.some((before) => before.id === shape.id))).toEqual(initial)
  await app.locator('text.shape-text').filter({ hasText: '18 x 470 Wp = 8.46 kWp' }).click()
  await trigger.click()
  await expect(dialog.getByLabel('Paneelmodel', { exact: true })).toHaveValue('ODA470-24V-MHDBRz')
  await dialog.getByRole('button', { name: 'Annuleren' }).press('Delete')
  await dialog.getByRole('button', { name: 'Annuleren' }).click()
  expect((await stored()).filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(5)
})

test('creates a kamrail on an empty schematic and shows image-import failures explicitly', async ({ page }) => {
  const { app, stored } = await openProject(page, [])
  await page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true }).click()
  const dialog = page.locator('solar-installation-dialog')
  await expect(dialog.locator('form')).toBeVisible()
  await dialog.evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File(['not an image'], 'broken.png', { type: 'image/png' }))
    element.shadowRoot!.querySelector('form')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }))
  })
  await expect(dialog.getByRole('alert')).toContainText('Lezen mislukt')
  await dialog.getByLabel('Paneelmodel', { exact: true }).fill('P470')
  await dialog.getByLabel('Paneelvermogen STC (Wp)', { exact: true }).fill('470')
  await dialog.getByLabel('Omvormermodel', { exact: true }).fill('INV-3000')
  await dialog.getByLabel('Nominaal AC-vermogen omvormer (W)', { exact: true }).fill('3000')
  await dialog.getByLabel('Fasen omvormer', { exact: true }).selectOption('3')
  await dialog.getByLabel('PV-automaat (A)', { exact: true }).fill('16')
  await dialog.getByRole('button', { name: 'Plaats PV-installatie' }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await expectPvPlacementMode(page)
  await clickPlacementPoint(page)
  const shapes = await stored()
  expect(shapes.filter((shape) => shape.groupId?.startsWith('onewire-kamrail-'))).toHaveLength(1)
  expect(shapes.find((shape) => shape.kind === 'symbol' && shape.name === 'PV automaat')).toMatchObject({ electrical: { poles: 4 } })
  await expect(app.locator('text.shape-text').filter({ hasText: '1 x 470 Wp = 0.47 kWp' })).toHaveCount(1)
})

test('imports inverter and panel sheets independently, preserves different brands and edits only the chosen equipment', async ({ page }) => {
  const { app, stored, pageKey } = await openProject(page, [])
  const trigger = page.getByRole('button', { name: 'Omvormer en zonnepanelen', exact: true })
  await trigger.click()
  const dialog = page.locator('solar-installation-dialog')
  await dialog.getByLabel('Onderdeel', { exact: true }).selectOption('inverter')
  await expect(dialog.getByLabel('PDF of afbeelding van paneelfiche', { exact: true })).toHaveCount(0)
  await dialog.locator('fieldset[data-equipment="inverter"] summary').click()
  await dialog.getByLabel('Tekst van omvormerfiche', { exact: true }).fill(`Technical Specification SUN2000-12K- SUN2000-15K- SUN2000-17K- SUN2000-20K- SUN2000-25K-
MB0 MB0 MB0 MB0 MB0
DC Input
Recommended max. PV power 18,000 Wp 22,500 Wp 25,500 Wp 30,000 Wp 37,500 Wp
Max. input voltage 1,100 V
Number of MPPT trackers 2
Output
Rated output power 12,000 W 15,000 W 17,000 W 20,000 W 25,000 W
Max. apparent power 13,200 VA 16,500 VA 18,700 VA 22,000 VA 27,500 VA
Rated output voltage 230 V AC/400 V AC; 3 W/N + PE`)
  await dialog.getByRole('button', { name: 'Omvormertekst verwerken', exact: true }).click()
  await expect(dialog.getByLabel('Omvormervariant', { exact: true })).toHaveValue('')
  await dialog.getByLabel('Omvormervariant', { exact: true }).selectOption('3')
  await expect(dialog.getByLabel('Omvormermodel', { exact: true })).toHaveValue('SUN2000-20K-MB0')
  await expect(dialog.getByLabel('Nominaal AC-vermogen omvormer (W)', { exact: true })).toHaveValue('20000')
  await expect(dialog.getByLabel('Fasen omvormer', { exact: true })).toHaveValue('3')
  await dialog.getByLabel('Merk omvormer', { exact: true }).fill('Huawei')
  await dialog.getByLabel('PV-automaat (A)', { exact: true }).fill('32')
  await dialog.getByRole('button', { name: 'Plaats PV-installatie', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await expectPvPlacementMode(page)
  await clickPlacementPoint(page)
  const inverter = await stored()
  expect(inverter.filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(2)
  expect(inverter.some((shape) => shape.kind === 'symbol' && shape.name === 'Zonnepanelen')).toBe(false)
  await trigger.click()
  await dialog.getByRole('button', { name: 'Nieuw onderdeel toevoegen', exact: true }).click()
  await expect(dialog.getByLabel('Onderdeel', { exact: true })).toHaveValue('panels')
  await expect(dialog.getByLabel('PDF of afbeelding van omvormerfiche', { exact: true })).toHaveCount(0)
  await dialog.locator('fieldset[data-equipment="panels"] summary').click()
  await dialog.getByLabel('Tekst van paneelfiche', { exact: true }).fill(`SPECIFICATION (STC)
MODEL TYPE ODA470-24V-MHDBRz
Rated Peak Power-Pmax(Wp) 470
Maximum Power Voltage-Vmp(V) 29.55
Maximum Power Current-Imp(A) 15.91
Open Circuit Voltage-Voc(V) 34.77
Short Circuit Current-Isc(A) 16.90`)
  await dialog.getByRole('button', { name: 'Paneeltekst verwerken', exact: true }).click()
  await dialog.getByLabel('Merk panelen', { exact: true }).fill('OSDA')
  await dialog.getByLabel('Aantal panelen', { exact: true }).fill('12')
  await dialog.getByLabel('Aantal strings', { exact: true }).fill('2')
  await dialog.getByRole('button', { name: 'Plaats PV-installatie', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await expectPvPlacementMode(page)
  await clickPlacementPoint(page, 0.75, 0.65)
  const separate = await stored()
  expect(separate.filter((shape) => inverter.some((before) => before.id === shape.id))).toEqual(inverter)
  const panels = separate.filter((shape) => !inverter.some((before) => before.id === shape.id))
  expect(panels.every((shape) => shape.kind !== 'line' && !shape.oneWireRailId)).toBe(true)
  expect(panels.find((shape) => shape.kind === 'symbol')).toMatchObject({
    electrical: { solar: { kind: 'panels', panel: { manufacturer: 'OSDA', powerWp: 470 }, panelCount: 12 } }
  })
  const firstPanel = panels.find((shape) => shape.kind === 'symbol' && shape.name === 'Zonnepanelen')
  const secondPanel = panels.filter((shape) => shape.kind === 'symbol' && shape.name === 'Zonnepanelen')[1]
  if (!firstPanel || firstPanel.kind !== 'symbol' || !secondPanel) throw new Error('The separate strings were not placed.')
  const secondPoint = await app.locator(`g.shape-symbol[data-shape-id="${secondPanel.id}"] path`).first()
    .evaluate((path: SVGPathElement) => {
      const point = path.getPointAtLength(4).matrixTransform(path.getScreenCTM()!)
      return { x: point.x, y: point.y }
    })
  await page.mouse.click(secondPoint.x, secondPoint.y)
  await trigger.click()
  await expect(dialog.getByLabel('Merk panelen', { exact: true })).toHaveValue('OSDA')
  await dialog.getByLabel('Aantal panelen', { exact: true }).fill('18')
  await dialog.getByLabel('Aantal strings', { exact: true }).fill('3')
  await dialog.getByRole('button', { name: 'Installatie bijwerken', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  const updated = await stored()
  expect(updated.filter((shape) => inverter.some((before) => before.id === shape.id))).toEqual(inverter)
  expect(updated.find((shape) => shape.kind === 'symbol' && shape.name === 'Zonnepanelen')).toMatchObject({
    position: firstPanel.position
  })
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(app.locator('text.shape-text').filter({ hasText: '12 x 470 Wp' })).toHaveCount(1)
  await app.evaluate((element) => (element as CadleApp).redo())
  await stored()
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  const saved = await stored()
  expect(saved.filter((shape) => inverter.some((before) => before.id === shape.id))).toEqual(inverter)
  expect(saved.filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(5)
  const svg = await app.evaluate((element) => (element as CadleApp).toSVG())
  expect(svg).toContain('Huawei')
  expect(svg).toContain('OSDA')
  expect(svg).toContain('18 x 470 Wp')
})
