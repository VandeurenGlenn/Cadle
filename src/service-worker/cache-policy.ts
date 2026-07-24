export const isCacheableSvgRequest = (request: Request, origin: string): boolean => {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  return url.origin === origin && url.pathname.toLowerCase().endsWith('.svg')
}
