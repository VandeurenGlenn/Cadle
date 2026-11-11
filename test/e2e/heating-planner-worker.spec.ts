import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('the real background worker completes a 16 mm / 100 mm plan with full circuits', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell'), app = page.locator('cadle-app:not([read-only])')
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000102') })
  const corners = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 720 }, { x: 400, y: 720 }]
  const shapes = corners.map((start, i) => ({ id: `wall-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4] }))
  shapes.push({ id: 'door-test', kind: 'door', start: { x: 560, y: 400 }, end: { x: 640, y: 400 } })
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'pitch100.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, drawingScale: 100, paperPreset: 'a4-landscape',
      worldWidth: 2376, worldHeight: 1680, printMargin: 10, shapes })) })
  await expect(app.locator('[data-shape-id="wall-3"]')).toBeAttached()
  await app.evaluate((element: any) => element.startAutomaticHeatingPlan({ diameterMm: 16, spacingMm: 100 }))
  await expect(app.locator('.heating-planner-status')).toContainText('Klik het startpunt')
  const point = await app.locator('.world').evaluate((world: SVGGElement) => {
    const p = new DOMPoint(180, 280).matrixTransform(world.getScreenCTM()!)
    return { x: p.x, y: p.y }
  })
  await page.mouse.click(point.x, point.y)
  await expect(app.locator('.heating-manifold')).toHaveCount(1, { timeout: 15000 })
  await expect(app.locator('.heating-planner-status')).toHaveCount(0)
  await expect.poll(() => page.workers().length).toBe(0)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  let heating = await shell.evaluate((element: any) => element.project.pages[element.loadedPage].schema.objects[0].payload.shapes)
  let manifold = heating.find((shape: any) => shape.heating?.kind === 'manifold').heating
  expect(manifold.pattern).toBe('spiral')
  expect(manifold.audit.errors).toBe(0)
  expect(manifold.rows.length).toBeGreaterThan(0)
  for (const row of manifold.rows) {
    expect(row.spacingMm).toBe(100)
    expect(row.supplyM).toBeGreaterThan(0)
    expect(row.returnM).toBeGreaterThan(0)
    expect(row.cutM).toBeLessThanOrEqual(100.05)
  }
  await expect(app.locator('.heating-pipe')).toHaveCount(manifold.rows.length * 3)
  expect(manifold.capacity).toBe(12)
  expect(manifold.connectionMode).toBe('zone')
  expect(manifold.audit.issues.some((issue: any) => issue.code === 'open-connections')).toBe(true)
  await expect(app.locator('.heating-connection-position')).toHaveCount(1)
  const inspector = page.locator('#object-inspector')
  await expect(inspector.locator('[data-heating-field="capacity"]')).toHaveValue('12')
  await expect(inspector.locator('[data-heating-field="edgeMm"]')).toHaveValue('100')
  const selected = manifold.rows[0].id, originalLength = manifold.rows[0].loopM
  const unchanged = heating.filter((s: any) => s.heating?.kind === 'pipe' && s.heating.circuitId !== selected).map((s: any) => JSON.stringify([s.id, s.start, s.end, s.heating.points]))
  const spacing = inspector.locator(`[data-heating-circuit-spacing="${selected}"]`)
  await spacing.fill('15'); await spacing.press('Tab')
  await expect.poll(async () => {
    await app.evaluate(async (element: any) => { await element.flushPendingSave() })
    return await shell.evaluate((element: any, id) => element.project.pages[element.loadedPage].schema.objects[0].payload.shapes.find((s: any) => s.heating?.kind === 'manifold').heating.rows.find((r: any) => r.id === id)?.spacingMm, selected)
  }, { timeout: 15000 }).toBe(150)
  heating = await shell.evaluate((element: any) => element.project.pages[element.loadedPage].schema.objects[0].payload.shapes)
  manifold = heating.find((shape: any) => shape.heating?.kind === 'manifold').heating
  expect(manifold.rows.find((r: any) => r.id === selected).loopM).toBeLessThan(originalLength)
  expect(manifold.spacingMm).toBe(100)
  expect(manifold.circuitSpacingMm[selected]).toBe(150)
  expect(manifold.audit.errors).toBe(0)
  expect(heating.filter((s: any) => s.heating?.kind === 'pipe' && s.heating.circuitId !== selected).map((s: any) => JSON.stringify([s.id, s.start, s.end, s.heating.points]))).toEqual(unchanged)
  for (let i = 0; i < manifold.rows.length; i++) await inspector.getByRole('button', { name: 'Kring vastzetten', exact: true }).first().click()
  await expect(inspector.getByRole('button', { name: 'Kring losmaken', exact: true })).toHaveCount(manifold.rows.length)
  const beforePipes = heating.filter((shape: any) => shape.heating?.kind === 'pipe').map((shape: any) => JSON.stringify([shape.id, shape.start, shape.end, shape.heating.points]))
  const oldOwner = heating.find((shape: any) => shape.heating?.kind === 'manifold').id
  await inspector.getByRole('button', { name: 'Legplan opnieuw berekenen', exact: true }).click()
  await expect(app.locator('.heating-planner-status')).toHaveCount(0, { timeout: 15000 })
  const savedShapes = async () => {
    await app.evaluate(async (element: any) => { await element.flushPendingSave() })
    return await shell.evaluate((element: any) => element.project.pages[element.loadedPage].schema.objects[0].payload.shapes)
  }
  await expect.poll(async () => (await savedShapes()).find((s: any) => s.heating?.kind === 'manifold').id).not.toBe(oldOwner)
  const after = await savedShapes()
  expect(after.filter((s: any) => s.heating?.kind === 'pipe').map((s: any) => JSON.stringify([s.id, s.start, s.end, s.heating.points]))).toEqual(beforePipes)
  await inspector.locator('[data-property-section="heating-rooms"] summary').click()
  await expect(inspector.getByRole('button', { name: 'Deze ruimte herberekenen', exact: true })).toHaveCount(1)
  await inspector.getByRole('button', { name: 'Dekkingskaart tonen/verbergen', exact: true }).click()
  await expect(app.locator('.heating-coverage-overlay')).toHaveCount(1)
  await page.getByRole('button', { name: 'More drawing tools', exact: true }).click()
  await page.getByRole('button', { name: 'Verboden verwarmingszone tekenen', exact: true }).click()
  const screenPoint = async (x: number, y: number) => app.locator('.world').evaluate((world: SVGGElement, p) => {
    const s = new DOMPoint(p.x, p.y).matrixTransform(world.getScreenCTM()!); return { x: s.x, y: s.y }
  }, { x, y })
  const from = await screenPoint(900, 500), to = await screenPoint(1000, 600)
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y); await page.mouse.up()
  await expect.poll(async () => (await savedShapes()).filter((s: any) => s.heating?.kind === 'exclusion').length).toBe(1)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  const middle = await screenPoint(950, 550)
  await page.mouse.click(middle.x, middle.y)
  await expect(app.locator('.heating-exclusion[data-selected="true"]')).toHaveCount(1)
  await expect(inspector).toContainText('Verboden verwarmingszone')
  await page.screenshot({ path: '/private/tmp/cadle-slakkenhuis-16-100.png' })
})

test('the real worker completes all seven rooms at 16/100 in one request', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell'), app = page.locator('cadle-app:not([read-only])')
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000102') })
  const shapes: any[] = []
  for (let room = 0; room < 7; room++) {
    const x = 400 + room % 4 * 280, y = 400 + Math.floor(room / 4) * 280
    const corners = [{ x, y }, { x: x + 240, y }, { x: x + 240, y: y + 240 }, { x, y: y + 240 }]
    shapes.push(...corners.map((start, i) => ({ id: `seven-${room}-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4] })),
      { id: `door-${room}`, kind: 'door', start: { x: x + 80, y }, end: { x: x + 160, y } })
  }
  await app.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'seven-rooms.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 2, paperLayoutVersion: 1, drawingScale: 100, paperPreset: 'a4-landscape',
      worldWidth: 2376, worldHeight: 1680, printMargin: 10, shapes })) })
  await expect(app.locator('[data-shape-id="seven-6-3"]')).toBeAttached()
  let starts = 0
  page.on('worker', () => { starts++ })
  await app.evaluate((element: any) => element.startAutomaticHeatingPlan({ diameterMm: 16, spacingMm: 100 }))
  const p = await app.locator('.world').evaluate((world: SVGGElement) => {
    const point = new DOMPoint(180, 280).matrixTransform(world.getScreenCTM()!); return { x: point.x, y: point.y }
  })
  await page.mouse.click(p.x, p.y)
  await expect(app.locator('.heating-manifold')).toHaveCount(1, { timeout: 30000 })
  await expect(app.locator('.heating-planner-status')).toHaveCount(0)
  await expect.poll(() => page.workers().length).toBe(0)
  expect(starts).toBe(1)
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  const data = await shell.evaluate((element: any) => element.project.pages[element.loadedPage].schema.objects[0].payload.shapes.find((s: any) => s.heating?.kind === 'manifold').heating)
  expect(new Set(data.rows.map((r: any) => r.room)).size).toBe(7)
  expect(data.audit.errors).toBe(0)
  expect(data.rows.length).toBeLessThanOrEqual(12)
  expect(data.rows.every((r: any) => r.cutM <= 100.05 && r.supplyM > 0 && r.returnM > 0)).toBe(true)
  await expect(app.locator('.heating-pipe')).toHaveCount(data.rows.length * 3)
})

