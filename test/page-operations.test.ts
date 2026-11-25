import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureOneWirePage,
  electricalSettingsPageKey,
  explicitLinkedPageKey,
  installationOneWirePageKeys,
  linkGroundPlanToOneWirePage,
  linkOneWirePageToInstallation,
  linkedGroundplanPageKeys,
  oneWireInstallationRootKey,
  oneWireGenerationPageKeys,
  redundantOneWirePageKeys
} from '../src/data/page-operations.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { clonePageSchema } from '../src/data/page-schema.ts'
import type { Project, UUID } from '../src/types.ts'

test('clones page schemas without sharing object references', () => {
  const schema = { version: 'native-svg-1', objects: [{ id: 'one', kind: 'wall' }] }
  const cloned = clonePageSchema(schema, {
    includeWalls: true,
    outsideWallsOnly: false,
    includeOpenings: false,
    includeElectrical: false
  })

  assert.deepEqual(cloned, schema)
  assert.notEqual(cloned, schema)
  assert.notEqual(cloned.objects, schema.objects)
})

test('filters page objects according to the selected clone options', () => {
  const schema = {
    version: 'native-svg-1',
    objects: [
      { id: 'wall', kind: 'wall' },
      { id: 'door', kind: 'door' },
      { id: 'socket', kind: 'symbol', electrical: { role: 'load' } }
    ]
  }
  const cloned = clonePageSchema(schema, {
    includeWalls: true,
    outsideWallsOnly: false,
    includeOpenings: false,
    includeElectrical: true
  })

  assert.deepEqual(
    cloned.objects.map((object) => (object as { id: string }).id),
    ['wall', 'socket']
  )
})

test('creates and returns a one-wire page when the project has none', async () => {
  const projectKey = 'project' as UUID
  const pageKey = 'onewire-page' as UUID
  const project = { pages: {} } as Project

  const result = await ensureOneWirePage(projectKey, project, {
    addPage: async (receivedProjectKey, pageName, schema, pageType) => {
      assert.equal(receivedProjectKey, projectKey)
      assert.equal(pageName, 'One-wire diagram')
      assert.deepEqual(schema, { version: 'native-svg-1', objects: [] })
      assert.equal(pageType, 'onewire')
      project.pages[pageKey] = {
        creationTime: Date.now(),
        name: pageName,
        pageType,
        schema
      }
      return pageKey
    },
    getProjectData: async () => project,
    setProjectData: async () => {}
  })

  assert.equal(result?.pageKey, pageKey)
  assert.equal(result?.project.pages[pageKey]?.pageType, 'onewire')
})

test('creates a separate one-wire page when another building already owns the existing diagram', async () => {
  const projectKey = 'project' as UUID
  const newPageKey = 'building-b-wire' as UUID
  const project = {
    pages: {
      buildingA: { creationTime: 1, name: 'Gebouw A', pageType: 'groundplan',
        schema: { version: 'native-svg-1', objects: [] }, linkedOneWirePageKey: 'building-a-wire' },
      buildingB: { creationTime: 2, name: 'Gebouw B', pageType: 'groundplan',
        schema: { version: 'native-svg-1', objects: [] } },
      'building-a-wire': { creationTime: 3, name: 'Schema A', pageType: 'onewire',
        schema: { version: 'native-svg-1', objects: [] } }
    }
  } as Project
  let savedProject: Project | undefined
  const result = await ensureOneWirePage(projectKey, project, {
    addPage: async (_key, name, schema, pageType) => {
      project.pages[newPageKey] = { creationTime: 4, name, pageType, schema }
      return newPageKey
    },
    getProjectData: async () => project,
    setProjectData: async (_key, updated) => { savedProject = updated }
  }, 'buildingB')

  assert.equal(result?.pageKey, newPageKey)
  assert.equal(result?.project.pages.buildingB.linkedOneWirePageKey, newPageKey)
  assert.equal(result?.project.pages.buildingA.linkedOneWirePageKey, 'building-a-wire')
  assert.equal(savedProject?.pages.buildingB.linkedOneWirePageKey, newPageKey)
})

