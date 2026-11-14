/** A cooperative pause retains the worker and its completed planning stages. */
export const HEATING_PLANNING_SLICE_MS = 180_000
export class HeatingPlanningPaused extends Error {
  constructor() { super('De berekening lijkt erg lang te duren en is gepauzeerd. Je kunt hervatten met behoud van het berekende werk.'); this.name = 'HeatingPlanningPaused' }
}
