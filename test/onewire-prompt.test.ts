import assert from 'node:assert/strict'
import test from 'node:test'
import { oneWirePromptTree, parseOneWirePrompt } from '../src/editor/onewire-prompt.ts'

test('parses a Dutch one-wire topology description with a parallel solar branch', () => {
  const parsed = parseOneWirePrompt(
    'Inkomende is 4x10 EXB, diff 40A 300mA. Deze gaat naar een remautomaat en dan naar de verbruikers. Er zijn zonnepanelen; deze staan samen aan de kant van de hoofddiff.'
  )

  assert.deepEqual(parsed.plan, {
    version: 1,
    incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' },
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    residualBreaker: true,
    solar: true,
    consumers: true,
    solarPlacement: 'parallel-after-main-differential'
  })
  assert.deepEqual(oneWirePromptTree(parsed.plan), [
    'kWh-meter → 4x10 mm² EXVB → hoofddifferentieel 40 A / 300 mA',
    '├─ zonnepanelen / omvormer',
    '└─ remautomaat → verbruikers'
  ])
})
