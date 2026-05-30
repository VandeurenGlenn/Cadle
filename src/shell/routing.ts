/**
 * Pure helpers for parsing the location hash into a route + query params.
 *
 * Supports both `#!/route?key=value` (banged) and `#route?key=value` forms.
 */

export type ParsedHash = {
  route: string
  params?: Record<string, string>
}

function debang(possibleBangedHash: string): string {
  const parts = possibleBangedHash.split('#!/')
  if (parts.length > 1) return parts[1]
  return possibleBangedHash
}

function dehash(possibleHash: string): string {
  const parts = possibleHash.split('#')
  if (parts.length > 1) return parts[1]
  return possibleHash
}

function dequery(routeWithPossibleQuery: string): { route: string; query?: string } {
  const parts = routeWithPossibleQuery.split('?')
  if (parts.length > 1) return { route: parts[0], query: parts[1] }
  return { route: routeWithPossibleQuery }
}

function paramify(query: string): Record<string, string> {
  const parts = query.split('&')
  const params: Record<string, string> = {}
  for (const part of parts) {
    const [key, value] = part.split('=')
    params[key] = value
  }
  return params
}

export function parseHash(hash: string): ParsedHash {
  let routeWithPossibleQuery: string = hash
  if (hash.includes('#!/')) routeWithPossibleQuery = debang(hash)
  if (routeWithPossibleQuery === hash && hash.includes('#')) routeWithPossibleQuery = dehash(hash)

  const { route, query } = dequery(routeWithPossibleQuery)
  if (query) {
    const params = paramify(query)
    return { route, params }
  }
  return { route }
}
