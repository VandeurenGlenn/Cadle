import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import type { CadleApp } from '../../src/editor/cadle-app.ts'
import type { AppShell } from '../../src/shell/app-shell.ts'
import type { Project, UUID } from '../../src/types.ts'
import type { LineShape, Shape, SymbolShape } from '../../src/editor/model/types.ts'
import { normalizeElectricalProfile } from '../../src/editor/electrical-profile.ts'
import { nativeStateForProjectPage } from '../../src/editor/model/document-state.ts'
import { buildKamrailCircuitBundle } from '../../src/editor/layout/onewire-helpers.ts'
import { oneWireSymbolBounds, oneWireSymbolNodeInfo, oneWireSymbolScaleFor, oneWireSymbolTerminalInfo } from '../../src/editor/layout/onewire-symbol-nodes.ts'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors } from '../../src/editor/layout/onewire-connections.ts'
import { ONE_WIRE_LAYOUT_VERSION } from '../../src/editor/layout/onewire-layout-plan.ts'
import { applyOneWireCircuitPresentation } from '../../src/editor/layout/onewire-circuit-presentation.ts'
import { translateShape } from '../../src/editor/interaction/shape-transforms.ts'

const ground = '00000000-0000-4000-8000-000000000102' as UUID
const schematic = '00000000-0000-4000-8000-000000000104' as UUID
const schema = (shapes: Shape[]) => ({
  version: 'native-svg-1', objects: [{ kind: 'cadle-native-svg-document', payload: {
    version: 2, paperLayoutVersion: 1, oneWireLayoutVersion: ONE_WIRE_LAYOUT_VERSION,
    drawingScale: 100, shapes, selectedId: null, paperPreset: 'a3-landscape', printMargin: 10,
    worldWidth: 3360, worldHeight: 2376
  } }]
})
const device = (id: string, x: number, y: number, bindingId?: string, name = 'Wall outlet with grounding'): SymbolShape => ({
  id, kind: 'symbol', name, path: `symbols/${name === 'Distribution board' ? 'Electrical devices' : 'Socket outlets'}/${name}.svg`,
  position: { x, y }, scale: 1, bindingId
})
const fixture = (): Project => ({
  uuid: randomUUID(), creationTime: 1, name: 'Kabelraming',
  customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' }, company: '',
  address: { street: '', number: '', postalCode: '', city: '' },
  electricalProfile: { ...normalizeElectricalProfile(undefined), boards: [
    { id: 'main', name: 'Hoofdkast', rails: [{ id: 'rail-1', name: 'Rail 1' }] },
    { id: 'garage', name: 'Garage', rails: [{ id: 'rail-1', name: 'Rail 1' }] }
  ] },
  circuitSpecifications: {
    A: { cableType: 'VOB', cableSectionMm2: 2.5, cableConductors: 3, boardId: 'main' },
    B: { cableType: 'XVB', cableSectionMm2: 6, cableConductors: 5, boardId: 'garage' }
  },
  pages: {
    [ground]: { creationTime: 1, name: 'Situatieplan', pageType: 'groundplan', order: 0, schema: schema([
      device('main-board', 400, 400, undefined, 'Distribution board'),
      device('garage-board', 1200, 400, undefined, 'Distribution board'),
      device('a1', 480, 400, 'A1'), device('a2', 480, 480, 'A2'), device('b1', 1280, 400, 'B1')
    ]) },
    [schematic]: { creationTime: 2, name: 'Eendraads', pageType: 'onewire', order: 1, schema: schema([]) }
  }
})
const seed = async (page: Page, project: Project) => {
  await page.goto('/#!/projects')
  await expect(page.locator('projects-field')).toBeVisible()
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
  await page.locator(`projects-field custom-list-item[data-name="${project.name}"]`).click({ position: { x: 12, y: 18 } })
  const app = page.locator('cadle-app:not([read-only])')
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), ground)).toBe(true)
  return app
}

