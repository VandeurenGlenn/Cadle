import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { AppShell } from '../../src/shell/app-shell.ts'
import type { Project } from '../../src/types.ts'
import type { SymbolShape } from '../../src/editor/model/types.ts'
import { DEFAULT_AREI_PROFILE } from '../../src/editor/electrical-profile.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import { nativeStateForProjectPage } from '../../src/editor/model/document-state.ts'

test('selects and adds a board in the active installation without moving breakers', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1100 })
  await page.goto('/#!/projects')
  await expect(page.locator('projects-field')).toBeVisible()
  const root = '00000000-0000-4000-8000-000000000221'
  const other = '00000000-0000-4000-8000-000000000222'
  const path = 'symbols/Protection devices/Automaat.svg'
  const shapes: SymbolShape[] = ['A', 'B'].map((bindingId, index) => ({
    id: `breaker-${bindingId}`, kind: 'symbol', name: 'Automaat', path, scale: 2,
    position: { x: 700 + index * 350, y: 600 }, bindingId,
    generationKey: `test-breaker-${bindingId}`, sourceLink: { kind: 'circuit', id: bindingId, role: 'breaker' },
    electrical: { role: 'protection', oneWireEligible: true }
  }))
  const boards = [
    { id: 'main', name: 'Hoofdkast', rails: [{ id: 'rail-1', name: 'Rail 1' }] },
    { id: 'garage', name: 'Garage', rails: [{ id: 'rail-1', name: 'Rail 1' }] }
  ]
  const project: Project = {
    uuid: randomUUID(), creationTime: 1, name: 'Kastselector test',
    customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' }, company: '',
    address: { street: '', number: '', postalCode: '', city: '' },
    electricalProfile: { ...DEFAULT_AREI_PROFILE, boards: [boards[0]] },
    pages: {
      [root]: { creationTime: 1, name: 'Eendraads', pageType: 'onewire',
        electricalProfile: { ...DEFAULT_AREI_PROFILE, boards },
        circuitSpecifications: { A: { boardId: 'KAST I' }, B: { boardId: 'garage' } },
        schema: { version: 'native-svg-1', objects: [{ kind: 'cadle-native-svg-document', payload: {
          version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION, shapes,
          selectedId: null, drawingScale: 100, paperPreset: 'a4-landscape', printMargin: 10,
          worldWidth: 2376, worldHeight: 1680
        } }] }
      },
      [other]: { creationTime: 2, name: 'Andere installatie', pageType: 'groundplan',
        electricalProfile: { ...DEFAULT_AREI_PROFILE, boards: [boards[0]] } }
    }
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
  await page.locator(`projects-field custom-list-item[data-name="${project.name}"]`).click()
  const app = page.locator('cadle-app:not([read-only])')
  const shell = page.locator('app-shell')
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), root)).toBe(true)
  const selectBreaker = async (id: string, multiple = false) => {
    await app.locator(`g.shape-symbol[data-shape-id="breaker-${id}"]`).click({
      ...(multiple ? { modifiers: ['ControlOrMeta' as const] } : {})
    })
  }
  const board = page.locator('object-pane select[data-electrical-field="boardId"]')
  await selectBreaker('A')
  await page.locator('object-pane').getByText('Circuit', { exact: true }).click()
  await expect(board).toHaveValue('KAST I')
  await expect(board.locator('option')).toHaveText(['KAST I', 'Hoofdkast', 'Garage'])
  await selectBreaker('B', true)
  await expect(board).toHaveValue('')
  await expect(board.locator('option').first()).toHaveText('Verschillend / niet ingesteld')
  await selectBreaker('A')
  await board.selectOption('garage')
  await expect.poll(() => shell.evaluate((element, key) =>
    (element as AppShell).project!.pages[key].circuitSpecifications?.A?.boardId, root)).toBe('garage')
  await page.locator('object-pane').getByRole('button', { name: 'Kast toevoegen' }).click()
  await page.locator('input-form-dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(board).toHaveValue('garage')
  await shell.evaluate((element) => {
    const shell = element as AppShell & {
      resolveBoardInput?: (value: Record<string, string>) => void
      originalInput?: AppShell['requestInput']
    }
    shell.originalInput = shell.requestInput
    shell.requestInput = () => new Promise((resolve) => { shell.resolveBoardInput = resolve })
  })
  await page.locator('object-pane').getByRole('button', { name: 'Kast toevoegen' }).click()
  await selectBreaker('B')
  await shell.evaluate((element) => {
    const shell = element as AppShell & {
      resolveBoardInput?: (value: Record<string, string>) => void
      originalInput?: AppShell['requestInput']
    }
    shell.resolveBoardInput!({ name: 'Niet aanmaken' })
    shell.requestInput = shell.originalInput!
  })
  await expect(board).toHaveValue('garage')
  await selectBreaker('A')
  await page.locator('object-pane').getByRole('button', { name: 'Kast toevoegen' }).click()
  const dialog = page.locator('input-form-dialog')
  await dialog.getByLabel('Naam van de kast').fill('Garage')
  await dialog.getByRole('button', { name: 'Kast toevoegen' }).click()
  await expect(board).toHaveValue('garage-2')
  await expect(board.locator('option[value="garage-2"]')).toHaveText('Garage')
  await selectBreaker('B')
  await expect(board).toHaveValue('garage')
  await selectBreaker('A')
  await expect(board).toHaveValue('garage-2')
  await shell.evaluate(async (element) => { await (element as AppShell).savePage() })
  const saved = await shell.evaluate((element) => (element as AppShell).project!)
  expect(saved.pages[root].electricalProfile?.boards?.at(-1)).toEqual({
    id: 'garage-2', name: 'Garage', rails: [{ id: 'rail-1', name: 'Rail 1' }]
  })
  expect(saved.pages[root].circuitSpecifications?.A?.boardId).toBe('garage-2')
  expect(saved.pages[root].circuitSpecifications?.B?.boardId).toBe('garage')
  expect(saved.pages[root].electricalProfile?.boards?.some((item) => item.name === 'Niet aanmaken')).toBe(false)
  expect(saved.electricalProfile).toEqual(project.electricalProfile)
  expect(saved.pages[other].electricalProfile).toEqual(project.pages[other].electricalProfile)
  const savedShapes = nativeStateForProjectPage(saved, root)!.shapes
  for (const shape of shapes) {
    expect(savedShapes.find((candidate) => candidate.id === shape.id)).toMatchObject({ position: shape.position })
  }
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), root)).toBe(true)
  await selectBreaker('A')
  await expect(board).toHaveValue('garage-2')
  const reloaded = await shell.evaluate((element) => (element as AppShell).project!)
  expect(reloaded.pages[root].circuitSpecifications?.A?.boardId).toBe('garage-2')
  expect(reloaded.pages[root].electricalProfile?.boards?.at(-1)?.name).toBe('Garage')
})