test('links legacy overflow sheets to the building root when adopting an old diagram', async () => {
  const projectKey = 'project' as UUID
  const project = {
    pages: {
      building: { creationTime: 1, name: 'Gebouw', pageType: 'groundplan',
        schema: { version: 'native-svg-1', objects: [] } },
      root: { creationTime: 2, name: 'One-wire diagram', pageType: 'onewire',
        schema: { version: 'native-svg-1', objects: [] } },
      overflow: { creationTime: 3, name: 'One-wire diagram 2', pageType: 'onewire',
        schema: { version: 'native-svg-1', objects: [] } }
    }
  } as Project
  let savedProject: Project | undefined
  const result = await ensureOneWirePage(projectKey, project, {
    addPage: async () => { throw new Error('an existing root should be reused') },
    getProjectData: async () => project,
    setProjectData: async (_key, updated) => { savedProject = updated }
  }, 'building')

  assert.equal(result?.pageKey, 'root')
  assert.equal(savedProject?.pages.building.linkedOneWirePageKey, 'root')
  assert.equal(savedProject?.pages.overflow.oneWireOverflowOf, 'root')
  assert.deepEqual(oneWireGenerationPageKeys(savedProject!, 'root'), ['root', 'overflow'])
})

test('resolves explicit ground-plan and one-wire page links without changing legacy auto-link behavior', () => {
  const project = {
    pages: {
      plot: { name: 'Perceel', pageType: 'groundplan' },
      buildingA: { name: 'Gebouw A', pageType: 'groundplan', linkedOneWirePageKey: 'buildingAWire' },
      buildingB: { name: 'Gebouw B', pageType: 'groundplan', linkedOneWirePageKey: null },
      buildingAWire: { name: 'Schema gebouw A', pageType: 'onewire' },
      buildingBWire: { name: 'Schema gebouw B', pageType: 'onewire' },
      legacyBuilding: { name: 'Oud grondplan', pageType: 'groundplan' }
    }
  } as Project

  assert.equal(explicitLinkedPageKey(project, 'buildingA'), 'buildingAWire')
  assert.equal(explicitLinkedPageKey(project, 'buildingB'), '')
  assert.equal(explicitLinkedPageKey(project, 'buildingAWire'), 'buildingA')
  assert.equal(explicitLinkedPageKey(project, 'buildingBWire'), null)
  assert.equal(explicitLinkedPageKey(project, 'legacyBuilding'), null)
})

test('shares one installation across linked floor plans and migrates legacy settings to its one-wire page', () => {
  const electricalProfile = { standard: 'AREI', edition: 'Book 1' } as Project['electricalProfile']
  const circuitSpecifications = { A1: { breakerCurrentA: 16 } } as Project['circuitSpecifications']
  const oneWireTopology = { mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 } } as Project['oneWireTopology']
  const project = {
    pages: {
      ground: {
        name: 'Gebouw 1 - Gelijkvloers',
        pageType: 'groundplan',
        linkedOneWirePageKey: 'wire',
        electricalProfile,
        oneWireTopology
      },
      upper: {
        name: 'Gebouw 1 - Verdieping',
        pageType: 'groundplan',
        linkedOneWirePageKey: 'other-wire',
        circuitSpecifications
      },
      wire: { name: 'Gebouw 1 - Eendraads', pageType: 'onewire' },
      'other-wire': { name: 'Gebouw 2 - Eendraads', pageType: 'onewire' }
    }
  } as Project

  const linked = linkGroundPlanToOneWirePage(project, 'upper', 'wire')

  assert.deepEqual(linkedGroundplanPageKeys(linked, 'wire'), ['ground', 'upper'])
  assert.equal(explicitLinkedPageKey(linked, 'wire'), 'ground')
  assert.equal(linked.pages.wire.electricalProfile, electricalProfile)
  assert.equal(linked.pages.wire.circuitSpecifications, circuitSpecifications)
  assert.equal(linked.pages.wire.oneWireTopology, oneWireTopology)
  assert.equal(linked.pages['other-wire'].electricalProfile, undefined)
})

test('groups one-wire overflow sheets only with their linked building diagram', () => {
  const project = {
    pages: {
      buildingA: { name: 'Gebouw A', pageType: 'groundplan', linkedOneWirePageKey: 'wireA' },
      buildingB: { name: 'Gebouw B', pageType: 'groundplan', linkedOneWirePageKey: 'wireB' },
      wireA: { name: 'Schema A', pageType: 'onewire' },
      wireAOverflow: { name: 'Schema A · vervolg 1', pageType: 'onewire', oneWireOverflowOf: 'wireA' },
      wireB: { name: 'Schema B', pageType: 'onewire' },
      wireBOldOverflow: { name: 'Schema B · vervolg 1', pageType: 'onewire', oneWireOverflowOf: 'wireB' }
    }
  } as Project

  assert.deepEqual(oneWireGenerationPageKeys(project, 'wireA'), ['wireA', 'wireAOverflow'])
  assert.equal(explicitLinkedPageKey(project, 'wireBOldOverflow'), 'buildingB')
})

