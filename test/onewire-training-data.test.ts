import assert from 'node:assert/strict'
import test from 'node:test'
import { createOneWireTrainingExample } from '../src/editor/onewire-training-data.ts'

const base = {
  version: 1 as const,
  residualBreaker: true,
  solar: true,
  consumers: true,
  solarPlacement: 'parallel-after-main-differential' as const
}

test('marks a locally accepted parser result as uncorrected', () => {
  const example = createOneWireTrainingExample(' test ', base, base, 'example-1', 123)
  assert.equal(example.prompt, 'test')
  assert.equal(example.corrected, false)
  assert.equal(example.id, 'example-1')
  assert.equal(example.createdAt, 123)
})

test('marks an edited topology as a correction for later training', () => {
  const example = createOneWireTrainingExample(
    'zonnepanelen',
    base,
    { ...base, residualBreaker: false },
    'example-2',
    456
  )
  assert.equal(example.corrected, true)
  assert.notEqual(example.parserTopology, example.acceptedTopology)
})