test('keeps slow ID edits stable and numbers logical points from the assigned cabinet', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1100 })
  await page.goto('/#!/projects')
  await expect(page.locator('projects-field')).toBeVisible()
  const app = page.locator('cadle-app:not([read-only])')
  const shell = page.locator('app-shell')
  const path = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" fill="white" stroke="black"/></svg>')}`
  const shapes: SymbolShape[] = [
    ...[600, 1300].map((x, index): SymbolShape => ({
      id: index ? 'board-garage' : 'board-main', kind: 'symbol', name: 'Verdeelbord', path, scale: 1.5,
      position: { x, y: 350 }, electrical: { role: 'protection', oneWireEligible: false,
        boardId: index ? 'garage' : 'main' }
    })),
    ...[700, 800, 900, 1000, 1100, 1200, 1050, 1060, 1070].map((x, index): SymbolShape => ({
      id: `point-${index}`, kind: 'symbol', name: 'Socket outlet', path, scale: 1.5,
      position: { x, y: 600 }, ...(index >= 6 ? { groupId: 'triple-socket' } : {}),
      electrical: { role: 'load', circuitType: 'sockets', oneWireEligible: true }
    }))
  ]
  const project: Project = {
    uuid: randomUUID(), creationTime: 1, name: 'IDs vanaf de kast',
    customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' }, company: '',
    address: { street: '', number: '', postalCode: '', city: '' },
    electricalProfile: { ...DEFAULT_AREI_PROFILE, boards: [
      { id: 'main', name: 'Hoofdkast', rails: [{ id: 'rail-1', name: 'Rail 1' }] },
      { id: 'garage', name: 'Garage', rails: [{ id: 'rail-1', name: 'Rail 1' }],
        floorPlanLocation: { pageKey: '00000000-0000-4000-8000-000000000102', shapeId: 'board-garage' } }
    ] },
    circuitSpecifications: { AL: { boardId: 'garage' } },
    pages: { '00000000-0000-4000-8000-000000000102': {
      creationTime: 1, name: 'Situatieplan', pageType: 'groundplan',
      schema: { version: 'native-svg-1', objects: [{ kind: 'cadle-native-svg-document', payload: {
        version: 2, paperLayoutVersion: 1, shapes, selectedId: null, drawingScale: 100,
        paperPreset: 'a4-landscape', printMargin: 10, worldWidth: 2376, worldHeight: 1680
      } }] }
    } }
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
  await page.locator(`projects-field custom-list-item[data-name="${project.name}"]`).click()
  await expect.poll(() => app.evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await expect(app.locator('g.shape-symbol svg rect')).toHaveCount(shapes.length)
  const select = async (id: string, multiple = false) => {
    await app.locator(`g.shape-symbol[data-shape-id="${id}"]`).click({
      ...(multiple ? { modifiers: ['ControlOrMeta' as const] } : {})
    })
  }
  await select('point-8')
  for (let index = 0; index < 6; index++) await select(`point-${index}`, true)
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).selectedObjectCount)).toBe(9)
  const input = page.locator('object-pane .native-binding-input')
  const original = await input.elementHandle()
  const ids = () => app.evaluate((element) => (element as CadleApp).analyzeBindings().groups
    .map((group) => group.bindingId).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
  await input.pressSequentially('a1', { delay: 450 })
  await input.press('ArrowLeft')
  await input.pressSequentially('l', { delay: 450 })
  await expect(input).toHaveValue('al1')
  await expect(input).toBeFocused()
  expect(await input.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(2)
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true)
  expect(await ids()).toEqual([])
  await input.press('Enter')
  await expect.poll(ids).toEqual(['AL1', 'AL2', 'AL3', 'AL4', 'AL5', 'AL6', 'AL7'])
  const points = await app.evaluate((element) => (element as CadleApp).analyzeBindings().groups.map((group) => ({
    id: group.bindingId, shapes: group.components.map((component) => component.shapeId)
  })))
  expect(points.find((point) => point.id === 'AL1')?.shapes).toContain('point-5')
  expect(points.find((point) => point.id === 'AL7')?.shapes).toContain('point-0')
  expect(points.find((point) => point.id === 'AL3')?.shapes.some((id) => /^point-[678]$/.test(id))).toBe(true)
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect.poll(ids).toEqual([])
  await app.evaluate((element) => (element as CadleApp).redo())
  await expect.poll(ids).toEqual(['AL1', 'AL2', 'AL3', 'AL4', 'AL5', 'AL6', 'AL7'])
  await input.fill('AL11')
  await select('board-main')
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).selectedObjectCount)).toBe(1)
  await expect.poll(ids).toEqual(['AL11', 'AL12', 'AL13', 'AL14', 'AL15', 'AL16', 'AL17'])
  await app.evaluate(async (element) => { await (element as CadleApp).flushPendingSave() })
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(ids).toEqual(['AL11', 'AL12', 'AL13', 'AL14', 'AL15', 'AL16', 'AL17'])
})

