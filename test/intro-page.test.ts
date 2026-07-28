import assert from 'node:assert/strict'
import test from 'node:test'
import { buildIntroPageSvg } from '../src/editor/intro-page.ts'
import type { Project } from '../src/types.ts'

test('keeps missing technical fields empty and omits the edition block', () => {
  const svg = buildIntroPageSvg(null)

  assert.doesNotMatch(svg, /AANVULLEN/)
  assert.doesNotMatch(svg, /NORM \/ UITGAVE/)
  assert.doesNotMatch(svg, /CURRENT EDITION/)
  assert.doesNotMatch(svg, /Onderdeel van het AREI-dossier/)
  assert.doesNotMatch(svg, /keuringsorganisme/)
  assert.doesNotMatch(svg, /DOSSIERGEGEVENS/)
  assert.doesNotMatch(svg, /OPMAAK SCHEMA/)
  assert.doesNotMatch(svg, />SPANNING</)
  assert.match(svg, /DATUM/)
  assert.match(svg, /Gegenereerd door Cadle/)
})

test('places stored installer and customer signatures in their introduction boxes', () => {
  const svg = buildIntroPageSvg({
    installerSignatureUrl: 'data:image/png;base64,aW5zdGFsbGVy',
    customerSignatureUrl: 'data:image/png;base64,Y3VzdG9tZXI='
  } as Project)

  assert.match(svg, /data-project-signature="installer"/)
  assert.match(svg, /data-project-signature="customer"/)
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/)
})
