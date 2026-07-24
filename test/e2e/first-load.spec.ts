import { expect, test } from '@playwright/test'

test('first load without an open project shows Projects instead of an empty editor', async ({ page }) => {
  await page.goto('/#!/native-draw')

  await expect(page).toHaveURL(/#!\/projects$/)
  await expect(page.locator('projects-field').getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.locator('projects-field')).toContainText('Welcome to Cadle')

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
