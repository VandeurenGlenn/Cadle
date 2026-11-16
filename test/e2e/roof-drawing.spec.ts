import { expect, test } from '@playwright/test'

test('draws, edits, patterns, exports and reopens a directional roof overlay', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const pages = page.locator('project-element')
  await pages.locator('custom-drawer-item[data-project="00000000-0000-4000-8000-000000000102"]').click()

  const app = page.locator('cadle-app:not([read-only])')
  const toolbar = page.getByRole('toolbar', { name: 'Drawing toolbar' })
  const inspector = page.locator('app-shell #object-inspector')
  await expect(app.locator('.project-title-block')).toBeVisible()

  await toolbar.getByRole('button', { name: 'More drawing tools', exact: true }).click()
  await page.getByRole('button', { name: 'Dakvlak · zonder punt', exact: true }).click()
  await expect(page.locator('status-bar .item.tool .value')).toHaveText('Dakvlak · zonder punt')

  const points = await app.locator('svg.stage .world').evaluate((world: SVGGElement) => {
    const matrix = world.getScreenCTM()!
    const start = new DOMPoint(500, 160).matrixTransform(matrix)
    const end = new DOMPoint(780, 300).matrixTransform(matrix)
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } }
  })
  await page.mouse.move(points.start.x, points.start.y)
  await page.mouse.down()
  await page.mouse.move(points.end.x, points.end.y, { steps: 4 })
  const draft = app.locator('g.shape-roof.draft[data-roof-direction="straight"]')
  await expect(draft).toBeVisible()
  const id = await draft.getAttribute('data-shape-id')
  expect(id).toBeTruthy()
  await page.mouse.up()

  const roof = app.locator(`g.shape-roof[data-shape-id="${id}"]`)
  await expect(roof).toHaveAttribute('data-roof-direction', 'straight')
  await expect(roof).toHaveAttribute('data-roof-pattern', 'none')
  await expect(inspector).toHaveAttribute('data-open', 'true')
  const roofSection = inspector.locator('[data-property-section="roof"]')
  await expect(roofSection).toHaveAttribute('open', '')
  await roofSection.locator('select[data-roof-direction]').selectOption('roof-right')
  await expect(roof).toHaveAttribute('data-roof-direction', 'right')
  await roofSection.locator('select[data-roof-direction]').selectOption('roof-straight')
  await roofSection.locator('select[data-roof-pattern]').selectOption('tiles')
  await expect(roof).toHaveAttribute('data-roof-direction', 'straight')
  await expect(roof).toHaveAttribute('data-roof-pattern', 'tiles')
  await expect(roof.locator('path.roof-pattern')).toBeVisible()
  await page.screenshot({ path: '/private/tmp/cadle-roof-pattern.png' })

  const geometry = await app.evaluate((element: any, shapeId) => {
    const live = element.shadowRoot.querySelector(`g[data-shape-id="${shapeId}"]`)
    const exported = new DOMParser()
      .parseFromString(element.toSVG(), 'image/svg+xml')
      .querySelector(`g[data-shape-id="${shapeId}"]`)
    return {
      liveDirection: live?.getAttribute('data-roof-direction'),
      exportDirection: exported?.getAttribute('data-roof-direction'),
      livePattern: live?.getAttribute('data-roof-pattern'),
      exportPattern: exported?.getAttribute('data-roof-pattern'),
      liveRidges: live?.querySelector('path.roof-ridges')?.getAttribute('d'),
      exportRidges: exported?.querySelector('path.roof-ridges')?.getAttribute('d'),
      liveTiles: live?.querySelector('path.roof-pattern')?.getAttribute('d'),
      exportTiles: exported?.querySelector('path.roof-pattern')?.getAttribute('d')
    }
  }, id)
  expect(geometry.exportDirection).toBe(geometry.liveDirection)
  expect(geometry.exportPattern).toBe(geometry.livePattern)
  expect(geometry.exportRidges).toBe(geometry.liveRidges)
  expect(geometry.exportTiles).toBe(geometry.liveTiles)

  await pages.locator('custom-drawer-item[data-project="00000000-0000-4000-8000-000000000103"]').click()
  await expect(app.locator('.project-title-block')).toContainText('One-wire distribution')
  await pages.locator('custom-drawer-item[data-project="00000000-0000-4000-8000-000000000102"]').click()
  await expect(roof).toHaveAttribute('data-roof-direction', 'straight')
  await expect(roof).toHaveAttribute('data-roof-pattern', 'tiles')
})