for (const width of [1440, 600]) {
  test(`selection opens properties and deselection closes them at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 })
    await page.goto('/?fixture=priority-suite#!/projects')
    await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
    if (width > 720) {
      await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000102"]').click()
    }
    const app = page.locator('cadle-app:not([read-only])')
    const panel = page.locator('app-shell #object-inspector')
    await app.evaluate(async (element: any) => { await element.exportA4PNG() })
    await expect(panel).toHaveAttribute('data-open', 'false')
    const select = async (id: string) => {
      const point = await app.locator(`[data-shape-id="${id}"] svg`).evaluate((svg) => {
        const geometry = svg.querySelector('path,circle,ellipse,rect,line') as SVGGeometryElement
        const point = geometry.getPointAtLength(1)
        const screen = new DOMPoint(point.x, point.y).matrixTransform(geometry.getScreenCTM()!)
        return { x: screen.x, y: screen.y }
      })
      await page.mouse.click(point.x, point.y)
    }
    await select('device-a1-push')
    await expect(panel).toHaveAttribute('data-open', 'true')
    await expect(panel).toBeVisible()
    await expect(panel.locator('object-pane .native-binding-input')).toHaveValue('A1')
    await page.keyboard.press('Escape')
    await expect(panel).toHaveAttribute('data-open', 'false')
    await expect.poll(() => page.locator('app-shell').evaluate((shell: any) => shell.selectedObjectCount)).toBe(0)
    await expect(panel).toBeHidden()
    await select('device-a1-push')
    await expect(panel).toHaveAttribute('data-open', 'true')
    await panel.getByRole('button', { name: 'Close properties' }).click()
    await expect(panel).toHaveAttribute('data-open', 'false')
    await expect(panel).toBeHidden()
    await app.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(panel).toHaveAttribute('data-open', 'false')
    await page.keyboard.press('Escape')
    await select('device-a2-push')
    await expect(panel).toHaveAttribute('data-open', 'true')
    await expect(panel.locator('object-pane .native-binding-input')).toHaveValue('A2')
    if (width > 720) {
      // The linked read-only view must not clear the active editor's selection.
      await page.locator('app-shell').evaluate((shell: any) => { shell.splitViewOpen = true })
      await expect(page.locator('cadle-app[read-only] .project-title-block')).toBeVisible()
      await expect(panel).toHaveAttribute('data-open', 'true')
      const bounds = await app.locator('svg.stage').boundingBox()
      await page.mouse.click(bounds!.x + 40, bounds!.y + 40)
      await expect(panel).toHaveAttribute('data-open', 'false')
    }
  })
}
