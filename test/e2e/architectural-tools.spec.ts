import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('draws sliding windows and cabinets and places mouse-following stairs and access points', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
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
  await page.getByRole('button', { name: 'Place stairs', exact: true }).click()
  const first = await point(1000, 360)
  await page.mouse.move(first.x, first.y)
  const preview = app.locator('g.symbol-preview > svg')
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.getAttribute('x')).not.toBeNull()
  const firstX = await preview.getAttribute('x')
  const second = await point(1240, 540)
  await page.mouse.move(second.x, second.y)
  await expect.poll(() => preview.getAttribute('x')).not.toBe(firstX)
  await page.mouse.down()
  await page.mouse.up()
  await expect(app.locator('g.shape-symbol[data-selected="true"]')).toHaveCount(1)

  await more.click()
  await page.getByRole('button', { name: 'Place Wi-Fi access point', exact: true }).click()
  const accessPoint = await point(1440, 620)
  await page.mouse.move(accessPoint.x, accessPoint.y)
  await expect(preview).toBeVisible()
  await page.mouse.down()
  await page.mouse.up()
  await expect(app.locator('g.shape-symbol[data-selected="true"]')).toHaveCount(1)

  const exported = await app.evaluate((element: any) => element.toSVG())
  expect(exported).toContain('M37 45a18 18 0 0 1 26 0')
  expect(exported).toContain('y1="88" x2="50" y2="12"')
})
