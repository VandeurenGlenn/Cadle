import assert from 'node:assert/strict'
import test from 'node:test'
import { interpretOneWirePrompt, oneWirePromptTree, oneWireTopologyPrompt, parseOneWirePrompt } from '../src/editor/onewire-prompt.ts'

test('keeps the meter-to-board cable separate from the EXVB before the main breaker', () => {
  for (const description of [
    'Inkomende kabel 4x10 mm² EXVB. Kabel van kWh-meter naar kast: 4x16 mm² XVB.',
    'Kabel van kWh-meter naar kast: 4x16 mm² XVB. Inkomende kabel 4x10 mm² EXVB.',
    'Inkomende kabel 4x10 mm² EXVB. Kring A: 3G2.5 mm² VOB. Kabel van kWh-meter naar kast: 4x16 mm² XVB.'
  ]) {
    const { plan } = parseOneWirePrompt(description)
    assert.deepEqual(plan.incomingCable, { conductors: 4, sectionMm2: 10, cableType: 'EXVB' })
    assert.deepEqual(plan.meterCable, { conductors: 4, sectionMm2: 16, cableType: 'XVB' })
    assert.deepEqual(parseOneWirePrompt(oneWireTopologyPrompt(plan)).plan, plan)
    assert.match(oneWirePromptTree(plan)[0], /EXVB.*kWh-meter → 4x16 mm² XVB → hoofddifferentieel/)
  }
  assert.equal(parseOneWirePrompt('Inkomende kabel 4x10 mm² EXVB.').plan.meterCable, undefined)
})

test('recognizes an untyped cable leading to the main differential as the meter cable', () => {
  const { plan } = parseOneWirePrompt(
    'Inkomende kabel is 4x10 mm² EXVB. Hoofdschakelaar 32 A. 4x10mm naar Hoofddifferentieel 40A 300mA.'
  )

  assert.deepEqual(plan.incomingCable, { conductors: 4, sectionMm2: 10, cableType: 'EXVB' })
  assert.deepEqual(plan.meterCable, { conductors: 4, sectionMm2: 10, cableType: 'other' })
  assert.ok(oneWirePromptTree(plan)[0].includes('kWh-meter → 4x10 mm² → hoofddifferentieel'))
})

test('makes saved topology settings editable as a description without inventing absent equipment', () => {
  const plan = parseOneWirePrompt(
    'Inkomende kabel 5x10 mm² XVB. Hoofdzekering 40 A. Hoofdschakelaar 63 A. Hoofddifferentieel 63 A 300 mA. Geen remautomaat. Geen zonnepanelen. Daarna de verbruikers. 2 extra diffs 40 A 30 mA voor verbruikers.'
  ).plan
  assert.deepEqual(parseOneWirePrompt(oneWireTopologyPrompt(plan)).plan, plan)
  const solar = parseOneWirePrompt(
    'Hoofddifferentieel 63 A 300 mA. Remautomaat Schneider 40 A. PV-automaat TECO 20 A parallel na de hoofddifferentieel. Verbruikers.'
  ).plan
  assert.deepEqual(parseOneWirePrompt(oneWireTopologyPrompt(solar)).plan, solar)
})

test('parses a Dutch one-wire topology description with a parallel solar branch', () => {
  const parsed = parseOneWirePrompt(
    'Inkomende is 4x10 EXB, diff 40A 300mA. Deze gaat naar een remautomaat en dan naar de verbruikers. Er zijn zonnepanelen; deze staan samen aan de kant van de hoofddiff.'
  )

  assert.deepEqual(parsed.plan, {
    version: 1,
    incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' },
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    residualBreaker: true,
    residualBreakerRatedCurrentA: 40,
    solar: true,
    consumers: true,
    solarPlacement: 'parallel-after-main-differential'
  })
  assert.deepEqual(oneWirePromptTree(parsed.plan), [
    '4x10 mm² EXVB → hoofdschakelaar → kWh-meter → hoofddifferentieel 40 A / 300 mA',
    '├─ zonnepanelen / omvormer',
    '└─ remautomaat 40 A → verbruikers'
  ])
})

test('understands explicit absence without turning mentioned components on', () => {
  const parsed = parseOneWirePrompt(
    'Voeding 5G6 XVB-Cca, hoofddifferentieel 63 A 300 mA. Geen zonnepanelen en zonder remautomaat. De diff voedt lichtkringen en stopcontacten.'
  )

  assert.deepEqual(parsed.plan, {
    version: 1,
    incomingCable: { conductors: 5, sectionMm2: 6, cableType: 'XVB-Cca' },
    mainDifferential: { ratedCurrentA: 63, sensitivityMa: 300 },
    residualBreaker: false,
    solar: false,
    consumers: true
  })
})

