import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.use({ serviceWorkers: 'block' })

test('shows the refrigerator marker in the list and in a complete, refreshed hover preview', async ({ page }) => {
  const markup = await readFile('www/symbols/Consumption appliances/Refrigerator.svg', 'utf8')
  let release!: () => void
  const ready = new Promise<void>((resolve) => { release = resolve })
  let blocked = 0
  await page.route('**/Refrigerator.svg', async (route) => {
    blocked++
    await ready
    await route.fulfill({ contentType: 'image/svg+xml', body: markup })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects', { waitUntil: 'domcontentloaded' })
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.getByRole('tab', { name: 'Symbols catalog' }).click()
  const search = page.locator('catalog-element search-element input')
  await search.fill('Refrigerator')
  await expect(page.locator('catalog-element .search-status')).toContainText('Refrigerator')
  const item = page.locator('catalog-category').filter({ has: page.getByRole('button', { name: /^Consumption appliances/ }) })
    .getByRole('button', { name: /^Place refrigerator$/i })
  await expect.poll(() => blocked).toBeGreaterThan(0)
  await item.hover()
  const magnifier = page.locator('.catalog-magnifier')
  await expect(magnifier).toBeVisible()
  await expect(magnifier.locator('svg text')).toHaveCount(0)
  release()
  await expect(item.locator('.preview svg text')).toHaveText('*')
  await expect(magnifier.locator('svg text')).toHaveText('*')
  await expect(magnifier).toHaveAttribute('data-symbol-path', 'symbols/Consumption appliances/Refrigerator.svg')
  for (const svg of [item.locator('.preview svg'), magnifier.locator('svg')]) {
    const fit = await svg.evaluate((node: SVGSVGElement) => {
      const box = node.getBBox(), view = node.viewBox.baseVal
      const screen = node.getBoundingClientRect(), container = node.parentElement!.getBoundingClientRect()
      return box.x >= view.x && box.y >= view.y && box.x + box.width <= view.x + view.width &&
        box.y + box.height <= view.y + view.height && screen.right <= container.right + 1 && screen.bottom <= container.bottom + 1
    })
    expect(fit).toBe(true)
  }
  await page.screenshot({ path: '/private/tmp/cadle-refrigerator-preview.png' })

})