test('shows cable totals per board and cable type, updates assignments and remembers physical cabinet positions', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 })
  const app = await seed(page, fixture())
  const shell = page.locator('app-shell')
  await shell.evaluate((element) => (element as AppShell).openCircuitScheduleDialog())
  const overview = page.locator('circuit-schedule-field')
  const main = overview.locator('.board-section').filter({ has: page.getByRole('heading', { name: 'Hoofdkast', exact: true }) })
  const garage = overview.locator('.board-section').filter({ has: page.getByRole('heading', { name: 'Garage', exact: true }) })
  await expect(main).toContainText('Nog geen kabelraming')
  await overview.getByLabel('Kastpositie voor Hoofdkast').selectOption(`${ground}/main-board`)
  await overview.getByLabel('Kastpositie voor Garage').selectOption(`${ground}/garage-board`)
  await expect(main.locator('.cable-total')).toContainText('Geschat totaal: 2,0 m')
  await expect(main.locator('.cable-total')).toContainText('3G2.5 mm² VOB: 2,0 m')
  await expect(garage.locator('.cable-total')).toContainText('5G6 mm² XVB: 1,0 m')
  await overview.getByLabel('Verdeelbord voor kring B', { exact: true }).selectOption('main')
  await expect(main.locator('.cable-total')).toContainText('Geschat totaal: 13,0 m')
  await expect(main.locator('.cable-total')).toContainText('5G6 mm² XVB: 11,0 m')
  await expect(garage.locator('.cable-total')).toContainText('Nog geen kabelraming')
  await overview.getByLabel('Verdeelbord voor kring B', { exact: true }).selectOption('garage')
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), ground)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), ground)).toBe(true)
  const point = await app.locator('g.shape-symbol[data-shape-id="a2"] path').first().evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(2).matrixTransform(path.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(point.x, point.y)
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).selectedObjectCount)).toBe(1)
  for (let index = 0; index < 8; index++) await page.keyboard.press('ArrowRight')
  await shell.evaluate((element) => (element as AppShell).openCircuitScheduleDialog())
  await expect(main.locator('.cable-total')).toContainText('Geschat totaal: 2,5 m')
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => shell.evaluate((element) => (element as AppShell).project.electricalProfile?.boards
    ?.find((board) => board.id === 'main')?.floorPlanLocation?.shapeId)).toBe('main-board')
  await expect(overview.getByLabel('Kastpositie voor Hoofdkast')).toHaveValue(`${ground}/main-board`)
  await expect(garage.locator('.cable-total')).toContainText('Geschat totaal: 1,0 m')
  await expect(main.locator('.cable-total')).toContainText('Geschat totaal: 2,5 m')
})

test('shows differential coverage per row and opens a persistent cabinet module planner', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1100 })
  const project = fixture()
  project.name = 'Differentielen en kastlayout'
  const main = project.electricalProfile!.boards![0]
  main.rails.push({ id: 'rail-2', name: 'Badkamer' })
  main.mainDifferential = { id: 'main', poles: 2, ratedCurrentA: 40, sensitivityMa: 300, type: 'A' }
  project.electricalProfile!.boards![1].mainDifferential = { id: 'garage-main', poles: 2, ratedCurrentA: 40, sensitivityMa: 300, type: 'A' }
  project.circuitSpecifications!.B = { ...project.circuitSpecifications!.B, boardId: 'main', railId: 'rail-2' }
  project.oneWireTopology = { version: 1, consumers: true, solar: false, residualBreaker: false,
    additionalDifferentials: [{ count: 1, purpose: 'consumers', boardId: 'main', railId: 'rail-2', poles: 2, sensitivityMa: 30, ratedCurrentA: 40 }] }
  await seed(page, project)
  const shell = page.locator('app-shell')
  await shell.evaluate((element) => (element as AppShell).openCircuitScheduleDialog())
  const overview = page.locator('circuit-schedule-field')
  const circuitA = overview.locator('.device[data-circuit-id="A"]')
  const circuitB = overview.locator('.device[data-circuit-id="B"]')
  await expect(circuitA.locator('.protection-assignment')).toContainText('300mA')
  await expect(circuitA.locator('.protection-assignment')).not.toContainText('30mA')
  await expect(circuitB.locator('.protection-assignment')).toContainText('Badkamer')
  await expect(circuitB.locator('.protection-assignment')).toContainText('30mA')
  const additional = overview.locator('.device[data-kind="differential"]').filter({ hasText: 'Voedt: B' })
  await expect(additional).toHaveCount(1)
  await expect(additional).toContainText('Badkamer')
  const before = await shell.evaluate((element) => (element as AppShell).project)
  await overview.getByRole('button', { name: 'Kastlayoutplanner', exact: true }).click()
  const planner = page.getByRole('dialog', { name: 'Kastlayoutplanner', exact: true })
  await expect(planner.locator('.cabinet-device[data-kind="differential"]')).toHaveCount(3)
  const rowDiffId = 'DIFF:main:additional-differential-consumers-1'
  await planner.locator('.item[data-kind="differential"]').filter({ hasText: '30mA' }).getByTitle('Move up').click()
  await expect(planner.locator('.cabinet-board[data-board-id="main"] .cabinet-device').first()).toHaveAttribute('data-item-id', rowDiffId)
  await planner.getByLabel('Kastbreedte').selectOption('18')
  await planner.locator('.item[data-kind="circuit"]').filter({ hasText: 'B ·' }).getByLabel('Vrije modules ervoor').fill('4')
  await planner.locator('.item[data-kind="circuit"]').filter({ hasText: 'B ·' }).getByLabel('Vrije modules ervoor').press('Tab')
  await expect(planner.locator('.cabinet-device[data-item-id="B"]')).toHaveAttribute('style', /grid-column:11 \/ span 2/)
  await planner.locator('.item[data-kind="circuit"]').filter({ hasText: 'B ·' }).getByTitle('Move up').click()
  await expect(planner.locator('.cabinet-device[data-item-id="B"]')).toHaveAttribute('style', /grid-column:9 \/ span 2/)
  await planner.getByRole('button', { name: 'Indeling opslaan', exact: true }).click()
  await expect(planner).not.toBeVisible()
  const saved = await shell.evaluate((element) => (element as AppShell).project)
  expect(saved.circuitScheduleLayout?.modulesPerRow).toBe(18)
  expect(saved.circuitScheduleLayout?.items?.find((item) => item.id === 'B')?.gapBefore).toBe(4)
  expect(saved.pages[schematic].schema).toEqual(before.pages[schematic].schema)
  expect(saved.circuitSpecifications).toEqual(before.circuitSpecifications)
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect(overview.getByRole('combobox', { name: 'Breedte', exact: true })).toHaveValue('18')
  await expect(overview.locator('.device[data-circuit-id="B"] .protection-assignment')).toContainText('Badkamer')
  await overview.getByRole('button', { name: 'Kastlayoutplanner', exact: true }).click()
  await expect(planner.getByLabel('Kastbreedte')).toHaveValue('18')
  await expect(planner.locator('.cabinet-device[data-item-id="B"]')).toHaveAttribute('style', /grid-column:9 \/ span 2/)
})

