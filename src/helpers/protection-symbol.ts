import type { FabricObject } from 'fabric'

export type ProtectionSymbolKind = 'none' | 'breaker' | 'residual-current-breaker'

type ProtectionCandidate = FabricObject & {
  symbolName?: string
  symbolPath?: string
  name?: string
  label?: string
  bindingName?: string
  type?: string
  text?: string
  breakerAmperageA?: number
  breakerShortCircuitKA?: number
  breakerCurve?: string
  breakerPoles?: number
  bindingGroupBreakerAmperage?: number
  rcdResidualCurrentMa?: number
  rcdType?: string
  _objects?: FabricObject[]
  objects?: FabricObject[]
}

const BREAKER_MATCHERS = ['circuit breaker', 'automaat', 'disjoncteur'] as const
const RESIDUAL_MATCHERS = [
  'residual-current circuit breaker',
  'residual current circuit breaker',
  'differentieel',
  'differential',
  'aardlek',
  'rcd',
  'rccb'
] as const

function toHaystack(object: FabricObject): string {
  const candidate = object as ProtectionCandidate
  return `${candidate.symbolName ?? ''} ${candidate.symbolPath ?? ''} ${candidate.name ?? ''} ${candidate.label ?? ''} ${candidate.bindingName ?? ''} ${candidate.text ?? ''} ${candidate.type ?? ''}`
    .toLowerCase()
    .trim()
}

function hasBreakerMetadata(candidate: ProtectionCandidate): boolean {
  return (
    Number.isFinite(candidate.breakerAmperageA) ||
    Number.isFinite(candidate.breakerShortCircuitKA) ||
    Number.isFinite(candidate.breakerPoles) ||
    Number.isFinite(candidate.bindingGroupBreakerAmperage) ||
    typeof candidate.breakerCurve === 'string'
  )
}

function hasResidualMetadata(candidate: ProtectionCandidate): boolean {
  return Number.isFinite(candidate.rcdResidualCurrentMa) || typeof candidate.rcdType === 'string'
}

function nestedObjects(candidate: ProtectionCandidate): FabricObject[] {
  const nested: FabricObject[] = []
  if (Array.isArray(candidate._objects)) nested.push(...candidate._objects)
  if (Array.isArray(candidate.objects)) nested.push(...candidate.objects)
  return nested
}

export class ProtectionSymbolClassifier {
  static classify(object: FabricObject | null | undefined): ProtectionSymbolKind {
    if (!object) return 'none'
    const candidate = object as ProtectionCandidate

    if (hasResidualMetadata(candidate)) return 'residual-current-breaker'
    if (hasBreakerMetadata(candidate)) return 'breaker'

    const haystack = toHaystack(object)
    if (RESIDUAL_MATCHERS.some((matcher) => haystack.includes(matcher))) {
      return 'residual-current-breaker'
    }

    if (BREAKER_MATCHERS.some((matcher) => haystack.includes(matcher))) {
      return 'breaker'
    }

    for (const nested of nestedObjects(candidate)) {
      const nestedKind = this.classify(nested)
      if (nestedKind !== 'none') return nestedKind
    }
    return 'none'
  }

  static isProtectionSymbol(object: FabricObject | null | undefined): boolean {
    return this.classify(object) !== 'none'
  }

  static isResidualProtection(object: FabricObject | null | undefined): boolean {
    return this.classify(object) === 'residual-current-breaker'
  }
}
