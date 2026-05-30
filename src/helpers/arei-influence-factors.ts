/**
 * AREI external influence factors (Belgian wiring code — Boek 1, Deel 5,
 * Hoofdstuk 51) and equivalent IEC 60364-5-51. Used in the documentation
 * dossier to justify cable choice, IP rating, mechanical protection, etc.
 *
 * Code structure: <letter><digit>  e.g. AD7 = "presence of water - splash".
 *
 * This module provides:
 *   - the canonical reference table (subset relevant for residential),
 *   - a lookup by code,
 *   - a default-influence-factors-by-room-type helper so a designer can
 *     auto-fill the dossier from the situation plan.
 *
 * The table is intentionally a code-side constant (not loaded from JSON)
 * because Cadle ships AREI compliance as a first-class feature: there is
 * no benefit to making it user-editable.
 */

export type AreiFactorCategory =
  | 'A' // environment
  | 'B' // utilisation
  | 'C' // construction

export interface AreiFactor {
  code: string // e.g. 'AD7'
  category: AreiFactorCategory
  family: string // e.g. 'Presence of water'
  level: string // e.g. 'AD7 - Splashes'
  description: string
}

export const AREI_FACTORS: ReadonlyArray<AreiFactor> = [
  // AA — Ambient temperature
  {
    code: 'AA4',
    category: 'A',
    family: 'Ambient temperature',
    level: 'AA4 — −5 °C to +40 °C',
    description: 'Standard indoor environment.'
  },
  {
    code: 'AA5',
    category: 'A',
    family: 'Ambient temperature',
    level: 'AA5 — +5 °C to +40 °C',
    description: 'Heated indoor environment.'
  },

  // AD — Presence of water
  { code: 'AD1', category: 'A', family: 'Presence of water', level: 'AD1 — Negligible', description: 'Dry rooms.' },
  {
    code: 'AD2',
    category: 'A',
    family: 'Presence of water',
    level: 'AD2 — Drops',
    description: 'Possibility of vertically falling water drops.'
  },
  {
    code: 'AD3',
    category: 'A',
    family: 'Presence of water',
    level: 'AD3 — Sprays',
    description: 'Water sprayed up to 60° from vertical.'
  },
  {
    code: 'AD4',
    category: 'A',
    family: 'Presence of water',
    level: 'AD4 — Splashes',
    description: 'Splashing from any direction (bathroom zone 2).'
  },
  {
    code: 'AD5',
    category: 'A',
    family: 'Presence of water',
    level: 'AD5 — Jets',
    description: 'Low-pressure jets from any direction.'
  },
  {
    code: 'AD7',
    category: 'A',
    family: 'Presence of water',
    level: 'AD7 — Immersion',
    description: 'Temporary partial immersion (bathroom zone 1).'
  },

  // AE — Presence of foreign solid bodies
  {
    code: 'AE1',
    category: 'A',
    family: 'Foreign solid bodies',
    level: 'AE1 — Negligible',
    description: 'Dust quantity insignificant.'
  },
  {
    code: 'AE4',
    category: 'A',
    family: 'Foreign solid bodies',
    level: 'AE4 — Light dust',
    description: 'Some accumulation, dry storage.'
  },

  // AG — Mechanical impact
  {
    code: 'AG1',
    category: 'A',
    family: 'Mechanical impact',
    level: 'AG1 — Low',
    description: 'Normal household conditions.'
  },
  {
    code: 'AG2',
    category: 'A',
    family: 'Mechanical impact',
    level: 'AG2 — Medium',
    description: 'Garages, storerooms, workshops.'
  },
  {
    code: 'AG3',
    category: 'A',
    family: 'Mechanical impact',
    level: 'AG3 — High',
    description: 'Industrial environment.'
  },

  // BA — Capability of persons
  {
    code: 'BA1',
    category: 'B',
    family: 'Capability of persons',
    level: 'BA1 — Ordinary',
    description: 'Regular adults / family.'
  },
  {
    code: 'BA2',
    category: 'B',
    family: 'Capability of persons',
    level: 'BA2 — Children',
    description: 'Schools, nurseries.'
  },
  {
    code: 'BA3',
    category: 'B',
    family: 'Capability of persons',
    level: 'BA3 — Disabled',
    description: 'Care institutions.'
  },

  // BB — Body resistance
  { code: 'BB1', category: 'B', family: 'Body resistance', level: 'BB1 — Normal', description: 'Dry skin contact.' },
  {
    code: 'BB2',
    category: 'B',
    family: 'Body resistance',
    level: 'BB2 — Low',
    description: 'Bathroom, kitchen sink area.'
  },
  {
    code: 'BB3',
    category: 'B',
    family: 'Body resistance',
    level: 'BB3 — Very low',
    description: 'Person immersed (bathtub).'
  },

  // CA — Construction materials
  {
    code: 'CA1',
    category: 'C',
    family: 'Construction materials',
    level: 'CA1 — Non-combustible',
    description: 'Brick, concrete, plaster.'
  },
  {
    code: 'CA2',
    category: 'C',
    family: 'Construction materials',
    level: 'CA2 — Combustible',
    description: 'Wood, thatch — additional fire precautions.'
  }
]

const FACTORS_BY_CODE = new Map(AREI_FACTORS.map((f) => [f.code, f]))

export function lookupAreiFactor(code: string): AreiFactor | undefined {
  return FACTORS_BY_CODE.get(code.toUpperCase())
}

/**
 * Recognised residential room types and their default influence factors.
 * The selection is the conservative choice an installer would defend in
 * an AREI dossier; users can still override per-circuit.
 */
export type RoomType =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'wc'
  | 'hallway'
  | 'garage'
  | 'cellar'
  | 'attic'
  | 'outdoor'
  | 'workshop'

export const ROOM_DEFAULT_FACTORS: Readonly<Record<RoomType, ReadonlyArray<string>>> = {
  living: ['AA5', 'AD1', 'AE1', 'AG1', 'BA1', 'BB1', 'CA1'],
  bedroom: ['AA5', 'AD1', 'AE1', 'AG1', 'BA1', 'BB1', 'CA1'],
  kitchen: ['AA5', 'AD2', 'AE1', 'AG1', 'BA1', 'BB2', 'CA1'],
  bathroom: ['AA5', 'AD7', 'AE1', 'AG1', 'BA1', 'BB3', 'CA1'],
  wc: ['AA5', 'AD2', 'AE1', 'AG1', 'BA1', 'BB2', 'CA1'],
  hallway: ['AA5', 'AD1', 'AE1', 'AG1', 'BA1', 'BB1', 'CA1'],
  garage: ['AA4', 'AD2', 'AE4', 'AG2', 'BA1', 'BB1', 'CA1'],
  cellar: ['AA4', 'AD2', 'AE4', 'AG1', 'BA1', 'BB2', 'CA1'],
  attic: ['AA4', 'AD1', 'AE4', 'AG1', 'BA1', 'BB1', 'CA2'],
  outdoor: ['AA4', 'AD4', 'AE4', 'AG2', 'BA1', 'BB1', 'CA1'],
  workshop: ['AA4', 'AD2', 'AE4', 'AG2', 'BA1', 'BB1', 'CA1']
}

export function defaultFactorsForRoom(room: RoomType): ReadonlyArray<AreiFactor> {
  return ROOM_DEFAULT_FACTORS[room].map((code) => lookupAreiFactor(code)!).filter(Boolean)
}
