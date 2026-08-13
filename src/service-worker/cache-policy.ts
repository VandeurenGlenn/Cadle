export const isCacheableSvgRequest = (request: Request, origin: string): boolean => {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  return url.origin === origin && url.pathname.toLowerCase().endsWith('.svg')
}

export const isCacheableCadleAssetRequest = (request: Request, origin: string): boolean => {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin !== origin) return false
  if (url.pathname.toLowerCase().endsWith('.svg')) return true
  return url.pathname.startsWith('/ocr/') && /\.(?:js|wasm|gz)$/i.test(url.pathname)
}