test('uses a later affirmative statement after an initially negated option', () => {
  const parsed = parseOneWirePrompt(
    'Geen zonnepanelen op het dak, maar wel een PV-omvormer op de hoofdbus.'
  )

  assert.equal(parsed.plan.solar, true)
  assert.equal(parsed.plan.solarPlacement, 'parallel-after-main-differential')
})

test('accepts common Belgian cable notation and PV synonyms', () => {
  const parsed = parseOneWirePrompt(
    'Inkomend 4×16 mm2 XGB Cca. Hoofddiff 40A / 300mA. Fotovoltaïsche installatie op de hoofdbus, RCBO naar eindstroombanen.'
  )

  assert.deepEqual(parsed.plan, {
    version: 1,
    incomingCable: { conductors: 4, sectionMm2: 16, cableType: 'XGB-Cca' },
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    residualBreaker: true,
    residualBreakerRatedCurrentA: 40,
    solar: true,
    consumers: true,
    solarPlacement: 'parallel-after-main-differential'
  })
})

test('uses an explicit remautomaat current instead of the 40 A default', () => {
  const parsed = parseOneWirePrompt(
    'Hoofddifferentieel 63 A 300 mA. Daarna een remautomaat C63A naar de verbruikers.'
  )

  assert.equal(parsed.plan.residualBreakerRatedCurrentA, 63)
  assert.ok(oneWirePromptTree(parsed.plan).some((line) => line.includes('remautomaat 63 A')))
})

test('stores the hoofdschakelaar rating in the structured topology', () => {
  const parsed = parseOneWirePrompt(
    'Inkomende kabel 4x10 mm² EXVB. Hoofdschakelaar is 25A. Hoofddifferentieel 40A 300mA.'
  )

  assert.deepEqual(parsed.plan.mainSwitch, { ratedCurrentA: 25 })
  assert.equal(
    oneWirePromptTree(parsed.plan)[0],
    '4x10 mm² EXVB → hoofdschakelaar 25 A → kWh-meter → hoofddifferentieel 40 A / 300 mA'
  )
})

test('keeps completeness warnings for a valid model interpretation', async () => {
  const interpreted = await interpretOneWirePrompt('alleen zonnepanelen', {
    infer: async () => ({
      version: 1,
      residualBreaker: false,
      solar: true,
      consumers: false,
      solarPlacement: 'parallel-after-main-differential'
    })
  })

  assert.match(interpreted.warnings.join(' '), /inkomende kabel/i)
  assert.match(interpreted.warnings.join(' '), /hoofddifferentieel/i)
  assert.match(interpreted.warnings.join(' '), /remautomaat/i)
  assert.match(interpreted.warnings.join(' '), /verbruikers/i)
  assert.match(interpreted.warnings.join(' '), /PV-positie niet vermeld/i)
})

test('keeps counts, sensitivity and purpose of additional differentials', () => {
  const parsed = parseOneWirePrompt(
    'Inkomende kabel 4x10 mm² EXVB. Hoofddifferentieel 40 A 300 mA. Daarna een remautomaat naar de verbruikers. Zonnepanelen parallel aan de hoofddifferentieel. Dan nog 2 diffs 30 mA voor verbruikers en 1 voor EV.'
  )

  assert.equal(parsed.plan.consumers, true)
  assert.deepEqual(parsed.plan.additionalDifferentials, [
    { count: 2, sensitivityMa: 30, purpose: 'consumers' },
    { count: 1, sensitivityMa: 30, purpose: 'ev' }
  ])
  assert.ok(oneWirePromptTree(parsed.plan).some((line) => line.includes('2× differentieel 30 mA → verbruikers')))
  assert.ok(oneWirePromptTree(parsed.plan).some((line) => line.includes('1× differentieel 30 mA → EV')))
})

