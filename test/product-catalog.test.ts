import assert from 'node:assert/strict'
import test from 'node:test'
import { matchVerifiedProducts, VERIFIED_PRODUCT_CATALOG } from '../src/editor/product-catalog.ts'

test('contains verified Belgian Schneider and Niko starter references', () => {
  const references = new Set(VERIFIED_PRODUCT_CATALOG.map((product) => product.reference))
  for (const reference of [
    'R9F64216', 'R9FEC216', 'A9F74616', 'R9D32216',
    '170-33100', '170-33105', '171-01205', '171-01605'
  ]) {
    assert.equal(references.has(reference), true, reference)
  }
})

test('resolves a fully specified Resi9 2P C16 breaker exactly', () => {
  const match = matchVerifiedProducts({
    kind: 'breaker',
    manufacturer: 'Schneider Electric',
    series: 'Resi9',
    poles: '2P',
    ratedCurrentA: 16,
    curve: 'C'
  })

  assert.equal(match.status, 'exact')
  assert.deepEqual(match.products.map((product) => product.reference), ['R9F64216'])
})

test('keeps ordinary Resi9 and Resi9 XE separate', () => {
  const match = matchVerifiedProducts({
    kind: 'breaker',
    manufacturer: 'Schneider Electric',
    series: 'Resi9 XE',
    poles: '2P',
    ratedCurrentA: 16,
    curve: 'C'
  })

  assert.equal(match.status, 'exact')
  assert.deepEqual(match.products.map((product) => product.reference), ['R9FEC216'])
})

test('does not claim an exact Schneider reference without a product series', () => {
  const match = matchVerifiedProducts({
    kind: 'breaker',
    manufacturer: 'Schneider Electric',
    poles: '2P',
    ratedCurrentA: 16,
    curve: 'C'
  })

  assert.equal(match.status, 'candidates')
  assert.deepEqual(match.products.map((product) => product.reference), ['R9F64216', 'R9FEC216'])
  assert.deepEqual(match.missing, ['productreeks'])
})

test('offers both Niko socket variants until the terminal type is known', () => {
  const match = matchVerifiedProducts({
    kind: 'socket',
    manufacturer: 'Niko',
    ratedCurrentA: 16
  })

  assert.equal(match.status, 'candidates')
  assert.deepEqual(match.products.map((product) => product.reference), ['170-33100', '170-33105'])
  assert.deepEqual(match.missing, ['klemtype'])
})

test('accepts a verified explicit reference and flags unknown references', () => {
  assert.equal(matchVerifiedProducts({
    kind: 'breaker',
    reference: 'r9f64216'
  }).status, 'exact')

  const unknown = matchVerifiedProducts({
    kind: 'breaker',
    reference: 'R9-NOT-REAL'
  })
  assert.equal(unknown.status, 'none')
  assert.deepEqual(unknown.missing, ['onbekende artikelreferentie'])
})