test('keeps the page responsive during heavy calculation and preserves the drawing on cancel, failure and navigation', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss() })
  let mode = 'busy', starts = 0
  await page.route('**/heating-planner-worker.js', async (route) => {
    starts++
    const body = mode === 'error'
      ? `onmessage = () => postMessage({type:'error',message:'Test: geen geldige indeling gevonden.',diagnostics:{code:'connection',scale:100,diameterMm:16,spacingMm:100,capacity:12,maxCircuitLengthM:100,candidateCircuits:14,areaM2:102,estimatedFloorPipeM:1020,point:{x:180,y:280},rooms:[{key:'r1',name:'Berging',zoneName:'Berging / Hal',areaM2:4,estimatedFloorPipeM:40,candidateCircuits:1,loopM:38,point:{x:500,y:500},bounds:{x:400,y:400,width:200,height:200}}],issues:[{message:'Laatste afgewezen aansluittraject: geen vrije tweede aansluiting.',point:{x:500,y:500}}]}})`
      : `onmessage = () => { postMessage({type:'progress',progress:{phase:'connections',completedCircuits:1,circuits:12}});
          const until = Date.now() + 15000; while (Date.now() < until) {}
          postMessage({type:'result',result:{shapes:[],rows:[],tableOnSeparatePage:false,wallCrossings:0}}) }`
    await route.fulfill({ contentType: 'text/javascript', body })
  })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell'), app = page.locator('cadle-app:not([read-only])')
  const sourceKey = '00000000-0000-4000-8000-000000000102'
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, sourceKey)
  await app.locator('.world').waitFor()
  const savedState = async () => {
    await app.evaluate(async (element: any) => { await element.flushPendingSave() })
    return await shell.evaluate((element: any) => JSON.stringify(element.project.pages[element.loadedPage].schema))
  }
  const original = await savedState()
  const start = async () => {
    await app.evaluate((element: any) => element.startAutomaticHeatingPlan({ diameterMm: 16, spacingMm: 150 }))
    const point = await app.locator('.world').evaluate((world: SVGGElement) => {
      const p = new DOMPoint(180, 280).matrixTransform(world.getScreenCTM()!)
      return { x: p.x, y: p.y }
    })
    await page.mouse.click(point.x, point.y)
  }
  await start()
  await expect(app.locator('.heating-planner-status')).toContainText('1/12 kringen')
  const heartbeat = await page.evaluate(() => new Promise<number>((resolve) => {
    const start = performance.now(); requestAnimationFrame(() => resolve(performance.now() - start))
  }))
  expect(heartbeat).toBeLessThan(1000)
  await app.getByRole('button', { name: 'Berekening annuleren', exact: true }).click({ timeout: 3000 })
  await expect(app.locator('.heating-planner-status')).toHaveCount(0)
  await expect.poll(() => page.workers().length).toBe(0)
  expect(await savedState()).toBe(original)

  mode = 'error'
  await start()
  await expect(app.getByRole('alert')).toContainText('Test: geen geldige indeling gevonden.')
  await expect.poll(() => page.workers().length).toBe(0)
  await expect(app.locator('.heating-diagnostic')).toContainText('102.0 m²')
  await expect(app.locator('.heating-diagnostic-marker')).toHaveCount(1)
  await app.getByRole('button', { name: 'Berging', exact: true }).click()
  await expect(app.locator('.heating-diagnostic-overlay')).toHaveCount(1)
  await expect(app.getByRole('button', { name: 'Diagnose downloaden', exact: true })).toBeVisible()
  expect(await savedState()).toBe(original)
  mode = 'busy'
  await app.getByRole('button', { name: 'Opnieuw proberen', exact: true }).click()
  await expect(app.locator('.heating-planner-status')).toContainText('1/12 kringen')
  await page.keyboard.press('Escape')
  await expect(app.locator('.heating-planner-status')).toHaveCount(0)
  await expect.poll(() => page.workers().length).toBe(0)
  expect(await savedState()).toBe(original)

  await start()
  await expect(app.locator('.heating-planner-status')).toContainText('1/12 kringen')
  const otherKey = await shell.evaluate((element: any, source) => Object.keys(element.project.pages).find((key) => key !== source), sourceKey)
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, otherKey)
  await expect(app.locator('.heating-planner-status')).toHaveCount(0)
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, sourceKey)
  await expect.poll(() => page.workers().length).toBe(0)
  expect(await savedState()).toBe(original)
  expect(starts).toBe(4)
  expect(dialogs).toEqual([])
})
