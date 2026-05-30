/**
 * Bill-of-materials export.
 *
 * Walks the canvas, normalises binding IDs and roles, then writes a CSV
 * + JSON pair as user downloads.
 */

export function normalizeBindingId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toUpperCase()
}

export function inferBindingRole(object: any): 'switch' | 'load' | 'neutral' {
  const explicitRole = String(object?.bindingRole ?? '').toLowerCase()
  if (explicitRole === 'socket') return 'load'
  if (explicitRole === 'switch' || explicitRole === 'load') return explicitRole

  const haystack = `${object?.symbolPath ?? ''} ${object?.symbolName ?? ''} ${object?.type ?? ''}`.toLowerCase()
  if (haystack.includes('/switches/') || haystack.includes(' switch')) return 'switch'
  if (
    haystack.includes('/consumption appliances/') ||
    haystack.includes('/electrical devices/') ||
    haystack.includes('/socket outlets/') ||
    haystack.includes('socket outlet') ||
    haystack.includes('socket') ||
    haystack.includes('light') ||
    haystack.includes('lamp')
  ) {
    return 'load'
  }
  return 'neutral'
}

export function displayObjectType(object: any): string {
  if (typeof object?.symbolName === 'string' && object.symbolName) return object.symbolName
  if (typeof object?.situationElementType === 'string' && object.situationElementType)
    return object.situationElementType
  if (typeof object?.type === 'string' && object.type.startsWith('Cadle')) {
    return object.type.replace('Cadle', '').toLowerCase()
  }
  return String(object?.type ?? 'symbol').toLowerCase()
}

export function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export type BOMRow = { bindingId: string; componentType: string; role: string; count: number }

/**
 * Aggregates bindable items on the canvas. Returns null if nothing relevant.
 */
export function collectBOMRows(canvas: any): BOMRow[] | null {
  const rows = new Map<string, BOMRow>()
  const objects = canvas.getObjects() as any[]

  for (const object of objects) {
    const bindingId = normalizeBindingId(String(object?.bindingId ?? '')) || 'UNBOUND'
    const role = inferBindingRole(object)
    const componentType = displayObjectType(object)

    if (role === 'neutral' && bindingId === 'UNBOUND') continue

    const key = `${bindingId}::${componentType}::${role}`
    const existing = rows.get(key)
    if (existing) existing.count += 1
    else rows.set(key, { bindingId, componentType, role, count: 1 })
  }

  if (rows.size === 0) return null
  return [...rows.values()].sort((a, b) =>
    `${a.bindingId}-${a.componentType}`.localeCompare(`${b.bindingId}-${b.componentType}`, undefined, {
      numeric: true
    })
  )
}

/**
 * Generates BOM CSV + JSON for the given canvas and triggers downloads.
 * Returns false if no bindable items were found (caller should alert the user).
 */
export function generateBOMFiles(canvas: any, projectName: string): boolean {
  const entries = collectBOMRows(canvas)
  if (!entries) return false

  const createdAt = new Date().toISOString()

  const csv = [
    ['Project', projectName].join(','),
    ['Generated At', createdAt].join(','),
    '',
    ['Binding ID', 'Component Type', 'Role', 'Count'].join(','),
    ...entries.map((entry) => [entry.bindingId, entry.componentType, entry.role, String(entry.count)].join(','))
  ].join('\n')

  const json = JSON.stringify(
    {
      projectName,
      generatedAt: createdAt,
      items: entries
    },
    null,
    2
  )

  const fileStem = `${projectName.replace(/\s+/g, '-').toLowerCase()}-bom`
  downloadTextFile(`${fileStem}.csv`, csv, 'text/csv;charset=utf-8')
  downloadTextFile(`${fileStem}.json`, json, 'application/json;charset=utf-8')
  return true
}
