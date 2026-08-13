export type ProductKind = 'breaker' | 'rcbo' | 'socket' | 'switch'

export type VerifiedProduct = {
  manufacturer: 'Schneider Electric' | 'Niko'
  series: string
  reference: string
  name: string
  kind: ProductKind
  market: 'BE' | 'FR' | 'NL'
  poles?: '1P+N' | '2P' | '3P+N' | '4P'
  ratedCurrentA?: number
  curve?: 'B' | 'C' | 'D'
  breakingCapacityA?: number
  rcdSensitivityMa?: number
  rcdType?: 'A' | 'AC' | 'F' | 'B'
  termination?: 'screw' | 'push-in'
  mounting?: 'claw' | 'screw'
  sourceUrl: string
}

export const VERIFIED_PRODUCT_CATALOG: readonly VerifiedProduct[] = [
  {
    manufacturer: 'Schneider Electric', series: 'Resi9', reference: 'R9F64216',
    name: 'Resi9 installatieautomaat 2P 16A curve C 3kA', kind: 'breaker', market: 'BE',
    poles: '2P', ratedCurrentA: 16, curve: 'C', breakingCapacityA: 3000,
    sourceUrl: 'https://www.se.com/be/nl/product/R9F64216/'
  },
  {
    manufacturer: 'Schneider Electric', series: 'Resi9 XE', reference: 'R9FEC216',
    name: 'Resi9 XE installatieautomaat 2P 16A curve C 3kA', kind: 'breaker', market: 'BE',
    poles: '2P', ratedCurrentA: 16, curve: 'C', breakingCapacityA: 3000,
    sourceUrl: 'https://www.se.com/be/nl/product/R9FEC216/'
  },
  {
    manufacturer: 'Schneider Electric', series: 'Acti9 iC60N', reference: 'A9F74616',
    name: 'Acti9 iC60N installatieautomaat 1P+N 16A curve C', kind: 'breaker', market: 'BE',
    poles: '1P+N', ratedCurrentA: 16, curve: 'C',
    sourceUrl: 'https://www.se.com/be/fr/product/A9F74616/'
  },
  {
    manufacturer: 'Schneider Electric', series: 'Resi9', reference: 'R9D32216',
    name: 'Resi9 differentieelautomaat 1P+N 16A C 30mA type A 4,5kA', kind: 'rcbo', market: 'BE',
    poles: '1P+N', ratedCurrentA: 16, curve: 'C', breakingCapacityA: 4500,
    rcdSensitivityMa: 30, rcdType: 'A',
    sourceUrl: 'https://www.se.com/be/fr/product/R9D32216/'
  },
  {
    manufacturer: 'Niko', series: 'Niko Rocker / Toggle', reference: '170-33100',
    name: 'Stopcontactsokkel met penaarde en beschermingsafsluiters', kind: 'socket', market: 'BE',
    ratedCurrentA: 16, termination: 'screw', mounting: 'claw',
    sourceUrl: 'https://www.niko.eu/nl-be/artikel/170-33100'
  },
  {
    manufacturer: 'Niko', series: 'Niko Rocker / Toggle', reference: '170-33105',
    name: 'Stopcontactsokkel met penaarde en beschermingsafsluiters', kind: 'socket', market: 'BE',
    ratedCurrentA: 16, termination: 'push-in', mounting: 'claw',
    sourceUrl: 'https://www.niko.eu/nl-be/artikel/170-33105'
  },
  {
    manufacturer: 'Niko', series: 'Niko Rocker / Toggle', reference: '171-01205',
    name: 'Tweepolige schakelaar 10AX, insteekklemmen, klauwbevestiging', kind: 'switch', market: 'BE',
    ratedCurrentA: 10, termination: 'push-in', mounting: 'claw',
    sourceUrl: 'https://www.niko.eu/nl-be/producten/schakelmateriaal-en-stopcontacten/schakelaars-en-stopcontacten/enkelvoudige-schakelfunctie-niko-toggle-productmodel-niko-f6f93038-87b5-4088-9ad1-b1e600cb9bc8'
  },
  {
    manufacturer: 'Niko', series: 'Niko Rocker / Toggle', reference: '171-01605',
    name: 'Wisselschakelaar 10AX, insteekklemmen, klauwbevestiging', kind: 'switch', market: 'BE',
    ratedCurrentA: 10, termination: 'push-in', mounting: 'claw',
    sourceUrl: 'https://www.niko.eu/nl-be/producten/schakelmateriaal-en-stopcontacten/schakelaars-en-stopcontacten/enkelvoudige-schakelfunctie-niko-toggle-productmodel-niko-f6f93038-87b5-4088-9ad1-b1e600cb9bc8'
  }
] as const

export type ProductQuery = {
  manufacturer?: string
  series?: string
  reference?: string
  kind: ProductKind
  poles?: VerifiedProduct['poles']
  ratedCurrentA?: number
  curve?: VerifiedProduct['curve']
  rcdSensitivityMa?: number
  rcdType?: VerifiedProduct['rcdType']
  termination?: VerifiedProduct['termination']
  mounting?: VerifiedProduct['mounting']
}

export type ProductMatch = {
  status: 'exact' | 'candidates' | 'none'
  products: VerifiedProduct[]
  missing: string[]
}

export const matchVerifiedProducts = (query: ProductQuery): ProductMatch => {
  if (query.reference?.trim()) {
    const product = VERIFIED_PRODUCT_CATALOG.find(
      (entry) => entry.reference.toLowerCase() === query.reference?.trim().toLowerCase()
    )
    return product
      ? { status: 'exact', products: [product], missing: [] }
      : { status: 'none', products: [], missing: ['onbekende artikelreferentie'] }
  }
  const manufacturer = query.manufacturer?.toLowerCase() ?? ''
  const series = query.series?.toLowerCase() ?? ''
  const products = VERIFIED_PRODUCT_CATALOG.filter((entry) =>
    entry.kind === query.kind
    && entry.market === 'BE'
    && (!manufacturer || entry.manufacturer.toLowerCase().includes(manufacturer))
    && (!series || entry.series.toLowerCase() === series)
    && (query.poles === undefined || entry.poles === query.poles)
    && (query.ratedCurrentA === undefined || entry.ratedCurrentA === query.ratedCurrentA)
    && (query.curve === undefined || entry.curve === query.curve)
    && (query.rcdSensitivityMa === undefined || entry.rcdSensitivityMa === query.rcdSensitivityMa)
    && (query.rcdType === undefined || entry.rcdType === query.rcdType)
    && (query.termination === undefined || entry.termination === query.termination)
    && (query.mounting === undefined || entry.mounting === query.mounting)
  )
  const missing = [
    ...(!query.manufacturer ? ['fabrikant'] : []),
    ...(query.kind === 'breaker' && !query.series ? ['productreeks'] : []),
    ...(query.kind === 'socket' && !query.termination ? ['klemtype'] : []),
    ...(query.kind === 'switch' ? ['schakelfunctie'] : []),
    ...(query.kind === 'switch' && !query.termination ? ['klemtype'] : []),
    ...(query.kind === 'switch' && !query.mounting ? ['montage'] : [])
  ]
  return {
    status: products.length === 1 && missing.length === 0 ? 'exact' : products.length ? 'candidates' : 'none',
    products,
    missing
  }
}
