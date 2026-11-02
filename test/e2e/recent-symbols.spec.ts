import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

test('cleans stored duplicates and keeps recent picks unique across categories and names', async ({ page }) => {
  await page.goto('/?fixture=priority-suite#!/projects')
  await page.evaluate(() => {
    const meter = { category: 'Consumption appliances', symbol: { kind: 'Consumption appliances', name: 'kWh meter', path: 'symbols/Consumption appliances/kWh meter.svg' } }
    const fridge = { category: 'Consumption appliances', symbol: { kind: 'Consumption appliances', name: 'Refrigerator', path: 'symbols/Consumption appliances/Refrigerator.svg' } }
    localStorage.setItem('cadle.catalog.recentSymbols', JSON.stringify([
      meter, fridge,
      { ...meter, category: 'Recent symbols', symbol: { ...meter.symbol, name: 'Meter alias' } },
      { ...fridge, category: 'Recent symbols' }
    ]))
  })
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.getByRole('tab', { name: 'Symbols catalog' }).click()
  const recent = page.locator('catalog-element catalog-category').first()
  await expect(recent.getByText('Recent symbols', { exact: true })).toBeVisible()
  await expect(recent.locator('catalog-item')).toHaveCount(2)
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cadle.catalog.recentSymbols')!))
  expect(await stored()).toHaveLength(2)
  await recent.getByRole('button', { name: 'Place Refrigerator', exact: true }).click()
  await expect(recent.locator('catalog-item')).toHaveCount(2)
  expect((await stored())[0].symbol.name).toBe('Refrigerator')
  await recent.getByRole('button', { name: 'Place kWh meter', exact: true }).click()
  await recent.getByRole('button', { name: 'Place kWh meter', exact: true }).click()
  const entries = await stored()
  expect(entries).toHaveLength(2)
  expect(entries[0].symbol.name).toBe('kWh meter')
  expect(entries[0].category).toBe('Consumption appliances')
  await page.reload()
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await page.getByRole('tab', { name: 'Symbols catalog' }).click()
  await expect(recent.locator('catalog-item')).toHaveCount(2)
})
