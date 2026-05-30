/**
 * Selectivity hint between an upstream protection (RCD / breaker) and a
 * downstream protection. Implements a simplified amperage-ratio rule
 * commonly used in residential AREI / IEC installations:
 *
 *   - Total selectivity is generally accepted when
 *       upstream rating ≥ 1.6 × downstream rating
 *     (curve-overlap considerations apart).
 *   - Partial selectivity is acceptable from 1.25× upward.
 *   - Below 1.25× the breakers may trip together → warn.
 *
 * For RCDs (residual current devices) the residual current setting (IΔn)
 * follows the same logic: upstream ≥ 3 × downstream IΔn for total
 * selectivity (e.g. 300 mA upstream / 30 mA downstream).
 *
 * This helper is pure, framework-free, and unit-testable.
 */

export type SelectivityStatus = 'total' | 'partial' | 'risk' | 'unknown'

export interface SelectivityResult {
  status: SelectivityStatus
  ratio: number
  hint: string
}

export function selectivityBetween(upstreamA: number, downstreamA: number): SelectivityResult {
  if (!isFinite(upstreamA) || !isFinite(downstreamA) || upstreamA <= 0 || downstreamA <= 0) {
    return { status: 'unknown', ratio: 0, hint: 'Selectivity unknown — provide both upstream and downstream ratings.' }
  }

  const ratio = upstreamA / downstreamA

  if (ratio >= 1.6) {
    return {
      status: 'total',
      ratio,
      hint: `Total selectivity (${upstreamA} A / ${downstreamA} A = ${ratio.toFixed(2)}×). Only the downstream protection trips on a fault.`
    }
  }

  if (ratio >= 1.25) {
    return {
      status: 'partial',
      ratio,
      hint: `Partial selectivity (${ratio.toFixed(2)}×). Acceptable for short-circuit clearing but overload may trip both.`
    }
  }
  return {
    status: 'risk',
    ratio,
    hint: `Risk of cascade tripping (${ratio.toFixed(2)}×). Upstream should be at least 1.25× downstream — preferably 1.6×.`
  }
}

/**
 * Selectivity for RCDs based on residual current sensitivity (IΔn).
 * Inputs in milliamperes (typical: 300 mA upstream, 30 mA downstream).
 */
export function rcdSelectivity(upstreamMA: number, downstreamMA: number): SelectivityResult {
  if (!isFinite(upstreamMA) || !isFinite(downstreamMA) || upstreamMA <= 0 || downstreamMA <= 0) {
    return { status: 'unknown', ratio: 0, hint: 'RCD selectivity unknown — provide both IΔn values in mA.' }
  }

  const ratio = upstreamMA / downstreamMA
  if (ratio >= 3) {
    return {
      status: 'total',
      ratio,
      hint: `Total RCD selectivity (${upstreamMA} mA / ${downstreamMA} mA = ${ratio.toFixed(1)}×). Upstream RCD must be selective (S type).`
    }
  }

  if (ratio >= 2) {
    return {
      status: 'partial',
      ratio,
      hint: `Partial RCD selectivity (${ratio.toFixed(1)}×). Both RCDs may trip on a residual fault.`
    }
  }
  return {
    status: 'risk',
    ratio,
    hint: `RCD cascade risk (${ratio.toFixed(1)}×). Upstream IΔn should be ≥ 3× downstream and of selective (S) type.`
  }
}
