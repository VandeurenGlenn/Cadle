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

  const welcome = page.locator('projects-field md-dialog.welcome-dialog')
  await expect(welcome).toBeVisible()
  await expect(welcome.getByText('Hello, welcome to Cadle')).toBeVisible()
  await expect(welcome.getByRole('button', { name: 'Create project' })).toBeVisible()
  await expect(welcome.getByRole('button', { name: 'Upload project' })).toBeVisible()
  await welcome.getByRole('button', { name: 'Maybe later' }).click()
  await expect(welcome).not.toBeVisible()

  await page.reload()
  await expect(page.locator('projects-field md-dialog.welcome-dialog')).not.toBeVisible()
})
