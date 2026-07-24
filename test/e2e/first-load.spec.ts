import { expect, test } from '@playwright/test'

test('first load without an open project shows Projects instead of an empty editor', async ({ page }) => {
  await page.goto('/#!/native-draw')

  await expect(page).toHaveURL(/#!\/projects$/)
  await expect(page.locator('projects-field').getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.locator('projects-field')).toContainText('Welcome to Cadle')
})
