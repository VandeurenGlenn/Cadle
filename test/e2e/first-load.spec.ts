import { expect, test } from '@playwright/test'

test('paints the Projects entry point without JavaScript', async ({ page }) => {
  await page.route('**/shell.js', (route) => route.abort())
  await page.goto('/')

  const fallback = page.locator('app-shell:not(:defined) .boot-projects')
  await expect(fallback.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(fallback.getByRole('link', { name: 'Create project' })).toHaveAttribute('href', '#!/create-project')
})

test('first load without an open project shows Projects instead of an empty editor', async ({ page }) => {
  await page.goto('/#!/native-draw')

  await expect(page).toHaveURL(/#!\/projects$/)
  await expect(page.locator('projects-field').getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.locator('projects-field')).toContainText('Welcome to Cadle')
  await expect.poll(() => page.evaluate(() => customElements.get('cadle-app') === undefined)).toBe(true)
  const startupResources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name)
  )
  expect(startupResources.some((url) => /\/(?:app\.js|jspdf[^/]*\.js|pdf-importer[^/]*\.js)$/.test(url))).toBe(false)

  await expect(page.locator('projects-field md-dialog.welcome-dialog')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  const projectsField = page.locator('projects-field')
  await expect(projectsField.locator('.mobile-brand')).toBeVisible()
  await expect(projectsField.locator('.hero-copy')).toBeHidden()
  await expect(projectsField.locator('.groundplan-scene')).toBeHidden()
  const welcomeBubble = projectsField.locator('.welcome-bubble')
  const projectsCard = projectsField.locator('flex-container')
  await expect(welcomeBubble).toBeVisible()
  await expect(projectsCard).toBeVisible()
  const welcomeBubbleBounds = await welcomeBubble.boundingBox()
  const projectsCardBounds = await projectsCard.boundingBox()
  expect(welcomeBubbleBounds?.y).toBeLessThan(projectsCardBounds?.y ?? 0)
  expect(projectsCardBounds?.y).toBeLessThan(430)

  await page.reload()
  await expect(page.locator('projects-field md-dialog.welcome-dialog')).toHaveCount(0)
})