test('recognizes the singular downstream differential and PV breaker in a natural supply description', () => {
  const prompt = 'Inkomende kabel is 4x10 mm² EXVB. Hoofdschakelaar 32 A. Hoofddifferentieel 40A 300 mA. ' +
    'Daarna een remautomaat naar differentieel 30mA 40 A type A en dan naar de verbruikers. ' +
    'Er zijn zonnepanelen; plaats deze parallel aan de kant van de hoofddifferentieel de automaat is 2P 25A.'
  const { plan } = parseOneWirePrompt(prompt)
  assert.deepEqual(plan.additionalDifferentials, [
    { count: 1, ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A', purpose: 'consumers' }
  ])
  assert.equal(plan.solarBreakerRatedCurrentA, 25)
  assert.equal(plan.solarBreakerPoles, 2)
  assert.equal(plan.mainDifferential?.sensitivityMa, 300)
  assert.deepEqual(oneWirePromptTree(plan).slice(-2), [
    '└─ remautomaat 40 A → verbruikersrail',
    '   └─ 1× differentieel 40 A / 30 mA type A → verbruikers'
  ])
  assert.deepEqual(parseOneWirePrompt(oneWireTopologyPrompt(plan)).plan, plan)
})

test('does not duplicate the main differential or add negated extra differentials', () => {
  assert.equal(parseOneWirePrompt('Diff 40A 300mA. Geen extra differentieel 30mA. Verbruikers.')
    .plan.additionalDifferentials, undefined)
  const plan = parseOneWirePrompt('Hoofddiff 40A 300mA. Een bijkomende differentieel 40A 30mA voor verbruikers.').plan
  assert.deepEqual(plan.additionalDifferentials, [{ count: 1, ratedCurrentA: 40, sensitivityMa: 30, purpose: 'consumers' }])
  const incomplete = parseOneWirePrompt('Hoofddifferentieel 63A. Een extra diff 40A 30mA voor verbruikers.').plan
  assert.equal(incomplete.mainDifferential, undefined)
  assert.equal(incomplete.additionalDifferentials?.length, 1)
  const inherited = parseOneWirePrompt('Hoofddiff 40A 300mA. 2 diffs 40A 30mA voor verbruikers en 1 diff voor EV.').plan
  assert.deepEqual(inherited.additionalDifferentials, [
    { count: 2, ratedCurrentA: 40, sensitivityMa: 30, purpose: 'consumers' },
    { count: 1, ratedCurrentA: 40, sensitivityMa: 30, purpose: 'ev' }
  ])
})

test('warns about combined grid and PV current without a remautomaat', () => {
  const parsed = parseOneWirePrompt(
    'Hoofddifferentieel 40 A 300 mA. Zonnepanelen parallel op de rail en verbruikers zonder remautomaat.'
  )

  assert.equal(parsed.plan.solar, true)
  assert.equal(parsed.plan.residualBreaker, false)
  assert.match(parsed.warnings.join(' '), /hoofdzekering|som van net- en PV-stroom/i)
})

test('parses main-fuse and PV-breaker currents for the capacity check', () => {
  const parsed = parseOneWirePrompt(
    'Hoofdzekering 40 A. Hoofddifferentieel 40 A 300 mA. PV-automaat C20A parallel op de rail. Geen remautomaat. 1 extra diff 40 A 30 mA voor verbruikers.'
  )

  assert.equal(parsed.plan.gridProtectionCurrentA, 40)
  assert.equal(parsed.plan.solarBreakerRatedCurrentA, 20)
  assert.match(parsed.warnings.join(' '), /max 60 a.*diff 40 a te laag/i)
  assert.match(parsed.warnings.join(' '), /hogere differentieel begrenst de stroom niet/i)
})

test('warns when a downstream differential is rated below the remautomaat', () => {
  const parsed = parseOneWirePrompt(
    'Hoofddifferentieel 63 A 300 mA. Remautomaat 63 A naar verbruikers. 1 extra diff 40 A 30 mA voor verbruikers.'
  )

  assert.match(parsed.warnings.join(' '), /lager gedimensioneerd.*63 A/i)
})

test('recognizes protection manufacturers and their default neutral side', () => {
  const parsed = parseOneWirePrompt(
    'Hoofddiff TECO 40 A 300 mA. Remautomaat Schneider 40 A naar verbruikers. 1 extra diff TECO 40 A 30 mA voor verbruikers. PV-automaat TECO C20A parallel op de rail.'
  )

  assert.equal(parsed.plan.mainDifferential?.manufacturer, 'TECO')
  assert.equal(parsed.plan.mainDifferential?.neutralPosition, 'right')
  assert.equal(parsed.plan.residualBreakerManufacturer, 'Schneider Electric')
  assert.equal(parsed.plan.residualBreakerNeutralPosition, 'left')
  assert.equal(parsed.plan.solarBreakerManufacturer, 'TECO')
  assert.equal(parsed.plan.solarBreakerNeutralPosition, 'right')
  assert.equal(parsed.plan.additionalDifferentials?.[0].manufacturer, 'TECO')
  assert.equal(parsed.plan.additionalDifferentials?.[0].neutralPosition, 'right')
})
