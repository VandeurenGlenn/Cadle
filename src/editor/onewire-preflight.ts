export type OneWirePreflightReport = {
  totalGroups: number
  errorCount: number
  valid: boolean
}

export type OneWirePreflightResult =
  | { ready: true }
  | { ready: false; reason: 'unavailable' | 'empty' | 'invalid'; message: string }

export const evaluateOneWirePreflight = (
  report: OneWirePreflightReport | null | undefined
): OneWirePreflightResult => {
  if (!report) {
    return {
      ready: false,
      reason: 'unavailable',
      message: 'The ground plan could not be analysed. Keep the ground-plan page open and try again.'
    }
  }
  if (report.totalGroups === 0) {
    return {
      ready: false,
      reason: 'empty',
      message: 'Add electrical devices to the ground plan and assign circuit IDs such as A1 before generating.'
    }
  }
  if (!report.valid || report.errorCount > 0) {
    return {
      ready: false,
      reason: 'invalid',
      message: 'Resolve the ground-plan validation errors before generating the one-wire diagram.'
    }
  }
  return { ready: true }
}
