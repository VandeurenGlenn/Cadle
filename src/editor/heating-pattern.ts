export type HeatingPattern = 'spiral' | 'meander' | 'mixed'

export const heatingPatternLabel = (pattern?: HeatingPattern) => pattern === 'meander' ? 'Meander' : pattern === 'mixed' ? 'Slakkenhuis + meander' : 'Slakkenhuis'

export const combineHeatingPatterns = (patterns: readonly (HeatingPattern | undefined)[]): HeatingPattern => {
  const unique = new Set(patterns.map((pattern) => pattern ?? 'spiral'))
  return unique.size > 1 || unique.has('mixed') ? 'mixed' : unique.has('meander') ? 'meander' : 'spiral'
}
