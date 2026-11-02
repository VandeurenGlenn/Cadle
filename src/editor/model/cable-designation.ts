export const sanitizeCableFireClass = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 80) : undefined

export const withCableFireClass = (text: string, fireClass?: string): string => {
  const value = sanitizeCableFireClass(fireClass)
  return !value || text.toLowerCase().endsWith(value.toLowerCase()) ? text : `${text} ${value}`.trim()
}

export const cableTypeLabel = (cable: { cableType?: string; fireClass?: string }): string => {
  const fireClass = sanitizeCableFireClass(cable.fireClass)
  const type = cable.cableType === 'none' ? '' : (cable.cableType?.trim() ?? '')
  // Older files encode Cca in the cable type. A detailed class replaces it.
  const base = (fireClass ? type.replace(/-Cca$/i, '') : type).replace('-', ' ')
  return withCableFireClass(base, fireClass)
}

export const cableLabelText = (cable: {
  conductors?: number; sectionMm2?: number; hasProtectiveConductor?: boolean; cableType?: string; fireClass?: string
}, conductorMarker?: 'x'): string => {
  const marker = conductorMarker ?? ((cable.hasProtectiveConductor ?? cable.conductors !== 4) ? 'G' : 'X')
  const type = cableTypeLabel(cable)
  return `${cable.conductors ?? 3}${marker}${cable.sectionMm2 ?? 1.5} mm²${type ? ` ${type}` : ''}`
}
