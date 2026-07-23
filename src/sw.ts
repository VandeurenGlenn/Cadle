const CACHE_NAME = 'cadle-symbol-assets-v1'

type ExtendableEventLike = Event & {
  waitUntil(promise: Promise<unknown>): void
}

type FetchEventLike = ExtendableEventLike & {
  request: Request
  respondWith(response: Promise<Response> | Response): void
}

const serviceWorkerGlobal = globalThis as typeof globalThis & {
  skipWaiting?: () => void | Promise<void>
  clients?: {
    claim: () => Promise<void>
  }
}

const isSameOriginRequest = (request: Request): boolean => new URL(request.url).origin === location.origin

const isSymbolsManifest = (request: Request): boolean => {
  const path = new URL(request.url).pathname
  return /\/(?:www\/)?symbols\/manifest\.js$/i.test(path)
}

const isSymbolSvg = (request: Request): boolean => {
  const path = new URL(request.url).pathname
  return /\/(?:www\/)?symbols\/.+\.svg$/i.test(path)
}

const shouldCacheRequest = (request: Request): boolean => isSymbolsManifest(request) || isSymbolSvg(request)

const cacheResponse = async (request: Request, response: Response): Promise<Response> => {
  if (!response.ok) return response

  const cache = await caches.open(CACHE_NAME)
  await cache.put(request, response.clone())
  return response
}

const cacheFirst = async (request: Request): Promise<Response> => {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  return cacheResponse(request, response)
}

serviceWorkerGlobal.addEventListener('install', (event) => {
  const installEvent = event as ExtendableEventLike
  installEvent.waitUntil(Promise.resolve(serviceWorkerGlobal.skipWaiting?.()))
})

serviceWorkerGlobal.addEventListener('activate', (event) => {
  const activateEvent = event as ExtendableEventLike
  activateEvent.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => serviceWorkerGlobal.clients?.claim())
  )
})

serviceWorkerGlobal.addEventListener('fetch', (event) => {
  const fetchEvent = event as FetchEventLike
  const request = fetchEvent.request

  if (request.method !== 'GET' || !isSameOriginRequest(request) || !shouldCacheRequest(request)) return

  fetchEvent.respondWith(cacheFirst(request))
})
