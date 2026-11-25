import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { Project } from '../../src/types.ts'
import type { AppShell } from '../../src/shell/app-shell.ts'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import { nativeStateForProjectPage } from '../../src/editor/model/document-state.ts'

test.use({ hasTouch: true })

test('adds pages quickly with automatic names, type detection and cancel support', async ({ page }, testInfo) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const app = page.locator('cadle-app:not([read-only])')
  const groundKey = '00000000-0000-4000-8000-000000000102'
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())

  const project = await shell.evaluate((element) => (element as AppShell).project!)
  project.uuid = randomUUID()
  project.name = 'Pagina toevoegen test'
  project.pages = {
    [groundKey]: { ...project.pages[groundKey], name: 'Situatieplan', order: 0 }
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
  await page.locator('projects-field custom-list-item[data-name="Pagina toevoegen test"]').click()
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).project?.uuid)).toBe(project.uuid)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)

  const pagePane = page.locator('project-element')
  const addButton = pagePane.getByRole('button', { name: 'Nieuwe pagina' })
  await addButton.click()
  const pageName = pagePane.getByRole('textbox', { name: 'Paginanaam' })
  await expect(pageName).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('page-add-form.png') })
  await pageName.press('Enter')
  await expect.poll(() => shell.evaluate((element) => {
    const created = Object.values((element as AppShell).project!.pages).find((entry) => entry.name === 'Groundplan')
    return created?.pageType
  })).toBe('groundplan')

  await pagePane.getByRole('button', { name: 'Nieuwe pagina' }).click()
  await pageName.fill('Eendraadschema')
  await expect(pagePane.getByRole('combobox', { name: 'Paginatype' })).toHaveValue('onewire')
  await pagePane.getByRole('button', { name: 'Pagina toevoegen' }).click()
  await expect.poll(() => shell.evaluate((element) => {
    const created = Object.values((element as AppShell).project!.pages).find((entry) => entry.name === 'Eendraadschema')
    return created?.pageType
  })).toBe('onewire')
  const oneWireKey = await shell.evaluate((element) =>
    Object.entries((element as AppShell).project!.pages).find(([, entry]) => entry.name === 'Eendraadschema')?.[0])
  const linkSelect = page.getByRole('combobox', { name: 'Installatie van dit blad' })
  await expect(linkSelect).toBeVisible()
  await linkSelect.selectOption(oneWireKey!)
  await expect.poll(() => shell.evaluate((element) => {
    const appShell = element as AppShell
    return appShell.project?.pages[appShell.currentPageKey]?.linkedOneWirePageKey
  })).toBe(oneWireKey)
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).linkedPageKey)).toBe(oneWireKey)
  await linkSelect.selectOption('')
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).linkedPageKey)).toBe('')

  const groundplanKey = await shell.evaluate((element) =>
    Object.entries((element as AppShell).project!.pages).find(([, entry]) => entry.name === 'Groundplan')?.[0])
  const groundplanItem = pagePane.locator(`custom-drawer-item[data-project="${groundplanKey}"]`)
  const oneWireItem = pagePane.locator(`custom-drawer-item[data-project="${oneWireKey}"]`)
  await oneWireItem.click()
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).currentPageKey)).toBe(oneWireKey)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), oneWireKey)).toBe(true)
  await pagePane.locator(`custom-drawer-item[data-project="${groundKey}"]`).click()
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).currentPageKey)).toBe(groundKey)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  await oneWireItem.locator('.page-drag-handle').click()
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).currentPageKey)).toBe(oneWireKey)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), oneWireKey)).toBe(true)
  await pagePane.locator(`custom-drawer-item[data-project="${groundKey}"]`).click({ position: { x: 20, y: 18 } })
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).currentPageKey)).toBe(groundKey)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  await app.evaluate((element) => {
    (element as CadleApp).flushPendingSave = async () => { throw new Error('test save failure') }
  })
  const alert = page.waitForEvent('dialog').then(async (dialog) => {
    const message = dialog.message()
    await dialog.dismiss()
    return message
  })
  await oneWireItem.click()
  expect(await alert).toContain('De huidige pagina kon niet worden opgeslagen')
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).currentPageKey)).toBe(groundKey)
  await app.evaluate((element) => { Reflect.deleteProperty(element, 'flushPendingSave') })
  const oneWireHandleBounds = await oneWireItem.locator('.page-drag-handle').boundingBox()
  expect(oneWireHandleBounds).not.toBeNull()
  await page.touchscreen.tap(oneWireHandleBounds!.x + oneWireHandleBounds!.width / 2, oneWireHandleBounds!.y + oneWireHandleBounds!.height / 2)
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).currentPageKey)).toBe(oneWireKey)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), oneWireKey)).toBe(true)
  const groundBounds = await pagePane.locator(`custom-drawer-item[data-project="${groundKey}"]`).boundingBox()
  expect(groundBounds).not.toBeNull()
  await page.touchscreen.tap(groundBounds!.x + 20, groundBounds!.y + 18)
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).currentPageKey)).toBe(groundKey)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  const groundplanHandle = groundplanItem.locator('.page-drag-handle')
  const oneWireBounds = await oneWireItem.boundingBox()
  const handleBounds = await groundplanHandle.boundingBox()
  expect(handleBounds).not.toBeNull()
  expect(oneWireBounds).not.toBeNull()
  await page.mouse.move(handleBounds!.x + handleBounds!.width / 2, handleBounds!.y + handleBounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBounds!.x + handleBounds!.width / 2, oneWireBounds!.y + oneWireBounds!.height - 2, { steps: 8 })
  await expect(pagePane).toHaveAttribute('data-reordering-pages', '')
  await page.mouse.up()
  await expect.poll(() => shell.evaluate((element) => {
    const project = (element as AppShell).project!
    return Object.values(project.pages).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((entry) => entry.name)
  })).toEqual(['Situatieplan', 'Eendraadschema', 'Groundplan'])
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).currentPageKey)).toBe(groundKey)
  await expect(pagePane.getByRole('button', { name: 'Sleep Groundplan om te ordenen' })).toBeVisible()

  await pagePane.getByRole('button', { name: 'Nieuwe pagina' }).click()
  await pagePane.getByRole('textbox', { name: 'Paginanaam' }).fill('Niet bewaren')
  await pagePane.getByRole('textbox', { name: 'Paginanaam' }).press('Escape')
  await expect(pagePane.getByRole('button', { name: 'Nieuwe pagina' })).toBeVisible()
  expect(await shell.evaluate((element) =>
    Object.values((element as AppShell).project!.pages).some((entry) => entry.name === 'Niet bewaren'))).toBe(false)

  await linkSelect.selectOption(oneWireKey!)
  await expect.poll(() => shell.evaluate((element) => {
    const appShell = element as AppShell
    return appShell.project?.pages[appShell.currentPageKey]?.linkedOneWirePageKey
  })).toBe(oneWireKey)
  const singleLevelAnalysis = await app.evaluate((element, key) =>
    (element as CadleApp).analyzeBindings(key), groundKey)
  const groupedProject = await shell.evaluate((element) => structuredClone((element as AppShell).project!))
  const upperFloorKey = randomUUID()
  const manualKey = randomUUID()
  const otherGroundKey = randomUUID()
  const otherWireKey = randomUUID()
  groupedProject.pages[upperFloorKey] = {
    ...structuredClone(groupedProject.pages[groundKey]),
    name: 'Verdieping',
    order: Object.keys(groupedProject.pages).length,
    linkedOneWirePageKey: oneWireKey as Project['pages'][string]['linkedOneWirePageKey']
  }
  groupedProject.pages[oneWireKey!].oneWireTopology = {
    version: 1, mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300, rcdType: 'A' },
    residualBreaker: false, solar: false, consumers: true
  }
  groupedProject.pages[manualKey] = {
    ...structuredClone(groupedProject.pages[oneWireKey!]),
    name: 'Handmatig eendraadsblad',
    schema: { version: 'native-svg-1', objects: [{
      kind: 'cadle-native-svg-document',
      payload: {
        version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
        shapes: [{ id: 'manual-sheet-note', kind: 'text', position: { x: 200, y: 200 }, text: 'Handmatig blad bewaren' }],
        selectedId: null, paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680
      }
    }] }
  }
  groupedProject.pages[otherWireKey] = {
    ...structuredClone(groupedProject.pages[oneWireKey!]), name: 'Andere installatie'
  }
  groupedProject.pages[otherGroundKey] = {
    ...structuredClone(groupedProject.pages[groundKey]), name: 'Ander gebouw', linkedOneWirePageKey: otherWireKey
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
  }, groupedProject)
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="Pagina toevoegen test"]').click()
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).project?.uuid)).toBe(groupedProject.uuid)
  await pagePane.locator(`custom-drawer-item[data-project="${oneWireKey}"]`).click()
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), oneWireKey)).toBe(true)
  const combinedAnalysis = await app.evaluate((element, key) =>
    (element as CadleApp).analyzeBindings(key), oneWireKey)
  expect(combinedAnalysis.groups.map((group) => group.bindingId)).toEqual(
    singleLevelAnalysis.groups.map((group) => group.bindingId)
  )
  expect(combinedAnalysis.groups.map((group) => group.components.length)).toEqual(
    singleLevelAnalysis.groups.map((group) => group.components.length * 2)
  )
  await shell.evaluate(async (element, key) => { await (element as AppShell).loadPage(key) }, manualKey)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), manualKey)).toBe(true)
  await linkSelect.selectOption(oneWireKey!)
  await expect.poll(() => shell.evaluate((element, key) =>
    (element as AppShell).project?.pages[key]?.oneWireInstallationOf, manualKey)).toBe(oneWireKey)
  await expect(linkSelect.locator(`option[value="${oneWireKey}"]`)).toHaveText(/2 situatie \/ 2 eendraads/)
  const manualAnalysis = await app.evaluate((element) => (element as CadleApp).analyzeBindings())
  expect(manualAnalysis.groups.map((group) => group.components.length)).toEqual(
    combinedAnalysis.groups.map((group) => group.components.length)
  )
  await page.getByRole('button', { name: 'Compare with linked page', exact: true }).click()
  const comparison = page.getByRole('combobox', { name: 'Vergelijkingsblad' })
  await expect(comparison.locator('option')).toHaveCount(2)
  await comparison.selectOption(upperFloorKey)
  await expect.poll(() => page.locator('cadle-app[read-only]').evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), upperFloorKey)).toBe(true)
  await page.getByRole('button', { name: 'Close linked view', exact: true }).click()
  await shell.evaluate(async (element, key) => { await (element as AppShell).loadPage(key) }, groundKey)
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), groundKey)).toBe(true)
  await page.getByRole('button', { name: 'Compare with linked page', exact: true }).click()
  await expect(comparison.locator('option')).toHaveCount(2)
  await comparison.selectOption(manualKey)
  await expect.poll(() => page.locator('cadle-app[read-only]').evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), manualKey)).toBe(true)
  await expect(page.locator('cadle-app[read-only] .shape-text')).toContainText('Handmatig blad bewaren')
  await page.getByRole('button', { name: 'Close linked view', exact: true }).click()

  const diff = page.locator('cadle-actions').getByRole('button', { name: 'Differentieel plaatsen', exact: true })
  await expect(diff.locator('span')).toHaveText('Diff')
  await diff.click()
  const stage = app.locator('svg.stage')
  const bounds = await stage.boundingBox()
  await page.mouse.click(bounds!.x + bounds!.width * 0.6, bounds!.y + bounds!.height * 0.65)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(stage.locator('g.shape-symbol').filter({ has: page.locator('title', { hasText: /^Residual-current circuit breaker$/ }) })).toHaveCount(1)
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())

  await shell.evaluate((element) => (element as AppShell).generateAutoOneWireSchema())
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).currentPageKey)).toBe(oneWireKey)
  const generatedProject = await shell.evaluate((element) => (element as AppShell).project!)
  expect(nativeStateForProjectPage(generatedProject, oneWireKey!)?.shapes.some((shape) => shape.generationKey)).toBe(true)
  expect(nativeStateForProjectPage(generatedProject, manualKey)?.shapes.map((shape) => shape.id)).toEqual(['manual-sheet-note'])
  expect(generatedProject.pages[manualKey].oneWireInstallationOf).toBe(oneWireKey)
  expect(generatedProject.pages[otherGroundKey].linkedOneWirePageKey).toBe(otherWireKey)
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) =>
    (element as CadleApp).waitForPageReady(key), oneWireKey)).toBe(true)
  await expect.poll(() => shell.evaluate((element, key) =>
    (element as AppShell).project?.pages[key]?.oneWireInstallationOf, manualKey)).toBe(oneWireKey)
  await page.screenshot({ path: testInfo.outputPath('multi-sheet-installation.png') })
})
