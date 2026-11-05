import { heatingOutputBasis, sanitizeHeatingDesign, type HeatingDesignInputs } from './heating-design.js'

// Measured pure-water data, linearly interpolated within 10–80°C. No glycol model.
// https://wiki.anton-paar.com/us-en/water/ (IAPWS 2008 reference)
const WATER = [[10, 999.7, 1.3059], [20, 998.2, 1.0016], [30, 995.6, .7972], [35, 994, .7191],
  [40, 992.2, .6527], [50, 988, .5465], [60, 983.2, .466], [70, 977.8, .4035], [80, 971.8, .354]]
export const heatingWater = (temperatureC: number) => {
  if (!Number.isFinite(temperatureC) || temperatureC < 10 || temperatureC > 80) return undefined
  const i = Math.max(1, WATER.findIndex((row) => row[0] >= temperatureC)), a = WATER[i - 1], b = WATER[i]
  const t = (temperatureC - a[0]) / (b[0] - a[0])
  return { densityKgM3: a[1] + t * (b[1] - a[1]), viscosityPas: (a[2] + t * (b[2] - a[2])) / 1000 }
}

export type HeatingHydraulics = { innerDiameterMm: number; velocityMs: number; reynolds: number; frictionFactor: number;
  pipeKpa: number; localKpa: number; manifoldKpa?: number; totalKpa: number; complete: boolean; transition: boolean;
  balanceKpa?: number; /** Equivalent Kv of the additional restriction, not an existing valve setting. */ targetKv?: number; pumpMarginKpa?: number }

/** Darcy–Weisbach, laminar 64/Re; turbulent Colebrook–White (Darcy, not Fanning).
 * In transition use the upper envelope and flag the result, rather than implying precise turbulent flow.
 * https://handbook.ashrae.org/Handbooks/F25/IP/F25_Ch22/F25_Ch22_ip.aspx
 */
export const heatingHydraulics = (outerMm: number, lengthM: number, flowLmin: number, design?: HeatingDesignInputs): HeatingHydraulics | undefined => {
  design = sanitizeHeatingDesign(design)
  if (design?.pipeWallMm === undefined) return
  const innerDiameterMm = outerMm - 2 * design.pipeWallMm
  const temperature = design.fluidTemperatureC ?? ((design.supplyTemperatureC ?? 35) - (design.deltaTK ?? 5) / 2)
  const water = heatingWater(temperature)
  if (!(innerDiameterMm > 0) || !water || !Number.isFinite(lengthM) || lengthM < 0 || !Number.isFinite(flowLmin) || flowLmin < 0) return
  const d = innerDiameterMm / 1000, q = flowLmin / 60000, velocityMs = q / (Math.PI * d * d / 4)
  const reynolds = water.densityKgM3 * velocityMs * d / water.viscosityPas, roughness = (design.roughnessMm ?? .007) / 1000
  let turbulent = .04
  if (reynolds >= 2300) for (let n = 0; n < 20; n++) turbulent = 1 / (-2 * Math.log10(roughness / (3.7 * d) + 2.51 / (reynolds * Math.sqrt(turbulent)))) ** 2
  const transition = reynolds >= 2300 && reynolds < 4000
  const frictionFactor = !reynolds ? 0 : reynolds < 2300 ? 64 / reynolds : transition ? Math.max(64 / reynolds, turbulent) : turbulent
  const dynamicKpa = water.densityKgM3 * velocityMs ** 2 / 2000
  const pipeKpa = frictionFactor * lengthM / d * dynamicKpa, localKpa = (design.localLossK ?? 0) * dynamicKpa
  // Kv uses m³/h and bar; density correction referenced to 1000 kg/m³ water.
  const manifoldKpa = design.manifoldKv === undefined ? undefined : (flowLmin * .06 / design.manifoldKv) ** 2 * 100 * water.densityKgM3 / 1000
  return { innerDiameterMm, velocityMs, reynolds, frictionFactor, pipeKpa, localKpa, manifoldKpa,
    totalKpa: pipeKpa + localKpa + (manifoldKpa ?? 0), transition,
    complete: design.localLossK !== undefined && design.manifoldKv !== undefined && design.roughnessMm !== undefined }
}

export type HeatingFloor = { coveringR?: number; screedR?: number; insulationR?: number; demandWm2?: number; requiredSurfaceC?: number;
  minimumPlaneC?: number; upperBoundWm2?: number; systemOutputWm2?: number; outputStale: boolean; downwardUpperWm2?: number;
  supplyC: number; returnC: number; roomC: number; surfaceLimitC: number }

