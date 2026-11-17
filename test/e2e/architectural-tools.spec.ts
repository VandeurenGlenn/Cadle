import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('all symbol ink defaults to black without losing cutouts or editable colors', async ({ page }) => {
  await page.route('**/symbols/General/Access%20point.svg', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="orange">
      <style>.colored { stroke: blue; fill: red; }</style>
      <rect id="colored-ink" class="colored" x="10" y="10" width="80" height="80"/>
      <circle id="cutout" cx="50" cy="50" r="20" fill="#ffffff" stroke="none"/>
      <path id="inherited-ink" d="M20 20L80 80" fill="none" stroke="currentColor"/>
      <text id="default-ink" x="40" y="55">AP</text>
    </svg>`
  }))
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('app-shell').evaluate(async (element: any) => {
    await element.loadPage('00000000-0000-4000-8000-000000000102')
  })
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate((element) => { element.style.color = 'purple' })
  await page.getByRole('button', { name: 'More drawing tools', exact: true }).click()
  await page.getByRole('button', { name: 'Place Wi-Fi access point', exact: true }).click()
  const position = await app.locator('.world').evaluate((world: SVGGElement) => {
    const point = new DOMPoint(1440, 620).matrixTransform(world.getScreenCTM()!)
    return { x: point.x, y: point.y }
  })
  await page.mouse.click(position.x, position.y)
  const symbol = app.locator('g.shape-symbol[data-selected="true"]')
  await expect(symbol.locator('#colored-ink')).toHaveCSS('stroke', 'rgb(0, 0, 0)')
  await expect(symbol.locator('#colored-ink')).toHaveCSS('fill', 'rgb(0, 0, 0)')
  await expect(symbol.locator('#inherited-ink')).toHaveCSS('stroke', 'rgb(0, 0, 0)')
  await expect(symbol.locator('#inherited-ink')).toHaveCSS('fill', 'none')
  await expect(symbol.locator('#default-ink')).toHaveCSS('fill', 'rgb(0, 0, 0)')
  await expect(symbol.locator('#cutout')).toHaveCSS('fill', 'rgb(255, 255, 255)')
  await expect(symbol.locator('#cutout')).toHaveCSS('stroke', 'none')

  const exportedInk = await app.evaluate((element: any) => {
    const parsed = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    return parsed.querySelector('#colored-ink')?.getAttribute('style')
  })
  expect(exportedInk).toContain('stroke:var(--symbol-stroke, #000000)')
  expect(exportedInk).toContain('fill:var(--symbol-fill, #000000)')
  await symbol.locator('svg').evaluate((element: SVGSVGElement) => {
    element.style.setProperty('--symbol-stroke', '#008000')
    element.style.setProperty('--symbol-fill', '#ff0000')
  })
  await expect(symbol.locator('#colored-ink')).toHaveCSS('stroke', 'rgb(0, 128, 0)')
  await expect(symbol.locator('#colored-ink')).toHaveCSS('fill', 'rgb(255, 0, 0)')
})

test('draws sized stairs, sliding windows and cabinets and places equipment symbols', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const shell = page.locator('app-shell')
  const pageKey = '00000000-0000-4000-8000-000000000102'
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, pageKey)
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })

  const point = async (x: number, y: number) => app.locator('.world').evaluate((world: SVGGElement, value) => {
    const screen = new DOMPoint(value.x, value.y).matrixTransform(world.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  }, { x, y })
  const draw = async (x1: number, y1: number, x2: number, y2: number) => {
    const start = await point(x1, y1), end = await point(x2, y2)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y)
    await page.mouse.up()
  }
  const more = page.getByRole('button', { name: 'More drawing tools', exact: true })

  await page.getByRole('button', { name: 'Draw sliding window', exact: true }).click()
  await draw(300, 300, 520, 300)
  await expect(app.locator('line.shape-sliding-window-track')).toHaveCount(1)
  await expect(app.locator('path.shape-sliding-window-arrow')).toHaveCount(1)

  await more.click()
  await page.getByRole('button', { name: 'Draw built-in cabinet', exact: true }).click()
  await draw(600, 300, 820, 420)
  await expect(app.locator('g.shape-built-in-cabinet')).toHaveCount(1)

  await more.click()
  await page.getByRole('button', { name: 'Rechte trap tekenen', exact: true }).click()
  const first = await point(1000, 360)
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  const narrow = await point(1080, 600)
  await page.mouse.move(narrow.x, narrow.y)
  const stairPreview = app.locator('g.shape-stairs.draft .stairs-outline')
  const footprint = () => stairPreview.evaluate((path: SVGPathElement) => {
    const bounds = path.getBBox()
    return { width: bounds.width, height: bounds.height }
  })
  await expect.poll(footprint).toEqual({ width: 80, height: 240 })
  const wide = await point(1200, 680)
  await page.mouse.move(wide.x, wide.y)
  await expect.poll(footprint).toEqual({ width: 200, height: 320 })
  await page.mouse.up()
  await expect(stairPreview).toHaveCount(0)
  await expect(app.locator('g.shape-stairs[data-stair-variant="stairs-straight"]')).toHaveCount(1)

  await more.click()
  await page.getByRole('button', { name: 'Kwartdraaitrap tekenen', exact: true }).click()
  await draw(300, 700, 540, 1000)
  await expect(app.locator('g.shape-stairs[data-stair-variant="stairs-quarter-turn"]')).toHaveCount(1)

  await more.click()
  await page.getByRole('button', { name: 'Wenteltrap tekenen', exact: true }).click()
  await draw(640, 700, 880, 940)
  await expect(app.locator('g.shape-stairs[data-stair-variant="stairs-spiral"]')).toHaveCount(1)

  await app.evaluate((element) => { element.style.color = 'rgb(128, 0, 128)' })
  await more.click()
  await page.getByRole('button', { name: 'Place Wi-Fi access point', exact: true }).click()
  const accessPoint = await point(1440, 620)
  await page.mouse.move(accessPoint.x, accessPoint.y)
  const preview = app.locator('g.symbol-preview > svg')
  await expect(preview).toBeVisible()
  await expect(preview.locator('circle')).toHaveCount(1)
  await expect(preview.locator('path')).toBeVisible()
  await expect(preview.locator('text')).toHaveText('AP')
  await expect(preview.locator('circle')).toHaveCSS('stroke', 'rgb(0, 0, 0)')
  await page.mouse.down()
  await page.mouse.up()
  const placedAccessPoint = app.locator('g.shape-symbol[data-selected="true"]')
  await expect(placedAccessPoint).toHaveCount(1)
  await expect(placedAccessPoint.locator('circle')).toHaveCount(1)
  await expect(placedAccessPoint.locator('text')).toHaveText('AP')
  await expect(placedAccessPoint.locator('circle')).toHaveCSS('stroke', 'rgb(0, 0, 0)')
  await expect(placedAccessPoint.locator('path')).toHaveCSS('stroke', 'rgb(0, 0, 0)')
  await expect(placedAccessPoint.locator('text')).toHaveCSS('fill', 'rgb(0, 0, 0)')
  const accessPointGeometry = await placedAccessPoint.evaluate((element) => {
    const circle = element.querySelector('circle')!
    const path = element.querySelector('path')!
    const arcs = path.getBBox()
    const text = element.querySelector('text')!
    return {
      circleTop: circle.cy.baseVal.value - circle.r.baseVal.value - Number.parseFloat(getComputedStyle(circle).strokeWidth) / 2,
      arcsBottom: arcs.y + arcs.height + Number.parseFloat(getComputedStyle(path).strokeWidth) / 2,
      center: [circle.cx.baseVal.value, circle.cy.baseVal.value],
      textAnchor: [text.x.baseVal.getItem(0).value, text.y.baseVal.getItem(0).value]
    }
  })
  expect(accessPointGeometry.arcsBottom).toBeLessThan(accessPointGeometry.circleTop)
  expect(accessPointGeometry.textAnchor).toEqual(accessPointGeometry.center)

  await more.click()
  await page.getByRole('button', { name: 'Warmtepomp plaatsen', exact: true }).click()
  const heatPumpPoint = await point(1680, 620)
  await page.mouse.move(heatPumpPoint.x, heatPumpPoint.y)
  await expect(preview.locator('title')).toHaveText('Heat pump')
  await expect(preview.locator('rect')).toBeVisible()
  await page.mouse.down()
  await page.mouse.up()
  const placedHeatPump = app.locator('g.shape-symbol:not(.symbol-preview)').filter({ has: page.locator('title', { hasText: 'Heat pump' }) })
  await expect(placedHeatPump).toHaveCount(1)
  await expect(placedHeatPump.locator('rect')).toHaveCSS('stroke', 'rgb(0, 0, 0)')

  const exported = await app.evaluate((element: any) => element.toSVG())
  expect(exported).toContain('>AP</text>')
  expect(exported).toContain('M23 19 Q50 -7 77 19 M32 25 Q50 7 68 25')
  expect(exported).toMatch(/<title\b[^>]*>Heat pump<\/title>/)
  for (const variant of ['stairs-straight', 'stairs-quarter-turn', 'stairs-spiral']) {
    expect(exported).toContain(`data-stair-variant="${variant}"`)
  }
  await app.evaluate(async (element: any) => { await element.flushPendingSave() })
  await shell.evaluate(async (element: any) => { await element.loadPage('00000000-0000-4000-8000-000000000101') })
  await shell.evaluate(async (element: any, key) => { await element.loadPage(key) }, pageKey)
  await expect(placedHeatPump).toHaveCount(1)
  await expect(app.locator('g.shape-stairs')).toHaveCount(3)
  await expect.poll(() => app.locator('g[data-stair-variant="stairs-straight"] .stairs-outline')
    .evaluate((path: SVGPathElement) => {
      const bounds = path.getBBox()
      return { width: bounds.width, height: bounds.height }
    })).toEqual({ width: 200, height: 320 })
})
