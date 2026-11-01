import { expect, test } from '@playwright/test'

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