test('only removes obsolete automatic sheets whose complete content is represented on retained sheets', () => {
  const generated: Shape = { id: 'a', kind: 'text', text: 'A', position: { x: 200, y: 200 }, scale: 1,
    generationKey: 'board:A:label' }
  const page = (name: string, shapes: Shape[]): Project['pages'][string] => ({
    name, pageType: 'onewire', creationTime: 1, schema: { version: 'native-svg-1', objects: [
      { kind: 'cadle-native-svg-document', payload: { version: 2, shapes, worldWidth: 2376, worldHeight: 1680,
        paperPreset: 'a4-landscape', printMargin: 10, selectedId: null } }
    ] }
  })
  const project = { pages: {
    root: page('One-wire diagram', [generated]),
    stale: page('One-wire diagram 2', [generated, { id: 'legacy-header', kind: 'text',
      text: 'KAST MAIN · BLAD E2 · VAN E1 · VERVOLG E3', position: { x: 200, y: 1200 },
      generationKey: 'board:main:sheet-reference', sourceLink: { kind: 'board', id: 'main', role: 'sheet-reference:main' } }]),
    manual: page('One-wire diagram 3', [generated, { ...generated, id: 'note', generationKey: undefined }]),
    locked: page('One-wire diagram 4', [{ ...generated, locked: true }]),
    unmatched: page('One-wire diagram 5', [{ ...generated, generationKey: 'board:B:label' }]),
    unknown: { ...page('One-wire diagram 6', [generated]), schema: { version: 'legacy', objects: [{ kind: 'image' }] } },
    malformed: { ...page('One-wire diagram 7', [generated]), schema: { version: 'native-svg-1', objects: [
      { kind: 'cadle-native-svg-document', payload: { shapes: [{ kind: 'unknown' }], worldWidth: 2376, worldHeight: 1680,
        paperPreset: 'a4-landscape', printMargin: 10 } }
    ] } },
    empty: { ...page('One-wire diagram 8', []), schema: { version: 'native-svg-1', objects: [] } },
    custom: page('Eigen extra schema', [generated]),
    overflow: { ...page('Vervolg', [generated]), oneWireOverflowOf: 'stale' as UUID }
  } } as Project
  const keys = oneWireGenerationPageKeys(project, 'root')
  assert.ok(keys.includes('overflow'))
  assert.ok(!keys.includes('custom'))
  assert.deepEqual(redundantOneWirePageKeys(project, keys, new Set(['root'])), ['stale', 'empty', 'overflow'])
  assert.deepEqual(redundantOneWirePageKeys(project, keys, new Set(['root', 'stale'])), ['empty', 'overflow'])
})

test('groups multiple situation and one-wire sheets without adopting another building or treating manual sheets as overflow', async () => {
  const project = {
    pages: {
      lower: { name: 'Gebouw 1 gelijkvloers', pageType: 'groundplan', linkedOneWirePageKey: 'supply' },
      upper: { name: 'Gebouw 1 verdieping', pageType: 'groundplan', linkedOneWirePageKey: 'circuits' },
      other: { name: 'Gebouw 2', pageType: 'groundplan', linkedOneWirePageKey: 'other-wire' },
      supply: { name: 'Voeding', pageType: 'onewire',
        electricalProfile: { boards: [{ id: 'main', name: 'Hoofdkast' }, { id: 'garage', name: 'Garage' }] },
        circuitSpecifications: { A: { breakerCurrentA: 20 } } },
      circuits: { name: 'Kringen blad 1', pageType: 'onewire', schema: { version: 'native-svg-1', objects: [] } },
      continuation: { name: 'Kringen blad 2', pageType: 'onewire', oneWireOverflowOf: 'circuits' },
      automatic: { name: 'Voeding vervolg', pageType: 'onewire', oneWireOverflowOf: 'supply' },
      'other-wire': { name: 'Ander gebouw', pageType: 'onewire' }
    }
  } as Project
  const grouped = linkOneWirePageToInstallation(project, 'circuits', 'supply')
  assert.equal(project.pages.circuits.oneWireInstallationOf, undefined)
  assert.equal(oneWireInstallationRootKey(grouped, 'continuation'), 'supply')
  assert.equal(oneWireInstallationRootKey(grouped, 'upper'), 'supply')
  assert.deepEqual(linkedGroundplanPageKeys(grouped, 'circuits'), ['lower', 'upper'])
  assert.deepEqual(installationOneWirePageKeys(grouped, 'upper'), ['supply', 'circuits', 'continuation', 'automatic'])
  for (const key of ['lower', 'upper', 'supply', 'circuits', 'continuation']) {
    assert.equal(electricalSettingsPageKey(grouped, key), 'supply')
  }
  assert.deepEqual(oneWireGenerationPageKeys(grouped, 'circuits'), ['supply', 'automatic'])
  assert.deepEqual(redundantOneWirePageKeys(grouped, ['circuits'], new Set(['supply'])), [])
  assert.equal(explicitLinkedPageKey(grouped, 'upper'), 'supply')
  assert.equal(explicitLinkedPageKey(grouped, 'continuation'), 'lower')
  const relinked = linkGroundPlanToOneWirePage(grouped, 'upper', 'continuation')
  assert.equal(relinked.pages.upper.linkedOneWirePageKey, 'supply')
  const ensured = await ensureOneWirePage('project' as UUID, grouped, {
    addPage: async () => { throw new Error('Do not add another installation.') },
    getProjectData: async () => grouped,
    setProjectData: async () => {}
  }, 'upper')
  assert.equal(ensured?.pageKey, 'supply')
  assert.equal(oneWireInstallationRootKey(grouped, 'other'), 'other-wire')
})

