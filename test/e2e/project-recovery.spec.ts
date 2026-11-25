import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { AppShell } from '../../src/shell/app-shell.ts'
import type { Project, UUID } from '../../src/types.ts'
import type { Shape } from '../../src/editor/model/types.ts'
import { buildKamrailCircuitBundle } from '../../src/editor/layout/onewire-helpers.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor } from '../../src/editor/layout/onewire-symbol-nodes.ts'
import { oneWireSourceSignature } from '../../src/editor/layout/onewire-source-sync.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import { nativeStateForProjectPage } from '../../src/editor/model/document-state.ts'

const ground = '00000000-0000-4000-8000-000000000102' as UUID
const schematic = '00000000-0000-4000-8000-000000000104' as UUID
const nativeState = (shapes: Shape[], layoutVersion = ONE_WIRE_LAYOUT_VERSION) => ({
  version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: layoutVersion,
  drawingScale: 50, shapes, selectedId: null, paperPreset: 'a4-landscape', printMargin: 10,
  worldWidth: 2376, worldHeight: 1680
})
const schema = (shapes: Shape[], version?: number) => ({
  version: 'native-svg-1', objects: [{ kind: 'cadle-native-svg-document', payload: nativeState(shapes, version) }]
})
const lamp = (id = 'lamp'): Shape => ({
  id, kind: 'symbol', name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg',
  position: { x: 800, y: 600 }, scale: 1.5, bindingId: 'A1',
  electrical: { role: 'load', oneWireEligible: true, circuitType: 'lighting' }
})
const fixture = (): Project => ({
  uuid: randomUUID(), creationTime: 1, name: 'P0 recovery',
  customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' }, company: '',
  address: { street: '', number: '', postalCode: '', city: '' },
  circuitSpecifications: { A: { cableSectionMm2: 2.5, breakerCurrentA: 16 } },
  pages: {
    [ground]: { creationTime: 1, name: 'Situatieplan', pageType: 'groundplan', order: 0, schema: schema([lamp()]) },
    [schematic]: { creationTime: 2, name: 'Eendraads', pageType: 'onewire', order: 1, schema: schema([]) }
  }
})

const seed = async (page: Page, project: Project, pageKey = ground) => {
  await page.goto('/#!/projects')
  await expect(page.locator('projects-field')).toBeVisible()
  await page.evaluate(async (project) => {
    const root = await navigator.storage.getDirectory()
    for (const [directory, value] of [['projects', project.name], ['project-data', JSON.stringify(project)]]) {
      const store = await root.getDirectoryHandle(directory, { create: true })
      const handle = await store.getFileHandle(project.uuid, { create: true })
      const writer = await handle.createWritable()
      await writer.write(value)
      await writer.close()
    }
  }, project)
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="P0 recovery"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), ground)).toBe(true)
  if (pageKey !== ground) {
    await page.locator('app-shell').evaluate(async (element, key) => { await (element as AppShell).loadPage(key) }, pageKey)
  }
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  return app
}

const reopen = async (page: Page) => {
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
}

test('reports real write failures, downloads unsaved work and retries pending writes without loss', async ({ page }) => {
  const project = fixture()
  const app = await seed(page, project)
  const status = page.locator('status-bar')
  const symbol = app.locator('g.shape-symbol[data-shape-id="lamp"]')
  await symbol.locator('path').first().click()
  await expect.poll(() => page.locator('app-shell').evaluate((element) => (element as AppShell).selectedObjectCount)).toBe(1)
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.createWritable
    Reflect.set(globalThis, 'restoreProjectWrites', () => { FileSystemFileHandle.prototype.createWritable = original })
    FileSystemFileHandle.prototype.createWritable = async () => { throw new DOMException('Test quota exceeded', 'QuotaExceededError') }
  })
  const binding = page.locator('object-pane').getByPlaceholder('e.g. Q1')
  await binding.fill('A2')
  await expect(status.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'error')
  await expect(status).toContainText('Opslaan mislukt')
  await expect(status).not.toContainText('Opgeslagen')
  await binding.fill('A3')
  const downloadEvent = page.waitForEvent('download')
  await status.getByRole('button', { name: 'Herstelbestand downloaden' }).click()
  const download = await downloadEvent
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as Project
  const shapes = (exported.pages[ground].schema.objects[0] as { payload: { shapes: Shape[] } }).payload.shapes
  const moved = shapes.find((shape) => shape.id === 'lamp')
  expect(moved?.bindingId).toBe('A3')
  await page.evaluate(() => {
    const restore: unknown = Reflect.get(globalThis, 'restoreProjectWrites')
    if (typeof restore === 'function') restore()
  })
  await status.getByRole('button', { name: 'Opnieuw proberen' }).click()
  await expect(status.locator('[data-save-state]')).toHaveAttribute('data-save-state', 'saved')
  await reopen(page)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), ground)).toBe(true)
  await expect(app.locator('g.binding-label[data-shape-id="lamp"]')).toContainText('A3')
  const canvasZoom = await app.getByLabel('Current zoom').textContent()
  await expect(status.getByTitle('Cycle zoom(50% / 100% / 200%)')).toContainText(canvasZoom!)
  await status.getByTitle('Cycle zoom(50% / 100% / 200%)').click()
  await expect(app.getByLabel('Current zoom')).toHaveText('50%')
})

