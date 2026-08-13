import type { OneWireTopologyPlan } from '../types.js'

export type OneWireCapacityAssessment = {
  status: 'limited' | 'overload' | 'ok' | 'unknown'
  sourceCurrentA?: number
  downstreamLimitA?: number
  lowestDifferentialRatingA?: number
  upgradeCandidateA?: number
  message: string
  detail: string
}

const STANDARD_RATINGS_A = [25, 40, 63, 80, 100, 125]

const nextStandardRating = (requiredA: number): number | undefined =>
  STANDARD_RATINGS_A.find((rating) => rating >= requiredA)

export const assessOneWireCapacity = (
  plan: OneWireTopologyPlan,
  options: { gridProtectionCurrentA?: number } = {}
): OneWireCapacityAssessment => {
  const gridProtectionCurrentA = options.gridProtectionCurrentA ?? plan.gridProtectionCurrentA
  const solarProtectionCurrentA = plan.solar ? (plan.solarBreakerRatedCurrentA ?? 20) : 0
  const sourceCurrentA = gridProtectionCurrentA && gridProtectionCurrentA > 0
    ? gridProtectionCurrentA + solarProtectionCurrentA
    : undefined
  const residualLimitA = plan.residualBreaker ? (plan.residualBreakerRatedCurrentA ?? 40) : undefined
  const differentialRatings = (plan.additionalDifferentials ?? [])
    .flatMap((item) => Array.from(
      { length: item.count },
      () => item.ratedCurrentA ?? plan.mainDifferential?.ratedCurrentA
    ))
    .filter((rating): rating is number => typeof rating === 'number' && rating > 0)
  const lowestDifferentialRatingA = differentialRatings.length
    ? Math.min(...differentialRatings)
    : undefined

  if (residualLimitA) {
    const overloaded = lowestDifferentialRatingA !== undefined && lowestDifferentialRatingA < residualLimitA
    return {
      status: overloaded ? 'overload' : 'limited',
      ...(sourceCurrentA ? { sourceCurrentA } : {}),
      downstreamLimitA: residualLimitA,
      ...(lowestDifferentialRatingA ? { lowestDifferentialRatingA } : {}),
      ...(overloaded ? { upgradeCandidateA: nextStandardRating(residualLimitA) } : {}),
      message: overloaded
        ? `REM ${residualLimitA} A · DIFF ${lowestDifferentialRatingA} A TE LAAG`
        : `BEGRENZDE RAIL · REMAUTOMAAT C${residualLimitA}A`,
      detail: overloaded
        ? `Plaats diff ≥ ${residualLimitA} A of verlaag de begrenzing`
        : `Correct indien dit de enige voeding van de rail is`
    }
  }

  if (sourceCurrentA === undefined) {
    return {
      status: 'unknown',
      ...(lowestDifferentialRatingA ? { lowestDifferentialRatingA } : {}),
      message: 'KASTSTROOM ONBEKEND · HOOFDZEKERING INVULLEN',
      detail: `PV-beveiliging ${solarProtectionCurrentA} A · geen remautomaat`
    }
  }

  const overloaded = lowestDifferentialRatingA !== undefined && lowestDifferentialRatingA < sourceCurrentA
  const upgradeCandidateA = overloaded ? nextStandardRating(sourceCurrentA) : undefined
  return {
    status: overloaded ? 'overload' : 'ok',
    sourceCurrentA,
    downstreamLimitA: sourceCurrentA,
    ...(lowestDifferentialRatingA ? { lowestDifferentialRatingA } : {}),
    ...(upgradeCandidateA ? { upgradeCandidateA } : {}),
    message: overloaded
      ? `MAX ${sourceCurrentA} A · DIFF ${lowestDifferentialRatingA} A TE LAAG`
      : `MAX KASTSTROOM ${sourceCurrentA} A · GEEN REMAUTOMAAT`,
    detail: overloaded
      ? upgradeCandidateA
        ? `Rem ${Math.min(40, lowestDifferentialRatingA ?? 40)} A of kandidaat diff ${upgradeCandidateA} A na materiaalcontrole`
        : 'Plaats een passende begrenzing; geen standaard diff-kandidaat bepaald'
      : 'Controleer ook rail, bedrading, klemmen en kastgegevens'
  }
}
