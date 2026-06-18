import { app, BrowserWindow } from 'electron'
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const WWW_ROOT = resolve('www')

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8'
}

const safePath = (urlPath) => {
  const withoutQuery = urlPath.split('?')[0].split('#')[0]
  const decoded = decodeURIComponent(withoutQuery)
  const normalized = normalize(decoded).replace(/^\/+/, '')
  const candidate = resolve(join(WWW_ROOT, normalized || 'index.html'))
  if (!candidate.startsWith(WWW_ROOT)) return null
  return candidate
}

const notFound = (res) => {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Not Found')
}

const createStaticServer = () => {
  const server = http.createServer((req, res) => {
    if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Method Not Allowed')
      return
    }

    const resolved = safePath(req.url)
    if (!resolved || !existsSync(resolved)) {
      notFound(res)
      return
    }

    let filePath = resolved
    if (statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html')
      if (!existsSync(filePath)) {
        notFound(res)
        return
      }
    }

    const stats = statSync(filePath)
    const contentType = MIME[extname(filePath)] || 'application/octet-stream'
    res.writeHead(200, {
      'cache-control': 'no-cache',
      'content-length': String(stats.size),
      'content-type': contentType
    })

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    createReadStream(filePath).pipe(res)
  })

  return server
}

const createWindow = (url) => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.loadURL(url)
}

let server

app.whenReady().then(async () => {
  if (!existsSync(WWW_ROOT) || !existsSync(join(WWW_ROOT, 'index.html'))) {
    console.error('[cadle/electron] Missing www build output. Run "npm run build" first.')
    app.quit()
    return
  }

  server = createStaticServer()

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    console.error('[cadle/electron] Failed to determine local server address.')
    app.quit()
    return
  }

  createWindow(`http://127.0.0.1:${address.port}`)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(`http://127.0.0.1:${address.port}`)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (server) {
    server.close()
    server = undefined
  }
})