test('restores a full project through History after restarting and keeps the pre-restore state', async ({ page }) => {
  const project = fixture()
  const app = await seed(page, project)
  const shell = page.locator('app-shell')
  await app.evaluate((element) => (element as CadleApp).createRecoveryPoint('Mijn controlepunt'))
  await shell.evaluate((element, schematic) => {
    const shell = element as AppShell
    shell.project.circuitSpecifications = { A: { cableSectionMm2: 10 } }
    delete shell.project.pages[schematic]
  }, schematic)
  await app.evaluate((element) => (element as CadleApp).createRecoveryPoint('Na wijzigingen'))
  expect(await shell.evaluate((element) => (element as AppShell).project.circuitSpecifications?.A.cableSectionMm2)).toBe(10)
  expect(await shell.evaluate((element, key) => Boolean((element as AppShell).project.pages[key]), schematic)).toBe(false)
  await reopen(page)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), ground)).toBe(true)
  await shell.evaluate((element) => (element as AppShell).toggleHistoryPanel())
  const panel = page.locator('history-panel')
  const entry = panel.locator('.entry').filter({ hasText: 'Mijn controlepunt' })
  await expect(entry).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await entry.getByRole('button', { name: 'Dit project herstellen' }).click()
  await expect.poll(() => shell.evaluate((element, key) => Boolean((element as AppShell).project.pages[key]), schematic)).toBe(true)
  expect(await shell.evaluate((element) => (element as AppShell).project.circuitSpecifications?.A.cableSectionMm2)).toBe(2.5)
  await reopen(page)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), ground)).toBe(true)
  expect(await shell.evaluate((element, key) => Boolean((element as AppShell).project.pages[key]), schematic)).toBe(true)
  await shell.evaluate((element) => (element as AppShell).toggleHistoryPanel())
  await expect(panel.locator('.entry').filter({ hasText: 'Vóór herstel' })).toBeVisible()
})

