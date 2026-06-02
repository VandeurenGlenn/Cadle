/**
 * Wire-section → breaker amperage mapping (single source of truth).
 *
 * Aligned with AREI common practice (see RESEARCH_ELECTRICAL_CAD.md):
 *   1.5 mm² → 16 A   (lighting)
 *   2.5 mm² → 20 A   (sockets, general purpose)
 *   4   mm² → 25 A   (dedicated appliance / heavy socket)
 *   6   mm² → 32 A   (cooker, dryer)
 *   10  mm² → 40 A   (sub-distribution / heat pump)
 *   16  mm² → 63 A   (incoming feeder)
 *
 * All callers MUST go through {@link wireSectionToBreakerAmperage} — do
 * not hard-code the table elsewhere. Adding a new wire size here is the
 * only supported way to extend it.
 */
export const WIRE_SECTION_BREAKER_TABLE: ReadonlyArray<{
  section: string
  sectionMm2: number
  breakerAmperage: number
}> = [
  { section: '1.5 mm²', sectionMm2: 1.5, breakerAmperage: 16 },
  { section: '2.5 mm²', sectionMm2: 2.5, breakerAmperage: 20 },
  { section: '4 mm²', sectionMm2: 4, breakerAmperage: 25 },
  { section: '6 mm²', sectionMm2: 6, breakerAmperage: 32 },
  { section: '10 mm²', sectionMm2: 10, breakerAmperage: 40 },
  { section: '16 mm²', sectionMm2: 16, breakerAmperage: 63 }
]

export type WireSection = (typeof WIRE_SECTION_BREAKER_TABLE)[number]['section']

const SECTION_LOOKUP = new Map<string, (typeof WIRE_SECTION_BREAKER_TABLE)[number]>(
  WIRE_SECTION_BREAKER_TABLE.flatMap((row) => [
    [row.section, row],
    [row.section.replace(/\s+/g, ''), row],
    [String(row.sectionMm2), row]
  ])
)

/**
 * Normalize an arbitrary user-entered wire-section string to a canonical
 * entry from the table. Returns the closest known entry, or the default
 * 2.5 mm² entry as a safe fallback.
 */
export function normalizeWireSection(value): (typeof WIRE_SECTION_BREAKER_TABLE)[number] {
  if (value == null) return WIRE_SECTION_BREAKER_TABLE[1]
  const key = String(value).trim().toLowerCase().replace(/\s+/g, '')
  // Try a few canonical forms.
  for (const candidate of [key, key.replace('mm²', ''), key.replace('mm2', '')]) {
    const hit = SECTION_LOOKUP.get(candidate)
    if (hit) return hit
  }

  // Numeric parse fallback.
  const num = parseFloat(key)
  if (!Number.isNaN(num)) {
    const hit = WIRE_SECTION_BREAKER_TABLE.find((row) => row.sectionMm2 === num)
    if (hit) return hit
  }
  return WIRE_SECTION_BREAKER_TABLE[1] // default 2.5 mm²
}

/**
 * Single source of truth for wire-section → breaker amperage.
 * Always go through this helper; never hard-code the mapping elsewhere.
 */
export function wireSectionToBreakerAmperage(section): number {
  return normalizeWireSection(section).breakerAmperage
}

/**
 * Default wire section by inferred member role. Sockets and generic
 * loads default to 2.5 mm² (20 A); lighting circuits default to
 * 1.5 mm² (16 A); switches default to 1.5 mm² because they typically
 * sit on lighting circuits.
 */
export function defaultWireSectionForRole(role: string | undefined | null): WireSection {
  const r = String(role ?? '').toLowerCase()
  if (r === 'switch') return '1.5 mm²'
  return '2.5 mm²'
}

/**
 * Compute the default wire section for a binding GROUP by looking at
 * its member symbols. Pure function over a description list so it can
 * be reused by both the catalog summary and the one-line builder.
 */
export function defaultWireSectionForGroupMembers(
  members: Array<{ role?: string; symbolPath?: string; symbolName?: string }>
): WireSection {
  if (!members || members.length === 0) return '2.5 mm²'

  const haystack = members.map((m) => `${m.symbolPath ?? ''} ${m.symbolName ?? ''}`.toLowerCase()).join(' ')

  // Heavy appliance hints → bump to 4 mm².
  if (
    haystack.includes('cooker') ||
    haystack.includes('oven') ||
    haystack.includes('dryer') ||
    haystack.includes('boiler') ||
    haystack.includes('heat pump')
  ) {
    return '4 mm²'
  }

  // Pure lighting circuit (no sockets, no consumption appliances) → 1.5 mm².
  const hasSocketOrAppliance = members.some((m) => {
    const s = `${m.symbolPath ?? ''} ${m.symbolName ?? ''}`.toLowerCase()
    return (
      s.includes('/socket outlets/') ||
      s.includes('socket') ||
      s.includes('/consumption appliances/') ||
      s.includes('/electrical devices/')
    )
  })
  if (!hasSocketOrAppliance) return '1.5 mm²'
  return '2.5 mm²'
}