/** Layer resistance is thickness/lambda. Surface characteristic: q=8.92*(Ts-Tr)^1.1.
 * https://www.uponor.com/de-de/unternehmen/presse/fachbeitraege/fa-uponor-klett-auslegung
 * The plane model omits pipe/spreading resistances: its output is an optimistic upper bound,
 * never a substitute for the manufacturer's EN 1264 system output at the actual pitch.
 */
export const heatingFloor = (areaM2: number, powerW: number | undefined, diameterMm: number, spacingMm: number, design?: HeatingDesignInputs): HeatingFloor => {
  design = sanitizeHeatingDesign(design)
  const resistance = (mm?: number, lambda?: number) => mm !== undefined && lambda !== undefined && lambda > 0 ? mm / 1000 / lambda : undefined
  const coveringR = resistance(design?.coveringThicknessMm, design?.coveringLambda), screedR = resistance(design?.screedCoverMm, design?.screedLambda),
    insulationR = resistance(design?.insulationThicknessMm, design?.insulationLambda)
  const supplyC = design?.supplyTemperatureC ?? 35, returnC = supplyC - (design?.deltaTK ?? 5), roomC = design?.roomTemperatureC ?? 20, surfaceLimitC = design?.surfaceLimitC ?? 29
  const demandWm2 = powerW === undefined || !(areaM2 > 0) ? undefined : powerW / areaM2
  const requiredSurfaceC = demandWm2 === undefined ? undefined : roomC + (demandWm2 / 8.92) ** (1 / 1.1)
  const r = coveringR !== undefined && screedR !== undefined ? coveringR + screedR : undefined
  const minimumPlaneC = requiredSurfaceC === undefined || r === undefined ? undefined : requiredSurfaceC + demandWm2! * r
  let upperBoundWm2: number | undefined
  if (r !== undefined && returnC > roomC && supplyC > returnC) {
    const drivingK = (supplyC - returnC) / Math.log((supplyC - roomC) / (returnC - roomC))
    let lo = 0, hi = 8.92 * Math.max(0, surfaceLimitC - roomC) ** 1.1
    for (let i = 0; i < 50; i++) { const q = (lo + hi) / 2; if ((q / 8.92) ** (1 / 1.1) + q * r > drivingK) hi = q; else lo = q }
    upperBoundWm2 = lo
  }
  const outputStale = design?.systemOutputWm2 !== undefined && (!design.systemReference || design.systemOutputBasis !== heatingOutputBasis(diameterMm, spacingMm, design))
  const downwardUpperWm2 = insulationR !== undefined && insulationR > 0 && design?.belowTemperatureC !== undefined
    ? Math.max(0, ((supplyC + returnC) / 2 - design.belowTemperatureC) / insulationR) : undefined
  return { coveringR, screedR, insulationR, demandWm2, requiredSurfaceC, minimumPlaneC, upperBoundWm2, outputStale,
    systemOutputWm2: outputStale ? undefined : design?.systemOutputWm2, downwardUpperWm2, supplyC, returnC, roomC, surfaceLimitC }
}


export const sanitizeHeatingHydraulics = (raw: unknown): HeatingHydraulics | undefined => {
  if (!raw || typeof raw !== 'object') return
  const value = raw as Record<string, unknown>, required = ['innerDiameterMm', 'velocityMs', 'reynolds', 'frictionFactor', 'pipeKpa', 'localKpa', 'totalKpa']
  if (!required.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) >= 0)) return
  const keys = [...required, 'manifoldKpa', 'balanceKpa', 'targetKv', 'pumpMarginKpa']
  return { ...Object.fromEntries(keys.filter((key) => typeof value[key] === 'number' && Number.isFinite(value[key])).map((key) => [key, value[key]])),
    complete: value.complete === true, transition: value.transition === true } as HeatingHydraulics
}
export const sanitizeHeatingFloor = (raw: unknown): HeatingFloor | undefined => {
  if (!raw || typeof raw !== 'object') return
  const value = raw as Record<string, unknown>, required = ['supplyC', 'returnC', 'roomC', 'surfaceLimitC']
  if (!required.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))) return
  const keys = [...required, 'coveringR', 'screedR', 'insulationR', 'demandWm2', 'requiredSurfaceC', 'minimumPlaneC', 'upperBoundWm2', 'systemOutputWm2', 'downwardUpperWm2']
  return { ...Object.fromEntries(keys.filter((key) => typeof value[key] === 'number' && Number.isFinite(value[key])).map((key) => [key, value[key]])), outputStale: value.outputStale === true } as HeatingFloor
}
