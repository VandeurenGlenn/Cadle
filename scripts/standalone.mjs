import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve('www')
const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number.parseInt(process.env.PORT || '4333', 10)

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
  const candidate = resolve(join(ROOT, normalized || 'index.html'))
  if (!candidate.startsWith(ROOT)) return null
  return candidate
}

const replyNotFound = (res) => {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Not Found')
}

const server = http.createServer((req, res) => {
  if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Method Not Allowed')
    return
  }

  const resolved = safePath(req.url)
  if (!resolved) {
    replyNotFound(res)
    return
  }

  let filePath = resolved
  if (!existsSync(filePath)) {
    replyNotFound(res)
    return
  }

  const stats = statSync(filePath)
  if (stats.isDirectory()) {
    filePath = join(filePath, 'index.html')
    if (!existsSync(filePath)) {
      replyNotFound(res)
      return
    }
  }

  const contentType = MIME[extname(filePath)] || 'application/octet-stream'
  res.writeHead(200, {
    'cache-control': 'no-cache',
    'content-length': String(statSync(filePath).size),
    'content-type': contentType
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(filePath).pipe(res)
})

server.listen(PORT, HOST, () => {
  console.log('[cadle] standalone server running')
  console.log(`[cadle] local: http://${HOST}:${PORT}`)
  console.log('[cadle] stop with Ctrl+C')
})
