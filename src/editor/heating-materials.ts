import type { HeatingScheduleRow } from './heating-plan.js'
export const heatingMaterials = (rows: readonly HeatingScheduleRow[], wallPassages?: number) => {
  const groups = new Map<number, { diameterMm: number; circuits: number; loopM: number; leadsM: number; reserveM: number; orderM: number; connections: number }>()
  for (const row of rows) {
    const item = groups.get(row.diameterMm) ?? { diameterMm: row.diameterMm, circuits: 0, loopM: 0, leadsM: 0, reserveM: 0, orderM: 0, connections: 0 }
    item.circuits++; item.connections += 2; item.loopM += row.loopM; item.leadsM += row.supplyM + row.returnM
    item.reserveM += row.allowanceM ?? 0; item.orderM += row.cutM ?? row.totalM + (row.allowanceM ?? 0); groups.set(row.diameterMm, item)
  }
  return { pipes: [...groups.values()].sort((a, b) => a.diameterMm - b.diameterMm), wallPassages,
    circuits: rows.length, connections: rows.length * 2 }
}
export const heatingMaterialsCSV = (rows: readonly HeatingScheduleRow[], wallPassages?: number) => {
  const materials = heatingMaterials(rows, wallPassages), n = (v: number) => v.toFixed(2).replace('.', ',')
  return '\uFEFF' + [['Buisdiameter (mm)', 'Kringen', 'Verwarmingslus (m)', 'Aanvoer + retour (m)', 'Reserve (m)', 'Benodigd incl. reserve (m)', 'Verdeleraansluitingen'],
    ...materials.pipes.map((p) => [p.diameterMm, p.circuits, n(p.loopM), n(p.leadsM), n(p.reserveM), n(p.orderM), p.connections]),
    [], ['Leidingpassages door muren (zonder deuren)', wallPassages ?? 'Herberekenen / nog niet bepaald'], ['Opmerking', 'Telt afzonderlijke buispassages; geen aantal gedeelde boorgaten. Rollen en hulpstukken volgens het gekozen product.']].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n')
}