test('detaching a manual sheet preserves the drawing and copies shared settings without mutable aliases', () => {
  const project = { pages: {
    root: { name: 'Installatie', pageType: 'onewire', circuitSpecifications: { A: { breakerCurrentA: 40 } } },
    child: { name: 'Tweede blad', pageType: 'onewire', oneWireInstallationOf: 'root',
      oneWireOverflowOf: 'root', schema: { version: 'native-svg-1', objects: [{ kind: 'manual-note' }] } }
  } } as Project
  const detached = linkOneWirePageToInstallation(project, 'child', 'child')
  assert.equal(oneWireInstallationRootKey(detached, 'child'), 'child')
  assert.equal(detached.pages.child.oneWireOverflowOf, undefined)
  assert.deepEqual(detached.pages.child.schema, project.pages.child.schema)
  assert.equal(detached.pages.child.circuitSpecifications?.A.breakerCurrentA, 40)
  detached.pages.child.circuitSpecifications!.A.breakerCurrentA = 63
  assert.equal(project.pages.root.circuitSpecifications?.A.breakerCurrentA, 40)
})

test('installation links reject invalid targets and cycles', () => {
  const project = { pages: {
    root: { pageType: 'onewire' },
    child: { pageType: 'onewire', oneWireInstallationOf: 'root' },
    loopA: { pageType: 'onewire', oneWireInstallationOf: 'loopB' },
    loopB: { pageType: 'onewire', oneWireInstallationOf: 'loopA' }
  } } as Project
  assert.equal(oneWireInstallationRootKey(project, 'loopA'), null)
  assert.deepEqual(installationOneWirePageKeys(project, 'loopA'), [])
  assert.throws(() => linkOneWirePageToInstallation(project, 'root', 'child'), /eigen vervolgblad/)
  assert.throws(() => linkOneWirePageToInstallation(project, 'child', 'missing'), /geldige installatie/)
})

test('moving an automatic continuation to another installation makes it a preserved manual sheet', () => {
  const project = { pages: {
    root: { name: 'Root', pageType: 'onewire' },
    other: { name: 'Other', pageType: 'onewire' },
    child: { name: 'Continuation', pageType: 'onewire', oneWireOverflowOf: 'root' }
  } } as Project
  const moved = linkOneWirePageToInstallation(project, 'child', 'other')
  assert.equal(moved.pages.child.oneWireOverflowOf, undefined)
  assert.equal(oneWireInstallationRootKey(moved, 'child'), 'other')
  assert.equal(explicitLinkedPageKey(moved, 'child'), '')
  assert.equal(explicitLinkedPageKey(moved, 'other'), '')
  assert.deepEqual(oneWireGenerationPageKeys(moved, 'root'), ['root'])
  assert.deepEqual(oneWireGenerationPageKeys(moved, 'other'), ['other'])
})

test('legacy automatic continuations without explicit installation membership retain project-wide sources and settings', () => {
  const project = { pages: {
    plan: { name: 'Groundplan', pageType: 'groundplan' },
    root: { name: 'One-wire diagram', pageType: 'onewire' },
    continuation: { name: 'Vervolg', pageType: 'onewire', oneWireOverflowOf: 'root' },
    legacy: { name: 'One-wire diagram 2', pageType: 'onewire' }
  } } as Project
  assert.equal(electricalSettingsPageKey(project, 'root'), undefined)
  assert.equal(electricalSettingsPageKey(project, 'continuation'), undefined)
  assert.equal(explicitLinkedPageKey(project, 'continuation'), null)
  assert.deepEqual(oneWireGenerationPageKeys(project, 'root'), ['root', 'legacy', 'continuation'])
})
