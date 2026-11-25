import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { Project } from '../../src/types.ts'
import type { AppShell } from '../../src/shell/app-shell.ts'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { Shape } from '../../src/editor/model/types.ts'
import { nativeStateForProjectPage } from '../../src/data/project-document.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
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
  await dialog.getByRole('button', { name: 'Toevoegen aan schema', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('samen gelijk')
  await firstString.fill('11')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('pdf-pv-unequal-strings.png') })
  await dialog.getByRole('button', { name: 'Toevoegen aan schema', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  const shapes = await stored()
  expect(shapes.filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(3)
  expect(shapes.find((shape) => shape.kind === 'symbol' && shape.name === 'Zonnepanelen')).toMatchObject({
    electrical: { solar: { panelCount: 23, stringCount: 2, panelsPerString: [11, 12] } }
  })
  const svg = await app.evaluate((element) => (element as CadleApp).toSVG())
  expect(svg).toContain('String 1: 11 panelen')
  expect(svg).toContain('String 2: 12 panelen')
  expect(svg).not.toContain('11.5 panelen')
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  await app.locator('text.shape-text').filter({ hasText: '23 x 470 Wp = 10.81 kWp' }).click()
  await trigger.click()
  await expect(firstString).toHaveValue('11')
  await expect(secondString).toHaveValue('12')
  await secondString.fill('13')
  await firstString.fill('10')
  await dialog.getByRole('button', { name: 'Installatie bijwerken', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  expect(await app.evaluate((element) => (element as CadleApp).toSVG())).toContain('String 2: 13 panelen')
  await app.evaluate((element) => (element as CadleApp).undo())
  expect(await app.evaluate((element) => (element as CadleApp).toSVG())).toContain('String 2: 12 panelen')
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
  await dialog.getByRole('button', { name: 'Toevoegen aan schema' }).click()
  await expect(dialog.getByRole('alert')).toContainText('samen gelijk')
  await dialog.getByLabel('Aantal strings', { exact: true }).fill('2')
  await dialog.getByRole('button', { name: 'Toevoegen aan schema' }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await expect(app.locator('text.shape-text').filter({ hasText: '12 x 470 Wp = 5.64 kWp' })).toHaveCount(1)
  const added = await stored()
  expect(added.filter((shape) => initial.some((before) => before.id === shape.id))).toEqual(initial)
  expect(added.filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(3)
  expect(await app.evaluate((element) => (element as CadleApp).toSVG())).toContain('Voc 34.77 V')
  await trigger.click()
  await expect(dialog.getByLabel('Paneelmodel', { exact: true })).toHaveValue('ODA470-24V-MHDBRz')
  await dialog.getByLabel('Aantal panelen', { exact: true }).fill('18')
  await dialog.getByLabel('Aantal strings', { exact: true }).fill('3')
  await dialog.getByRole('button', { name: 'Installatie bijwerken' }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  await expect(app.locator('text.shape-text').filter({ hasText: '18 x 470 Wp = 8.46 kWp' })).toHaveCount(1)
  expect((await stored()).filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(3)
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
  expect((await stored()).filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(3)
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
  await dialog.getByRole('button', { name: 'Toevoegen aan schema' }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
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
  await dialog.getByRole('button', { name: 'Toevoegen aan schema', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
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
  await dialog.getByRole('button', { name: 'Toevoegen aan schema', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  const separate = await stored()
  expect(separate.filter((shape) => inverter.some((before) => before.id === shape.id))).toEqual(inverter)
  const panels = separate.filter((shape) => !inverter.some((before) => before.id === shape.id))
  expect(panels.every((shape) => shape.kind !== 'line' && !shape.oneWireRailId)).toBe(true)
  expect(panels.find((shape) => shape.kind === 'symbol')).toMatchObject({
    electrical: { solar: { kind: 'panels', panel: { manufacturer: 'OSDA', powerWp: 470 }, panelCount: 12 } }
  })
  await trigger.click()
  await expect(dialog.getByLabel('Merk panelen', { exact: true })).toHaveValue('OSDA')
  await dialog.getByLabel('Aantal panelen', { exact: true }).fill('18')
  await dialog.getByLabel('Aantal strings', { exact: true }).fill('3')
  await dialog.getByRole('button', { name: 'Installatie bijwerken', exact: true }).click()
  await expect(dialog).not.toHaveAttribute('data-open')
  const updated = await stored()
  expect(updated.filter((shape) => inverter.some((before) => before.id === shape.id))).toEqual(inverter)
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(app.locator('text.shape-text').filter({ hasText: '12 x 470 Wp' })).toHaveCount(1)
  await app.evaluate((element) => (element as CadleApp).redo())
  await stored()
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="PV-installatie"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), pageKey)).toBe(true)
  const saved = await stored()
  expect(saved.filter((shape) => inverter.some((before) => before.id === shape.id))).toEqual(inverter)
  expect(saved.filter((shape) => shape.kind === 'symbol' && shape.electrical?.solar)).toHaveLength(3)
  const svg = await app.evaluate((element) => (element as CadleApp).toSVG())
  expect(svg).toContain('Huawei')
  expect(svg).toContain('OSDA')
  expect(svg).toContain('18 x 470 Wp')
})
