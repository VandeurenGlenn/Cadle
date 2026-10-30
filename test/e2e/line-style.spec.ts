import { expect, test } from '@playwright/test'

test('draws black two-pixel lines in preview, on the sheet, in SVG and after reopening', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000102"]').click()
  const app = page.locator('cadle-app')
  await expect(app.locator('.project-title-block')).toBeVisible()
  const points = await app.locator('svg.stage .world').evaluate((world: SVGGElement) => {
    const matrix = world.getScreenCTM()!
    const start = new DOMPoint(500, 150).matrixTransform(matrix)
    const end = new DOMPoint(800, 150).matrixTransform(matrix)
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } }
  })
  await page.keyboard.press('l')
  await page.mouse.move(points.start.x, points.start.y)
  await page.mouse.down()
  await page.mouse.move(points.end.x, points.end.y)
  const draft = app.locator('line.shape-line.draft')
  await expect(draft).toHaveCSS('stroke', 'rgb(0, 0, 0)')
  await expect(draft).toHaveCSS('stroke-width', '2px')
  await expect(draft).toHaveCSS('opacity', '1')
  const id = await draft.getAttribute('data-shape-id')
  await page.mouse.up()
  const line = app.locator(`line[data-shape-id="${id}"]`)
  await expect(line).toHaveCSS('stroke', 'rgb(0, 0, 0)')
  await expect(line).toHaveCSS('stroke-width', '2px')
  const exported = await app.evaluate((element: any, id) => {
    const svg = new DOMParser().parseFromString(element.toSVG(), 'image/svg+xml')
    const line = svg.querySelector(`line[data-shape-id="${id}"]`) as SVGLineElement
    return { color: line.getAttribute('stroke'), width: line.style.strokeWidth }
  }, id)
  expect(exported).toEqual({ color: '#000000', width: '2px' })
  // Reopening the fixture URL recreates its test project; switch sheets to
  // exercise saving and restoring the edited document instead.
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000103"]').click()
  await expect(app.locator('.project-title-block')).toContainText('One-wire distribution')
  await page.locator('project-element custom-drawer-item[data-project="00000000-0000-4000-8000-000000000102"]').click()
  await expect(line).toHaveCSS('stroke', 'rgb(0, 0, 0)')
  await expect(line).toHaveCSS('stroke-width', '2px')
})
