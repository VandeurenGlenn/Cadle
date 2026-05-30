/**
 * Voltage drop calculation per AREI / NF C 15-100 / IEC 60364.
 *
 * Formula (single-phase, copper):  ΔU = 2 · ρ · L · I / S
 * Three-phase:                     ΔU = √3 · ρ · L · I / S
 *
 *   ρ = resistivity of copper at 70 °C ≈ 0.022 Ω·mm²/m  (warm cable)
 *   L = one-way cable length in meters
 *   I = load current in amperes
 *   S = conductor cross-section in mm²
 *
 * AREI / IEC limits (recommended max ΔU% from origin to point of utilisation):
 *   Lighting circuits         : 3 %
 *   Other use (sockets, etc.) : 5 %
 *
 * This helper is intentionally framework-free and side-effect-free so it
 * can be unit-tested and called from any UI layer.
 */

export type CircuitType = 'lighting' | 'other'
export type PhaseSystem = 'mono' | 'tri'

const COPPER_RESISTIVITY_OHM_MM2_PER_M = 0.022

export interface VoltageDropInput {
  /** Cable length in meters (one-way from board to load). */
  lengthMeters: number
  /** Load current in amperes (use breaker rating as worst case). */
  currentAmperes: number
  /** Conductor cross-section in mm². */
  sectionMm2: number
  /** Nominal phase-to-neutral voltage (default 230 V). */
  voltage?: number
  /** mono = single-phase, tri = three-phase. */
  phase?: PhaseSystem
}

export interface VoltageDropResult {
  /** Absolute voltage drop in volts. */
  dropVolts: number
  /** Voltage drop as percentage of nominal voltage. */
  dropPercent: number
  /** Limit applied (3 % or 5 %). */
  limitPercent: number
  /** Status compared to limit. */
  status: 'ok' | 'warn' | 'error'
  /** Human-readable hint for UI. */
  hint: string
}

export const VOLTAGE_DROP_LIMITS: Readonly<Record<CircuitType, number>> = {
  lighting: 3,
  other: 5
}

export function voltageDrop(input: VoltageDropInput, circuitType: CircuitType = 'other'): VoltageDropResult {
  const { lengthMeters, currentAmperes, sectionMm2 } = input
  const voltage = input.voltage ?? 230
  const phase = input.phase ?? 'mono'

  if (sectionMm2 <= 0 || lengthMeters < 0 || currentAmperes < 0) {
    return {
      dropVolts: 0,
      dropPercent: 0,
      limitPercent: VOLTAGE_DROP_LIMITS[circuitType],
      status: 'error',
      hint: 'Invalid input: section, length and current must be positive.'
    }
  }

  const factor = phase === 'tri' ? Math.sqrt(3) : 2
  const dropVolts = (factor * COPPER_RESISTIVITY_OHM_MM2_PER_M * lengthMeters * currentAmperes) / sectionMm2
  const dropPercent = (dropVolts / voltage) * 100
  const limitPercent = VOLTAGE_DROP_LIMITS[circuitType]

  // Warn at 80 % of limit, error above limit.
  let status: VoltageDropResult['status']
  if (dropPercent > limitPercent) status = 'error'
  else if (dropPercent > limitPercent * 0.8) status = 'warn'
  else status = 'ok'

  const hint =
    status === 'error'
      ? `ΔU ${dropPercent.toFixed(1)} % exceeds the ${limitPercent} % AREI limit — increase section or shorten cable.`
      : status === 'warn'
        ? `ΔU ${dropPercent.toFixed(1)} % is close to the ${limitPercent} % AREI limit.`
        : `ΔU ${dropPercent.toFixed(1)} % — within the ${limitPercent} % AREI limit.`
  return { dropVolts, dropPercent, limitPercent, status, hint }
}

/**
 * Infer circuit type from binding-group members. Lighting if all members
 * are lighting/switches; otherwise treat as "other" (5 % limit).
 */
export function inferCircuitType(
  members: Array<{ symbolPath?: string; symbolName?: string; role?: string }>
): CircuitType {
  if (!members || members.length === 0) return 'other'
  const haystack = members.map((m) => `${m.symbolPath ?? ''} ${m.symbolName ?? ''}`.toLowerCase()).join(' ')
  const hasNonLighting =
    haystack.includes('socket') ||
    haystack.includes('/consumption appliances/') ||
    haystack.includes('/electrical devices/') ||
    haystack.includes('cooker') ||
    haystack.includes('oven') ||
    haystack.includes('boiler') ||
    haystack.includes('dryer')
  return hasNonLighting ? 'other' : 'lighting'
}
