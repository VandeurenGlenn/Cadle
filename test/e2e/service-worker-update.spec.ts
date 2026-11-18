import { expect, test as base, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { AppShell } from '../../src/shell/app-shell.ts'
import type { CadleApp } from '../../src/editor/cadle-app.ts'

type UpdateServer = { url: string; deploy: () => void }

const test = base.extend<{ updateServer: UpdateServer }>({
  updateServer: async ({ baseURL }, use) => {
    let version = 1
    const worker = await readFile(new URL('../../www/sw.js', import.meta.url), 'utf8')
    const server = createServer(async (request, response) => {
      try {
        if (new URL(request.url!, 'http://localhost').pathname === '/sw.js') {
          response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' })
          response.end(`${worker}\n// Test deployment ${version}\n`)
          return
        }
        const upstream = await fetch(new URL(request.url!, baseURL))
        response.writeHead(upstream.status, {
          'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
          'Cache-Control': 'no-store'
        })
        response.end(Buffer.from(await upstream.arrayBuffer()))
      } catch (error) {
        console.error('Service worker test server failed', error)
        response.writeHead(502)
        response.end('Test server request failed')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
    try {
      await use({ url: `http://127.0.0.1:${address.port}`, deploy: () => { version++ } })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }
})

test.use({ serviceWorkers: 'allow' })

const waitForController = async (page: Page) => {
  await expect(page.locator('app-shell')).toBeAttached()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

test('real SW update requests an explicit reload, keeps the notice across routes and saves before reloading', async ({ page, updateServer }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${updateServer.url}/?fixture=priority-suite#!/projects`)
  await page.locator('projects-field custom-list-item[data-name="Cadle Visual Test"]').click()
  await expect.poll(() => page.locator('cadle-app:not([read-only])').evaluate((element) =>
    (element as CadleApp).waitForPageReady('00000000-0000-4000-8000-000000000102'))).toBe(true)
  await waitForController(page)
  const notice = page.getByRole('status', { name: 'App-update', exact: true })
  await expect(notice).toHaveCount(0)
  const timeOrigin = await page.evaluate(() => performance.timeOrigin)

  updateServer.deploy()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(notice).toContainText('Update klaar: herladen nodig')
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await page.getByRole('button', { name: 'Instellingen en back-ups', exact: true }).click()
  await expect(page.locator('settings-field')).toBeVisible()
  await expect(notice).toBeVisible()
  await page.goBack()
  await expect(page.locator('cadle-app:not([read-only]) .stage')).toBeVisible()

  const shell = page.locator('app-shell')
  await shell.evaluate((element) => {
    (element as AppShell).savePage = async () => { throw new Error('Simulated storage failure') }
  })
  await notice.getByRole('button', { name: 'Opslaan en herladen', exact: true }).click()
  await expect(notice.getByRole('alert')).toContainText('De app is niet herladen')
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await shell.evaluate((element) => {
    const app = element as AppShell
    const save: AppShell['savePage'] = Object.getPrototypeOf(app).savePage
    app.savePage = async () => {
      await new Promise<void>((resolve) => window.addEventListener('test-allow-save', () => resolve(), { once: true }))
      await save.call(app)
      localStorage.setItem('test-update-save-finished', 'yes')
    }
  })
  await notice.getByRole('button', { name: 'Opslaan en herladen', exact: true }).click()
  await expect(notice.getByRole('button', { name: 'Bezig met opslaan...', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.evaluate(() => window.dispatchEvent(new Event('test-allow-save')))
  ])
  await expect(page.locator('app-shell')).toBeAttached()
  expect(await page.evaluate(() => localStorage.getItem('test-update-save-finished'))).toBe('yes')
  await waitForController(page)
  await expect(notice).toHaveCount(0)
})

test('notifies other open tabs and stacks update and Drive notices on mobile', async ({ page, context, updateServer }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${updateServer.url}/#!/projects`)
  await waitForController(page)
  const other = await context.newPage()
  await other.goto(`${updateServer.url}/#!/projects`)
  await waitForController(other)
  const otherTimeOrigin = await other.evaluate(() => performance.timeOrigin)
  updateServer.deploy()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('status', { name: 'App-update', exact: true })).toBeVisible()
  await expect(other.getByRole('status', { name: 'App-update', exact: true })).toBeVisible()
  expect(await other.evaluate(() => performance.timeOrigin)).toBe(otherTimeOrigin)
  await page.evaluate(() => window.dispatchEvent(new Event('cadle-google-drive-auth-required')))
  await expect(page.locator('.app-notice')).toHaveCount(2)
  const boxes = await page.locator('.app-notice').evaluateAll((notices) =>
    notices.map((notice) => {
      const { left, right, top, bottom } = notice.getBoundingClientRect()
      return { left, right, top, bottom }
    }))
  expect(boxes[0].bottom).toBeLessThan(boxes[1].top)
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(390)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(844)
  }
})