test('hiding a cable caption preserves every device, wire and text position through undo and reopening', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 })
  const project = fixture()
  project.name = 'Aanduiding zonder verspringen'
  const rail: LineShape = { id: 'visibility-rail', kind: 'line', start: { x: 300, y: 1300 }, end: { x: 2200, y: 1300 },
    groupId: 'onewire-kamrail-visibility', strokeWidth: 4 }
  let sequence = 0
  const bundle = buildKamrailCircuitBundle({
    rail, anchorX: 700, familyComponents: [{ bindingId: 'A1', kind: 'load', sourceShapeId: 'a1',
      sourcePath: 'symbols/Socket outlets/Wall outlet with grounding.svg', sourceName: 'Wall outlet with grounding' }],
    options: { family: 'A', amps: 20, autoIncludeFamily: true },
    nextShapeId: () => `visibility-${++sequence}`, oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!
  const cable = bundle.shapes.find((shape): shape is LineShape => shape.kind === 'line' && shape.connection?.kind === 'cable')!
  cable.connection!.name = 'Voeding voor de volledige technische installatie en de toestellen in de achterliggende berging'
  const caption = bundle.shapes.find((shape) => shape.sourceLink?.role === 'cable-section')!
  project.pages[schematic].schema = schema([rail, ...bundle.shapes])
  const app = await seed(page, project)
  const shell = page.locator('app-shell')
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  const geometry = async () => {
    await app.evaluate((element) => (element as CadleApp).flushPendingSave())
    const saved = await shell.evaluate((element) => (element as AppShell).project)
    return nativeStateForProjectPage(saved, schematic)!.shapes.map((shape) =>
      'position' in shape ? { id: shape.id, position: shape.position, rotation: shape.rotation, scale: 'scale' in shape ? shape.scale : undefined }
        : { id: shape.id, start: shape.start, end: shape.end, rotation: shape.rotation, via: shape.kind === 'line' ? shape.connection?.via : undefined })
  }
  const original = await geometry()
  const point = await app.locator(`.connection-conductor[data-shape-id="${cable.id}"]`).evaluate((node: SVGGeometryElement) => {
    const point = node.getPointAtLength(node.getTotalLength() / 2).matrixTransform(node.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(point.x, point.y)
  const checkbox = page.locator('object-pane').getByLabel('Toon aanduiding', { exact: true })
  await expect(checkbox).toBeChecked()
  await checkbox.uncheck()
  await expect(app.locator(`text[data-shape-id="${caption.id}"]`)).toHaveCount(0)
  expect(await geometry()).toEqual(original)
  await app.evaluate((element) => (element as CadleApp).undo())
  await expect(app.locator(`text[data-shape-id="${caption.id}"]`)).toHaveCount(1)
  expect(await geometry()).toEqual(original)
  await app.evaluate((element) => (element as CadleApp).redo())
  await expect(app.locator(`text[data-shape-id="${caption.id}"]`)).toHaveCount(0)
  expect(await geometry()).toEqual(original)
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await expect(app.locator(`text[data-shape-id="${caption.id}"]`)).toHaveCount(0)
  expect(await geometry()).toEqual(original)
})

test('repairs empty circuit cable clearance on opening without shifting breakers or populated neighbours', async ({ page }) => {
  const project = fixture()
  project.name = 'Lege kringen met kabelruimte'
  const rail: LineShape = { id: 'empty-rail', kind: 'line', start: { x: 300, y: 1300 }, end: { x: 2200, y: 1300 },
    groupId: 'onewire-kamrail-empty', strokeWidth: 4 }
  const other: LineShape = { ...rail, id: 'other-empty-rail', start: { x: 2300, y: 1500 }, end: { x: 3000, y: 1500 } }
  let sequence = 0
  const bundle = (family: string, anchorX: number, empty: boolean, poles: number) => buildKamrailCircuitBundle({
    rail, anchorX, familyComponents: empty ? [{ bindingId: family, kind: 'empty' }] : [
      { bindingId: `${family}1`, kind: 'load', sourcePath: 'symbols/Socket outlets/Wall outlet with grounding.svg' }
    ],
    options: { family, amps: 16, autoIncludeFamily: true, poles, cableConductors: poles === 4 ? 5 : 3,
      cableSectionMm2: 2.5, cableType: 'XVB', cableFireClass: 'Cca' },
    nextShapeId: () => `empty-${++sequence}`, oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id }))
  const empty = [...bundle('BI', 600, true, 2), ...bundle('BJ', 1100, true, 4)]
    .filter((shape) => shape.sourceLink?.role !== 'trunk')
    .map((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'cable-section'
      ? { ...shape, textAnchor: 'start' as const, position: { ...shape.position, y: 1000 } } : shape)
  const populated = bundle('C', 1800, false, 2)
  for (const [family, poles] of [['BI', 2], ['BJ', 4]] as const) {
    project.circuitSpecifications![family] = { poles, cableConductors: poles === 4 ? 5 : 3,
      cableSectionMm2: 2.5, cableType: 'XVB', cableFireClass: 'Cca', breakerCurrentA: 16 }
  }
  project.pages[schematic].schema = schema([rail, other, ...empty, ...populated])
  const app = await seed(page, project)
  const shell = page.locator('app-shell')
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  await app.evaluate((element) => (element as CadleApp).flushPendingSave())
  const saved = await shell.evaluate((element) => (element as AppShell).project)
  const repaired = nativeStateForProjectPage(saved, schematic)!.shapes
  const geometry = (shape: Shape) => 'position' in shape
    ? { id: shape.id, position: shape.position, rotation: shape.rotation }
    : { id: shape.id, start: shape.start, end: shape.end }
  for (const fixed of [rail, other, ...populated, ...empty.filter((shape) =>
    shape.sourceLink?.role === 'breaker' || shape.sourceLink?.role === 'breaker-feed')]) {
    expect(geometry(repaired.find((shape) => shape.id === fixed.id)!)).toEqual(geometry(fixed))
  }
  for (const family of ['BI', 'BJ']) {
    const owned = repaired.filter((shape) => shape.sourceLink?.kind === 'board' && shape.sourceLink.id === family)
    const breaker = owned.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker')!
    const trunk = owned.find((shape): shape is LineShape => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')!
    const caption = owned.find((shape) => shape.sourceLink?.role === 'cable-section')!
    const top = oneWireSymbolTerminalInfo(breaker.path, breaker.scale)!.top!
    expect(trunk.start).toEqual({ x: breaker.position.x + top.x, y: breaker.position.y + top.y })
    const box = oneWireLayoutBounds(caption)
    expect(box.y).toBeGreaterThanOrEqual(trunk.end.y + 24 - 1e-8)
    expect(box.y + box.height).toBeLessThanOrEqual(trunk.start.y - 24 + 1e-8)
    expect(trunk.connection?.cableType).toBe('XVB')
    expect(trunk.connection?.sectionMm2).toBe(2.5)
    await expect(app.locator(`text[data-shape-id="${caption.id}"]`)).toContainText('XVB Cca')
  }
  expect(saved.recovery?.[0].label).toBe('Vóór synchronisatie eendraads')
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  const reopened = await shell.evaluate((element) => (element as AppShell).project)
  expect(nativeStateForProjectPage(reopened, schematic)!.shapes.map(geometry)).toEqual(repaired.map(geometry))
})

test('keeps existing geometry fixed when changing manual and circuit cable sections or inserting breakers', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 })
  const project = fixture()
  project.name = 'Vaste kringen bij kabelwijzigingen'
  const rail: LineShape = { id: 'stable-rail', kind: 'line', start: { x: 300, y: 1300 }, end: { x: 1400, y: 1300 },
    groupId: 'onewire-kamrail-stable', strokeWidth: 4 }
  const lower: LineShape = { ...rail, id: 'stable-lower-rail', start: { x: 300, y: 1800 }, end: { x: 2300, y: 1800 },
    groupId: 'onewire-kamrail-stable-lower' }
  let sequence = 0
  const bundle = (family: string, anchorX: number) => buildKamrailCircuitBundle({
    rail, anchorX, familyComponents: [{ bindingId: family, kind: 'empty' }],
    options: { family, amps: 16, autoIncludeFamily: true, cableConductors: 3, cableSectionMm2: 2.5, cableType: 'VOB' },
    nextShapeId: () => `stable-${++sequence}`, oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id }))
  const shapes = [...bundle('BI', 600), ...bundle('BJ', 1000)]
  const named = shapes.find((shape): shape is LineShape =>
    shape.kind === 'line' && shape.bindingId === 'BJ' && shape.sourceLink?.role === 'trunk')!
  named.connection!.name = 'Voeding voor de volledige technische installatie en de toestellen in de achterliggende berging'
  const spaced = applyOneWireCircuitPresentation({ shapes, circuitKey: 'BJ' }).shapes
  const breaker = spaced.find((shape): shape is SymbolShape =>
    shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker' && shape.bindingId === 'BI')!
  const bottom = oneWireSymbolConnectionAnchors(breaker).find((anchor) => anchor.side === 'bottom')!.point
  const differential: SymbolShape = { id: 'stable-diff', kind: 'symbol', name: 'Differentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg', scale: 3, position: { x: 1700, y: 1600 } }
  const top = oneWireSymbolConnectionAnchors(differential).find((anchor) => anchor.side === 'top')!.point
  const manual: LineShape = { id: 'stable-manual-feed', kind: 'line', start: bottom, end: top,
    connection: { kind: 'wire', sectionMm2: 2.5, conductors: 1, cableType: 'VOB', showLabel: true,
      routing: 'orthogonal', via: [{ x: 1450, y: bottom.y }, { x: 1450, y: top.y }] } }
  project.pages[schematic].schema = schema([rail, lower, ...spaced, differential, manual])
  const app = await seed(page, project)
  const shell = page.locator('app-shell')
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  const savedShapes = async () => {
    await app.evaluate((element) => (element as CadleApp).flushPendingSave())
    return nativeStateForProjectPage(await shell.evaluate((element) => (element as AppShell).project), schematic)!.shapes
  }
  const geometry = (shape: Shape) => 'position' in shape
    ? { id: shape.id, position: shape.position, rotation: shape.rotation }
    : { id: shape.id, start: shape.start, end: shape.end, via: shape.kind === 'line' ? shape.connection?.via : undefined }
  const original = await savedShapes()
  const expectUnmoved = async (before: Shape[], allowRailGrowth = false) => {
    const current = await savedShapes()
    for (const shape of before) {
      const actual = current.find((candidate) => candidate.id === shape.id)!
      if (allowRailGrowth && shape.id === rail.id && actual.kind === 'line' && shape.kind === 'line') {
        expect(actual.start).toEqual(shape.start)
        expect(actual.end.y).toBe(shape.end.y)
        expect(actual.end.x).toBeGreaterThanOrEqual(shape.end.x)
      } else expect(geometry(actual), shape.id).toEqual(geometry(shape))
    }
  }
  const selectConductor = async (id: string) => {
    await page.getByRole('button', { name: 'Select', exact: true }).first().click()
    const point = await app.locator(`.connection-conductor[data-shape-id="${id}"]`).evaluate((node: SVGGeometryElement) => {
      const point = node.getPointAtLength(node.getTotalLength() - 40).matrixTransform(node.getScreenCTM()!)
      return { x: point.x, y: point.y }
    })
    await page.mouse.click(point.x, point.y)
  }
  await selectConductor(manual.id)
  await page.locator('object-pane').getByLabel('Doorsnede (mm²)', { exact: true }).selectOption('6')
  expect((await savedShapes()).find((shape): shape is LineShape => shape.id === manual.id && shape.kind === 'line')?.connection?.sectionMm2).toBe(6)
  await expectUnmoved(original)
  const circuitCable = spaced.find((shape) => shape.kind === 'line' && shape.bindingId === 'BI' && shape.sourceLink?.role === 'trunk')!
  await selectConductor(circuitCable.id)
  await page.locator('object-pane').getByLabel('Doorsnede (mm²)', { exact: true }).selectOption('6')
  await expectUnmoved(original)
  for (const family of ['BK', 'BL']) {
    const before = await savedShapes()
    const inspector = shell.locator('#object-inspector')
    if (await inspector.getAttribute('data-open') === 'true') await inspector.getByRole('button', { name: 'Close properties' }).click()
    await page.getByRole('button', { name: 'Add breaker', exact: true }).first().click()
    const point = await app.locator(`line[data-shape-id="${rail.id}"]`).evaluate((node: SVGLineElement, offset) => {
      const point = new DOMPoint(node.x2.baseVal.value - offset, node.y1.baseVal.value).matrixTransform(node.getScreenCTM()!)
      return { x: point.x, y: point.y }
    }, family === 'BK' ? 20 : 60)
    await page.mouse.click(point.x, point.y)
    await page.getByRole('textbox', { name: 'Circuit family' }).fill(family)
    await page.locator('input-form-dialog').getByRole('button', { name: 'Add breaker' }).click()
    await expect(app.locator('text.shape-text').filter({ hasText: new RegExp(`^${family}$`) })).toHaveCount(1)
    await expectUnmoved(before, true)
  }
  const inserted = await savedShapes()
  await app.evaluate((element) => (element as CadleApp).undo())
  await expectUnmoved(original, true)
  await app.evaluate((element) => (element as CadleApp).redo())
  expect((await savedShapes()).map(geometry)).toEqual(inserted.map(geometry))
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  expect((await savedShapes()).map(geometry)).toEqual(inserted.map(geometry))
})

test('places toolbar and catalog symbols below the first lamp row, making room only above the insertion', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 })
  const project = fixture()
  project.name = 'Symbool onder de eerste lampenrij'
  const rail: LineShape = { id: 'inline-rail', kind: 'line', start: { x: 300, y: 1450 }, end: { x: 2100, y: 1450 },
    groupId: 'onewire-kamrail-inline', strokeWidth: 4 }
  let sequence = 0
  const bundle = buildKamrailCircuitBundle({
    rail, anchorX: 900, familyComponents: [1, 2].map((number) => ({
      bindingId: `C${number}`, kind: 'load', sourcePath: 'symbols/Consumption appliances/Lighting.svg'
    })),
    options: { family: 'C', amps: 16, autoIncludeFamily: true, cableConductors: 3, cableSectionMm2: 2.5, cableType: 'VOB' },
    nextShapeId: () => `inline-${++sequence}`, oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!
  const trunk = bundle.shapes.find((shape): shape is LineShape => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')!
  const firstRowY = Math.max(...bundle.shapes.flatMap((shape) =>
    shape.kind === 'line' && shape.sourceLink?.role === 'row-wire' ? [shape.start.y] : []))
  const firstRow = bundle.shapes.find((shape): shape is LineShape =>
    shape.kind === 'line' && shape.sourceLink?.role === 'row-wire' && shape.start.y === firstRowY)!
  const target = { x: trunk.start.x, y: firstRowY + 4 }
  const neighbor: LineShape = { id: 'neighbor-wire', kind: 'line', bindingId: 'D',
    start: { x: 1900, y: 1400 }, end: { x: 1900, y: 900 }, connection: { kind: 'wire', showLabel: false } }
  project.pages[schematic].schema = schema([rail, ...bundle.shapes, neighbor])
  const app = await seed(page, project)
  const shell = page.locator('app-shell')
  await shell.evaluate((element, key) => (element as AppShell).loadPage(key), schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  const savedShapes = async () => {
    await app.evaluate((element) => (element as CadleApp).flushPendingSave())
    return nativeStateForProjectPage(await shell.evaluate((element) => (element as AppShell).project), schematic)!.shapes
  }
  const geometry = (shape: Shape) => 'position' in shape
    ? { id: shape.id, position: shape.position, rotation: shape.rotation }
    : { id: shape.id, start: shape.start, end: shape.end, via: shape.kind === 'line' ? shape.connection?.via : undefined }
  const original = await savedShapes()
  const screenPoint = () => app.locator(`.connection-conductor[data-shape-id="${trunk.id}"]`).evaluate((node, target) => {
    const point = new DOMPoint(target.x, target.y).matrixTransform((node as SVGGraphicsElement).getScreenCTM()!)
    return { x: point.x, y: point.y }
  }, target)
  await page.getByRole('button', { name: 'Add switch', exact: true }).first().click()
  let click = await screenPoint()
  await page.mouse.click(click.x, click.y)
  const checkInsertion = async () => {
    const shapes = await savedShapes()
    const inserted = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.sourceLink?.role === 'inline')!
    expect(inserted).toBeDefined()
    const node = oneWireSymbolNodeInfo(inserted.path, inserted.scale, inserted.rotation)!
    expect(inserted.position.x + node.offset.x).toBeCloseTo(target.x, 6)
    const scale = await app.locator(`.connection-conductor[data-shape-id="${trunk.id}"]`)
      .evaluate((node) => Math.abs((node as SVGGraphicsElement).getScreenCTM()!.d))
    expect(Math.abs(inserted.position.y + node.offset.y - target.y) * scale).toBeLessThanOrEqual(1.1)
    const movedRow = shapes.find((shape): shape is LineShape => shape.kind === 'line' && shape.id === firstRow.id)!
    const delta = movedRow.start.y - firstRow.start.y
    expect(delta).toBeLessThan(0)
    const rows = original.filter((shape) => /^C\d+$/.test(shape.bindingId ?? ''))
    for (const shape of original.filter((shape) => shape.id !== trunk.id)) {
      expect(geometry(shapes.find((candidate) => candidate.id === shape.id)!), shape.id)
        .toEqual(geometry(rows.includes(shape) ? translateShape(shape, 0, delta) : shape))
    }
    const rowBottom = Math.max(...rows.map((shape) => {
      const bounds = oneWireLayoutBounds(shapes.find((candidate) => candidate.id === shape.id)!)
      return bounds.y + bounds.height
    }))
    expect(oneWireLayoutBounds(inserted).y - rowBottom).toBeCloseTo(24, 6)
    const before = shapes.find((shape): shape is LineShape => shape.kind === 'line' && shape.id === trunk.id)!
    const after = shapes.find((shape): shape is LineShape => shape.kind === 'line' && shape.sourceLink?.role === `inline-wire:${inserted.id}`)!
    expect(before.start).toEqual(trunk.start)
    expect(after.end).toEqual({ ...trunk.end, y: trunk.end.y + delta })
    for (const point of [before.end, after.start]) {
      expect(oneWireSymbolConnectionAnchors(inserted).some((anchor) => Math.hypot(anchor.point.x - point.x, anchor.point.y - point.y) < 1e-6)).toBe(true)
    }
    return shapes
  }
  await checkInsertion()
  await app.evaluate((element) => (element as CadleApp).undo())
  expect((await savedShapes()).map(geometry)).toEqual(original.map(geometry))
  await page.getByRole('tab', { name: 'Symbols catalog', exact: true }).click()
  await page.locator('input[name="search_catalog"]').fill('Impulse relay')
  await page.locator('catalog-item').filter({ hasText: 'Impulse relay' }).first().click()
  click = await screenPoint()
  await page.mouse.move(click.x, click.y)
  await expect(app.locator('g.shape-symbol[data-shape-id="__symbol-preview__"]')).toHaveCount(1)
  await page.mouse.click(click.x, click.y)
  await expect(app.locator('g.shape-symbol[data-shape-id="__symbol-preview__"]')).toHaveCount(0)
  const inserted = await checkInsertion()
  await app.evaluate((element) => (element as CadleApp).undo())
  expect((await savedShapes()).map(geometry)).toEqual(original.map(geometry))
  await app.evaluate((element) => (element as CadleApp).redo())
  expect((await savedShapes()).map(geometry)).toEqual(inserted.map(geometry))
  await page.getByRole('button', { name: 'Select', exact: true }).first().click()
  const cablePoint = await app.locator(`.connection-conductor[data-shape-id="${trunk.id}"]`).evaluate((node: SVGGeometryElement) => {
    const point = node.getPointAtLength(node.getTotalLength() / 2).matrixTransform(node.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(cablePoint.x, cablePoint.y)
  await page.locator('object-pane').getByLabel('Doorsnede (mm²)', { exact: true }).selectOption('6')
  expect((await savedShapes()).map(geometry)).toEqual(inserted.map(geometry))
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  expect((await savedShapes()).map(geometry)).toEqual(inserted.map(geometry))
})

test('repairs saved appliance feeds and orphaned busbar tails on opening without reflowing the drawing', async ({ page }) => {
  const project = fixture()
  project.name = 'Oude aansluitingen'
  const rail: LineShape = { id: 'rail', kind: 'line', start: { x: 300, y: 1300 }, end: { x: 1400, y: 1300 },
    groupId: 'onewire-kamrail-main', strokeWidth: 4 }
  const other: LineShape = { ...rail, id: 'other-rail', start: { x: 1600, y: 1500 }, end: { x: 2300, y: 1500 } }
  const manual: LineShape = { id: 'manual-bends', kind: 'line', start: { x: 1700, y: 1500 }, end: { x: 2200, y: 1500 },
    connection: { kind: 'wire', routing: 'orthogonal', via: [{ x: 1700, y: 1100 }, { x: 2200, y: 1100 }] } }
  let sequence = 0
  const bundle = (family: string, names: string[], x: number) => buildKamrailCircuitBundle({
    rail, anchorX: x, familyComponents: names.map((name, index) => ({
      bindingId: `${family}${index + 1}`, kind: 'load' as const, sourceShapeId: `${family}-device-${index}`,
      sourcePath: `symbols/Consumption appliances/${name}.svg`, sourceName: name
    })), options: { family, amps: 20, autoIncludeFamily: true },
    nextShapeId: () => `generated-${++sequence}`, oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!, symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id }))
  const shapes = [...bundle('R', ['Heat pump'], 600), ...bundle('T', ['Lighting', 'Dryer'], 1100)]
  const pump = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.name === 'Heat pump')!
  const dryer = shapes.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.name === 'Dryer')!
  const node = oneWireSymbolNodeInfo(pump.path, pump.scale)!
  const trunk = shapes.find((shape): shape is LineShape => shape.kind === 'line' && shape.sourceLink?.role === 'trunk' && shape.bindingId === 'R')!
  trunk.end = { x: pump.position.x + node.offset.x, y: pump.position.y + node.offset.y }
  const feed = shapes.find((shape): shape is LineShape => shape.kind === 'line' && shape.sourceLink?.role === 'row-wire' && shape.bindingId === 'T2')!
  feed.end = { x: oneWireSymbolBounds(dryer)!.x, y: feed.end.y }
  const tail: LineShape = { id: 'rail-attachment-orphan', kind: 'line', start: { x: 1420, y: 1300 }, end: { x: 1460, y: 1300 },
    connection: { kind: 'wire' }, oneWireRailId: rail.id }
  project.pages[schematic].schema = schema([rail, other, manual, ...shapes, tail])
  const app = await seed(page, project)
  await page.locator('app-shell').evaluate((element, key) => (element as AppShell).loadPage(key), schematic)
  await expect.poll(() => app.evaluate((element, key) => (element as CadleApp).waitForPageReady(key), schematic)).toBe(true)
  const saved = await page.locator('app-shell').evaluate((element) => (element as AppShell).project)
  const repaired = nativeStateForProjectPage(saved, schematic)!.shapes
  for (const fixed of [rail, other, manual, pump, dryer]) expect(repaired.find((shape) => shape.id === fixed.id)).toEqual(fixed)
  expect(repaired.find((shape) => shape.id === tail.id)).toBeUndefined()
  for (const [wire, symbol, side] of [[trunk, pump, 'bottom'], [feed, dryer, 'left']] as const) {
    const expected = oneWireSymbolConnectionAnchors(symbol).find((anchor) => anchor.side === side)!.point
    expect((repaired.find((shape) => shape.id === wire.id) as LineShape).end).toEqual(expected)
  }
  expect(saved.recovery?.[0].label).toBe('Vóór synchronisatie eendraads')
  await expect(app.locator('.onewire-connection-issues')).toHaveAttribute('data-issue-count', '0')
  await page.reload()
  await page.locator('custom-button[label="Open"]').click()
  await expect(app.locator('.onewire-connection-issues')).toHaveAttribute('data-issue-count', '0')
})
