import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

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
