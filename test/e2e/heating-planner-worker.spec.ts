import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('the real background worker completes a 16 mm / 100 mm plan with full circuits', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell'), app = page.locator('cadle-app:not([read-only])')
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000102') })
  const corners = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 720 }, { x: 400, y: 720 }]
  const shapes = corners.map((start, i) => ({ id: `wall-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4] }))
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
  const heating = await shell.evaluate((element: any) => element.project.pages[element.loadedPage].schema.objects[0].payload.shapes)
  const manifold = heating.find((shape: any) => shape.heating?.kind === 'manifold').heating
  expect(manifold.audit.errors).toBe(0)
  expect(manifold.rows.length).toBeGreaterThan(0)
  for (const row of manifold.rows) {
    expect(row.spacingMm).toBe(100)
    expect(row.supplyM).toBeGreaterThan(0)
    expect(row.returnM).toBeGreaterThan(0)
    expect(row.cutM).toBeLessThanOrEqual(100.05)
  }
  await expect(app.locator('.heating-pipe')).toHaveCount(manifold.rows.length * 3)
})

test('keeps the page responsive during heavy calculation and preserves the drawing on cancel, failure and navigation', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss() })
  let mode = 'busy', starts = 0
  await page.route('**/heating-planner-worker.js', async (route) => {
    starts++
    const body = mode === 'error'
      ? `onmessage = () => postMessage({type:'error',message:'Test: geen geldige indeling gevonden.'})`
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
