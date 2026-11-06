import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('asks only pipe diameter and spacing, then lays rooms and full manifold routes with a live schedule', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1500, height: 1050 })
  const errors: string[] = []
  page.on('dialog', async (dialog) => { errors.push(dialog.message()); await dialog.dismiss() })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell'), app = page.locator('cadle-app:not([read-only])')
  const sourceKey = '00000000-0000-4000-8000-000000000102'
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, sourceKey)
  const shapes: object[] = []
  for (const [room, name] of ['Leefruimte', 'Keuken'].entries()) {
    const x = 400 + room * 320, corners = [{ x, y: 400 }, { x: x + 320, y: 400 }, { x: x + 320, y: 720 }, { x, y: 720 }]
    shapes.push(...corners.map((start, index) => ({ id: `wall-${room}-${index}`, kind: 'wall', start, end: corners[(index + 1) % 4], groupId: `room-${room}`, roomName: name })))
    shapes.push({ id: `appliance-${room}`, kind: 'symbol', name: 'Refrigerator', path: 'symbols/Consumption appliances/Refrigerator.svg', position: { x: x + 160, y: 550 }, scale: 3 })
  }
  shapes.push({ id: 'opening', kind: 'door', start: { x: 720, y: 520 }, end: { x: 720, y: 600 }, wallId: 'wall-0-1' })
  const state = { version: 2, paperLayoutVersion: 1, drawingScale: 100, paperPreset: 'a4-landscape', worldWidth: 2376, worldHeight: 1680, printMargin: 10, selectedId: null, shapes }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'automatic-base.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) })
  await expect(app.locator('[data-shape-id="appliance-1"]')).toBeAttached()
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await page.getByRole('button', { name: 'Legplan automatisch maken', exact: true }).click()
  const dialog = page.locator('input-form-dialog')
  await expect(dialog.locator('input')).toHaveCount(2)
  await dialog.getByLabel('Buisdiameter (mm)').fill('16')
  await dialog.getByLabel('Legafstand h.o.h. (mm)').fill('150')
  await dialog.getByRole('button', { name: 'Verdeler plaatsen', exact: true }).click()
  await expect(app.locator('.heating-planner-status')).toContainText('Klik het startpunt')
  const heatingKey = await shell.evaluate((element: any) => element.loadedPage)
  const point = await app.locator('.world').evaluate((world: SVGGElement) => {
    const p = new DOMPoint(180, 280).matrixTransform(world.getScreenCTM()!)
    return { x: p.x, y: p.y }
  })
  await page.mouse.click(point.x, point.y)
  await expect(app.locator('.heating-manifold')).toHaveCount(1, { timeout: 30000 })
  expect(errors).toEqual([])
  await expect(app.locator('.heating-planner-status')).toHaveCount(0)
  await expect(app.locator('.heating-zone')).toHaveCount(0)
  await expect(app.locator('g.shape-symbol')).toHaveCount(2)
  const withSchedule = async <T>(check: () => Promise<T>): Promise<T> => {
    if (await app.locator('.heating-table').count()) return await check()
    await app.evaluate(async (element: any) => { await element.flushPendingSave() })
    const key = await shell.evaluate((element: any, source) => Object.entries(element.project.pages).find(([, p]: any) => p.heatingScheduleOf === source)?.[0], heatingKey)
    expect(key).toBeTruthy()
    await shell.evaluate(async (element: any, id) => { await element.loadPage(id) }, key)
    try { return await check() } finally {
      await shell.evaluate(async (element: any, id) => { await element.loadPage(id) }, heatingKey)
      await app.locator('.heating-quality-status').click()
    }
  }
  const rows = app.locator('.heating-schedule-row')
  const beforeScale = await withSchedule(async () => {
    expect(await rows.count()).toBeGreaterThanOrEqual(2)
    await expect(app.locator('.heating-table')).toContainText('Leefruimte')
    await expect(app.locator('.heating-table')).toContainText('Keuken')
    await expect(app.locator('.heating-table')).toContainText('Richtdebiet')
    return await rows.allTextContents()
  })
  await page.getByRole('combobox', { name: 'Planschaal', exact: true }).selectOption('50')
  expect(await withSchedule(async () => await rows.allTextContents())).toEqual(beforeScale)
  await page.getByRole('combobox', { name: 'Planschaal', exact: true }).selectOption('100')
  await expect(page.locator('drawing-scale-control .scale-warning')).toHaveCount(0)
  const cutsThroughSymbol = await app.evaluate((element: HTMLElement) => {
    const symbols = [...element.shadowRoot!.querySelectorAll('g.shape-symbol')].map((node) => node.getBoundingClientRect())
    return [...element.shadowRoot!.querySelectorAll<SVGPathElement>('.heating-pipe .heating-circuit')].some((path) => {
      const length = path.getTotalLength()
      for (let i = 0; i <= 300; i++) {
        const p = path.getPointAtLength(length * i / 300)
        const point = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!)
        if (symbols.some((b) => point.x > b.left + .5 && point.x < b.right - .5 && point.y > b.top + .5 && point.y < b.bottom - .5)) return true
      }
      return false
    })
  })
  expect(cutsThroughSymbol).toBe(false)
  const inspector = page.locator('#object-inspector')
  const overview = inspector.locator('[data-property-section="heating-circuits"]')
  await expect(overview).toBeVisible()
  const expectedRows = await shell.evaluate((element: any) => element.project.pages[element.loadedPage].schema.objects[0].payload.shapes
    .find((shape: any) => shape.heating?.kind === 'manifold').heating.rows)
  await expect(overview.locator('[data-heating-circuit]')).toHaveCount(expectedRows.length)
  for (const row of expectedRows) {
    const card = overview.locator(`[data-heating-circuit="${row.id}"]`)
    await expect(card).toContainText(row.room)
    await expect(card.locator('[data-heating-measure="cutM"]')).toHaveText(`${row.cutM.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} m`)
    await expect(card.locator('[data-heating-measure="supplyM"]')).toContainText('m')
    await expect(card.locator('[data-heating-measure="returnM"]')).toContainText('m')
  }
  await expect(overview.locator('[data-heating-circuit-totals]')).toContainText(`${expectedRows.length} kringen`)
  await expect(overview).toContainText('Richtdebiet*')
  await expect(inspector.locator('[data-heating-field="diameterMm"]')).toHaveValue('16')
  await inspector.locator('[data-heating-field="spacingMm"]').fill('200')
  await inspector.locator('[data-heating-field="spacingMm"]').press('Tab')
  await inspector.getByRole('button', { name: 'Legplan opnieuw berekenen', exact: true }).click()
  await withSchedule(async () => { await expect(app.locator('.heating-table')).toContainText('200 mm') })
  await expect(app.locator('.heating-quality-status')).toContainText('Concept')
  await expect(inspector.locator('[data-property-section="heating-checks"]')).toBeAttached()
  await inspector.locator('[data-property-section="heating-design"] summary').click()
  for (const [key, value] of Object.entries({ product: 'Testbuis 16×2', minBendRadiusMm: '80', maxCircuitLengthM: '90', allowanceM: '3', deltaTK: '7' })) {
    const input = inspector.locator(`[data-heating-design="${key}"]`)
    await input.fill(value); await input.press('Tab')
  }
  for (const room of ['Leefruimte', 'Keuken']) {
    const input = inspector.locator(`[data-heating-room="${room}"]`)
    await input.fill('500'); await input.press('Tab')
  }
  await inspector.getByRole('button', { name: 'Legplan opnieuw berekenen', exact: true }).click()
  await withSchedule(async () => {
    await expect(app.locator('.heating-table')).toContainText('3 m opstanden/snijreserve')
    await expect(app.locator('.heating-table')).toContainText('Testbuis 16×2')
  })
  await expect(inspector.locator('[data-heating-design="deltaTK"]')).toHaveValue('7')
  // Product and construction values are optional; live results must survive page changes/export.
  await inspector.locator('[data-property-section="heating-hydraulics"] summary').click()
  for (const [key, value] of Object.entries({ pipeWallMm: '2', roughnessMm: '0.007', fluidTemperatureC: '35', localLossK: '10', manifoldKv: '0.5', availablePressureKpa: '30' })) {
    const input = inspector.locator(`[data-heating-design="${key}"]`); await input.fill(value); await input.press('Tab')
  }
  await expect(inspector.locator('[data-heating-hydraulics="VV01"]')).toContainText('kPa')
  await inspector.locator('[data-property-section="heating-floor"] summary').click()
  for (const [key, value] of Object.entries({ coveringThicknessMm: '10', coveringLambda: '0.2', screedCoverMm: '45', screedLambda: '1.4', insulationThicknessMm: '60', insulationLambda: '0.035', minimumInsulationR: '1.25', supplyTemperatureC: '35', roomTemperatureC: '20', surfaceLimitC: '29', belowTemperatureC: '10', downwardDesignWm2: '5', systemReference: 'Test systeemtabel 200 mm', systemOutputWm2: '70' })) {
    const input = inspector.locator(`[data-heating-design="${key}"]`); await input.fill(value); await input.press('Tab')
  }
  await expect(inspector.locator('[data-heating-floor="Leefruimte"]')).toContainText('W/m²')
  await expect(inspector.locator('[data-heating-floor="Leefruimte"]')).not.toContainText('onderbouwing vervallen')
  await withSchedule(async () => {
    await expect(app.locator('.heating-table')).toContainText('extra smoren')
    await expect(app.locator('.heating-table')).toContainText('Test systeemtabel')
    const outOfTable = await app.locator('.heating-table').evaluate((group: SVGGElement) => {
      const rect = group.querySelector('rect')!, width = Number(rect.getAttribute('width')), height = Number(rect.getAttribute('height'))
      return [...group.querySelectorAll('text')].some((text) => { const b = text.getBBox(); return b.x < 0 || b.y < 0 || b.x + b.width > width + 1 || b.y + b.height > height + 1 })
    })
    expect(outOfTable).toBe(false)
  })
  const csvDownload = page.waitForEvent('download')
  await inspector.locator('[data-property-section="heating-checks"]').evaluate((element: HTMLDetailsElement) => { element.open = true })
  await inspector.getByRole('button', { name: 'Kringentabel als CSV', exact: true }).click()
  const csv = await csvDownload
  expect(csv.suggestedFilename()).toBe('vloerverwarming-kringen.csv')
  const exportSvg = await app.evaluate((element: any) => element.toSVG())
  expect(exportSvg).toContain('CONCEPT')
  expect(await withSchedule(async () => await app.evaluate((element: any) => element.toSVG()))).toContain('Drukverlies')
  const repair = await app.evaluate((element: HTMLElement) => {
    const root = element.shadowRoot!
    for (const path of root.querySelectorAll<SVGPathElement>('.heating-pipe .heating-circuit')) {
      if (!(path.getAttribute('d') ?? '').includes(' A ')) continue
      const id = path.closest<SVGGElement>('[data-shape-id]')!.dataset.shapeId!
      const screen = (at: number) => { const p = path.getPointAtLength(path.getTotalLength() * at); const q = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!); return { x: q.x, y: q.y } }
      for (const at of [.2, .4, .6, .8]) {
        const point = screen(at), top = root.elementFromPoint(point.x, point.y)
        if (top?.closest<SVGElement>('[data-shape-id]')?.dataset.shapeId === id) return { id, point, start: screen(0), end: screen(1), d: path.getAttribute('d') }
      }
    }
    throw new Error('No selectable curved heating route')
  })
  const pipeCount = await app.locator('.heating-pipe').count()
  await page.mouse.click(repair.point.x, repair.point.y)
  await inspector.getByRole('button', { name: 'Traject opnieuw tekenen', exact: true }).click()
  await expect(app.locator('.heating-planner-status')).toContainText('Enter bewaart')
  await page.keyboard.press('Escape')
  const repairedPath = app.locator(`[data-shape-id="${repair.id}"] .heating-circuit`)
  await expect(repairedPath).toHaveAttribute('d', repair.d!)
  if (await inspector.getAttribute('data-open') !== 'true') await page.getByRole('button', { name: 'Object properties', exact: true }).click()
  await inspector.getByRole('button', { name: 'Traject opnieuw tekenen', exact: true }).click()
  await page.mouse.click(repair.start.x, repair.start.y)
  await page.mouse.click(repair.end.x, repair.end.y)
  await page.keyboard.press('Enter')
  await expect(app.locator('.heating-pipe')).toHaveCount(pipeCount)
  await expect(repairedPath).not.toHaveAttribute('d', repair.d!)
  await app.locator('.heating-quality-status').click()
  await expect(inspector.locator('[data-heating-check="manual"]')).toContainText('handmatig')
  await app.evaluate((element: any) => element.undo())
  await expect(repairedPath).toHaveAttribute('d', repair.d!)
  expect(errors).toEqual([])
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, sourceKey)
  await expect(app.locator('.heating-pipe')).toHaveCount(0)
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, heatingKey)
  await withSchedule(async () => { await expect(app.locator('.heating-table')).toContainText('200 mm') })
  expect(await withSchedule(async () => await app.evaluate((element: any) => element.toSVG()))).toContain('Richtdebiet')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  await page.screenshot({ path: '/private/tmp/cadle-automatic-heating-plan.png' })
  // An occupied drawing must get a separate A4 schedule, included in undo/redo.
  const crowded = { ...state, shapes: [...shapes, { id: 'reserved', kind: 'rect', start: { x: 1000, y: 80 }, end: { x: 2100, y: 1400 } }] }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'crowded.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(crowded)) })
  await expect(app.locator('[data-shape-id="reserved"]')).toBeAttached()
  await app.evaluate((element: any) => element.startAutomaticHeatingPlan({ diameterMm: 16, spacingMm: 150 }))
  const start = await app.locator('.world').evaluate((world: SVGGElement) => {
    const p = new DOMPoint(180, 280).matrixTransform(world.getScreenCTM()!)
    return { x: p.x, y: p.y }
  })
  await page.mouse.click(start.x, start.y)
  await expect(app.locator('.heating-manifold')).toHaveCount(1, { timeout: 30000 })
  await expect(app.locator('.heating-table')).toHaveCount(0)
  const tableKey = await shell.evaluate((element: any, key) => Object.entries(element.project.pages).find(([, p]: any) => p.heatingScheduleOf === key)?.[0], heatingKey)
  expect(tableKey).toBeTruthy()
  await app.evaluate((element: any) => element.undo())
  expect(await shell.evaluate((element: any, key) => Object.values(element.project.pages).some((p: any) => p.heatingScheduleOf === key), heatingKey)).toBe(false)
  await app.evaluate((element: any) => element.redo())
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, tableKey)
  await expect(app.locator('.heating-table')).toContainText('Richtdebiet')
  await expect(app.locator('.heating-schedule-row')).not.toHaveCount(0)
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  expect(errors).toEqual([])
})
