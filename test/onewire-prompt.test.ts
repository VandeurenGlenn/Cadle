import assert from 'node:assert/strict'
import test from 'node:test'
import { interpretOneWirePrompt, oneWirePromptTree, parseOneWirePrompt } from '../src/editor/onewire-prompt.ts'

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
    'hoofdschakelaar → kWh-meter → 4x10 mm² EXVB → hoofddifferentieel 40 A / 300 mA',
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
    'hoofdschakelaar 25 A → kWh-meter → 4x10 mm² EXVB → hoofddifferentieel 40 A / 300 mA'
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
