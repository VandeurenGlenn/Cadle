import { isCacheableCadleAssetRequest } from './service-worker/cache-policy.js'

const CACHE_NAME = 'cadle-local-assets-v4'

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

const cacheResponse = async (request: Request, response: Response): Promise<Response> => {
  if (!response.ok) return response

  const cache = await caches.open(CACHE_NAME)
  await cache.put(request, response.clone())
  return response
}

const networkFirst = async (request: Request): Promise<Response> => {
  const cache = await caches.open(CACHE_NAME)
  try {
    // Always revalidate local symbols and OCR runtime files so deployments are visible
    // immediately. The Cache API remains an offline fallback only.
    const response = await fetch(request, { cache: 'no-cache' })
    return cacheResponse(request, response)
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    throw new Error(`Cadle asset unavailable from network and cache: ${request.url}`)
  }
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

  if (!isCacheableCadleAssetRequest(request, location.origin)) return

  fetchEvent.respondWith(networkFirst(request))
})
