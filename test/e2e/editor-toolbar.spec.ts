import { expect, test } from '@playwright/test'

test('keeps page context and tools visible, with accessible menus on wide and narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  const pages = page.locator('project-element')
  await pages.locator('custom-drawer-item[data-project="00000000-0000-4000-8000-000000000104"]').click()
  const app = page.locator('cadle-app:not([read-only])')
  await app.evaluate(async (element: any) => { await element.exportA4PNG() })
  const header = page.locator('.editor-header')
  const toolbar = page.getByRole('toolbar', { name: 'Drawing toolbar' })
  await expect(header.getByRole('heading', { name: 'One-wire circuits', exact: true })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Add breaker', exact: true })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Draw wall', exact: true })).toBeHidden()
  await expect(toolbar.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()

  const more = toolbar.getByRole('button', { name: 'More drawing tools', exact: true })
  await more.focus()
  await page.keyboard.press('Enter')
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Draw wall', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(more).toBeFocused()
  await more.click()
  await page.getByRole('button', { name: 'Draw circle', exact: true }).click()
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(more).toHaveAttribute('active', '')
  await toolbar.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(more).not.toHaveAttribute('active')

  const connections = toolbar.getByRole('button', { name: 'Elektrische verbindingen', exact: true })
  await connections.click()
  await expect(page.getByRole('button', { name: 'Teken kabel', exact: true })).toBeVisible()
  await header.getByRole('heading').click()
  await expect(connections).toHaveAttribute('aria-expanded', 'false')
  await page.screenshot({ path: '/private/tmp/cadle-toolbar-desktop.png' })

  for (const width of [960, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(toolbar.getByRole('button', { name: 'Add breaker', exact: true })).toBeInViewport()
    await expect(toolbar.getByRole('button', { name: 'More drawing tools', exact: true })).toBeInViewport()
    const fits = await toolbar.evaluate((element) => {
      const root = element.getBoundingClientRect()
      const actions = element.querySelector('cadle-actions')!
      const native = [...actions.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')]
      const electrical = [...actions.querySelector('onewire-actions')!.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')]
      return [...native, ...electrical].filter((button) => button.checkVisibility()).every((button) => {
        const b = button.getBoundingClientRect()
        return b.left >= root.left && b.right <= root.right && b.top >= root.top && b.bottom <= root.bottom
      })
    })
    expect(fits).toBe(true)
    await connections.click()
    const menu = page.locator('onewire-actions #connection-options')
    await expect(menu).toBeInViewport()
    await page.keyboard.press('Escape')
  }
  await page.screenshot({ path: '/private/tmp/cadle-toolbar-mobile.png' })
  await page.getByRole('button', { name: 'Open project menu' }).click()
  await pages.locator('custom-drawer-item[data-project="00000000-0000-4000-8000-000000000102"]').click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(toolbar.getByRole('button', { name: 'Draw wall', exact: true })).toBeVisible()
  await expect(page.locator('onewire-actions')).toHaveCount(0)
  await page.screenshot({ path: '/private/tmp/cadle-toolbar-floorplan.png' })
})