test('source changes update linked content without repacking other rails and can be restored durably', async ({ page }) => {
  const project = fixture()
  project.pages[ground].linkedOneWirePageKey = schematic
  let sequence = 0
  const rail: Shape = { id: 'rail', kind: 'line', start: { x: 300, y: 1100 }, end: { x: 900, y: 1100 },
    groupId: 'onewire-kamrail-main', strokeWidth: 4 }
  const otherRail: Shape = { ...rail, id: 'other-rail', start: { x: 1300, y: 1300 }, end: { x: 1950, y: 1300 },
    groupId: 'onewire-kamrail-other' }
  const components = ['lamp'].map((sourceShapeId) => ({
    bindingId: 'A1', kind: 'load' as const, sourceShapeId, sourcePath: 'symbols/Consumption appliances/Lighting.svg'
  }))
  const bundle = buildKamrailCircuitBundle({
    rail, anchorX: 550, familyComponents: components, options: { family: 'A', amps: 16, autoIncludeFamily: true },
    nextShapeId: () => `linked-${++sequence}`, oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!
  const manual: Shape = { id: 'manual-bends', kind: 'line', start: { x: 1400, y: 1300 }, end: { x: 1500, y: 800 },
    connection: { kind: 'wire', via: [{ x: 1400, y: 1000 }, { x: 1500, y: 1000 }] } }
  project.pages[schematic].schema = schema([rail, otherRail, manual, ...bundle.shapes.map((shape) => ({
    ...shape, oneWireRailId: rail.id,
    ...(shape.sourceLink?.role === 'breaker' ? { oneWireSourceSignature: oneWireSourceSignature(components) } : {})
  }))], 1)
  const app = await seed(page, project, schematic)
  const shell = page.locator('app-shell')
  const geometry = () => app.evaluate((element) => {
    const svg = new DOMParser().parseFromString((element as CadleApp).toSVG(), 'image/svg+xml')
    return ['rail', 'other-rail', 'manual-bends'].map((id) => svg.querySelector(`[data-shape-id="${id}"]`)?.outerHTML)
  })
  const initial = await geometry()
  await shell.evaluate(async (element, ground) => { await (element as AppShell).loadPage(ground) }, ground)
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({
    name: 'source-update.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(nativeState([lamp(), lamp('second-lamp')])))
  })
  await expect(app.locator('g.shape-symbol[data-shape-id="second-lamp"]')).toBeVisible()
  await shell.evaluate(async (element, schematic) => { await (element as AppShell).loadPage(schematic) }, schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await expect(app.locator('text').filter({ hasText: /^x2$/ })).toHaveCount(1)
  expect(await geometry()).toEqual(initial)
  await reopen(page)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  expect(await geometry()).toEqual(initial)
  await shell.evaluate((element) => (element as AppShell).toggleHistoryPanel())
  const entry = page.locator('history-panel .entry').filter({ hasText: 'Vóór synchronisatie eendraads' }).first()
  await expect(entry).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await entry.getByRole('button', { name: 'Dit project herstellen' }).click()
  await expect(app.locator('text').filter({ hasText: /^x2$/ })).toHaveCount(0)
  await reopen(page)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await expect(app.locator('text').filter({ hasText: /^x2$/ })).toHaveCount(0)
  expect(await geometry()).toEqual(initial)
})

test('only synchronizes explicitly linked situation plans within their own installation', async ({ page }) => {
  const project = fixture()
  const otherGround = randomUUID() as UUID, otherWire = randomUUID() as UUID, unlinkedWire = randomUUID() as UUID
  project.pages[ground].linkedOneWirePageKey = schematic
  project.pages[ground].schema = schema([lamp(), lamp('second-lamp')])
  project.pages[otherGround] = { creationTime: 3, name: 'Andere situatie', pageType: 'groundplan',
    linkedOneWirePageKey: otherWire, schema: schema([lamp('other-lamp'), lamp('other-second')]) }
  const makeDiagram = (prefix: string, sourceId: string): Shape[] => {
    let sequence = 0
    const rail: Shape = { id: `${prefix}-rail`, kind: 'line', start: { x: 300, y: 1100 },
      end: { x: 900, y: 1100 }, groupId: `onewire-kamrail-${prefix}`, strokeWidth: 4 }
    const components = [{ bindingId: 'A1', kind: 'load' as const, sourceShapeId: sourceId,
      sourcePath: 'symbols/Consumption appliances/Lighting.svg' }]
    const bundle = buildKamrailCircuitBundle({
      rail, anchorX: 550, familyComponents: components, options: { family: 'A', amps: 16, autoIncludeFamily: true },
      nextShapeId: () => `${prefix}-${++sequence}`,
      oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
      oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
      symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!, branchStroke: '#000000'
    })!
    return [rail, ...bundle.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id,
      ...(shape.sourceLink?.role === 'breaker' ? { oneWireSourceSignature: oneWireSourceSignature(components) } : {})
    }))]
  }
  project.pages[schematic].schema = schema(makeDiagram('first', 'lamp'))
  project.pages[otherWire] = { creationTime: 4, name: 'Andere eendraads', pageType: 'onewire',
    schema: schema(makeDiagram('other', 'other-lamp')) }
  project.pages[unlinkedWire] = { creationTime: 5, name: 'Onafhankelijke eendraads', pageType: 'onewire',
    schema: schema(makeDiagram('unlinked', 'lamp')) }
  const untouched = structuredClone(project.pages[unlinkedWire].schema)
  await seed(page, project)
  const shell = page.locator('app-shell')
  const current = await shell.evaluate((element) => (element as AppShell).project!)
  const signature = (key: UUID) => nativeStateForProjectPage(current, key)!.shapes
    .find((shape) => shape.sourceLink?.role === 'breaker')?.oneWireSourceSignature
  expect(signature(schematic)).toContain('second-lamp')
  expect(signature(otherWire)).toContain('other-second')
  expect(signature(otherWire)).not.toContain('second-lamp')
  expect(current.pages[unlinkedWire].schema).toEqual(untouched)
  await reopen(page)
  await expect.poll(() => shell.evaluate((element, key) =>
    (element as AppShell).project?.pages?.[key]?.schema, unlinkedWire)).toEqual(untouched)
})
