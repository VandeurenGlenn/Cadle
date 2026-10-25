import assert from 'node:assert/strict'
import test from 'node:test'
import {
  migrateOneWireProjectPages,
  nativeStateForProjectPage,
  type NativeDocumentState
} from '../src/data/project-document.ts'
import type { Project, UUID } from '../src/types.ts'

const PAGE_A = '00000000-0000-4000-8000-000000000001' as UUID
const PAGE_B = '00000000-0000-4000-8000-000000000002' as UUID
const GROUND_PAGE = '00000000-0000-4000-8000-000000000003' as UUID

const nativeState = (oneWireLayoutVersion?: number): NativeDocumentState => ({
  version: 2,
  ...(typeof oneWireLayoutVersion === 'number' ? { oneWireLayoutVersion } : {}),
  shapes: [],
  selectedId: null,
  paperPreset: 'a4-landscape',
  printMargin: 10,
  worldWidth: 1000,
  worldHeight: 700
})

const page = (pageType: 'groundplan' | 'onewire', state: NativeDocumentState) => ({
  creationTime: 1,
  name: pageType,
  pageType,
  schema: {
    version: 'native-svg-1',
    objects: [{ kind: 'cadle-native-svg-document', payload: state }]
  }
})

const project = (): Project => ({
  creationTime: 1,
  uuid: '00000000-0000-4000-8000-000000000000' as UUID,
  name: 'Migration test',
  customer: { name: '', lastname: '' },
  installer: { name: '', lastname: '' },
  company: '',
  address: { street: '', number: '', postalCode: '', city: '' },
  pages: {
    [PAGE_A]: page('onewire', nativeState(8)),
    [PAGE_B]: page('onewire', nativeState()),
    [GROUND_PAGE]: page('groundplan', nativeState())
  }
})

test('migrates every outdated one-wire page while leaving other page types untouched', () => {
  const input = project()
  const migratedPages: UUID[] = []
  const changed = migrateOneWireProjectPages(input, 11, (state, pageKey) => {
    migratedPages.push(pageKey)
    return { ...state, oneWireLayoutVersion: 11 }
  })

  assert.equal(changed, true)
  assert.deepEqual(migratedPages, [PAGE_A, PAGE_B])
  assert.equal(nativeStateForProjectPage(input, PAGE_A)?.oneWireLayoutVersion, 11)
  assert.equal(nativeStateForProjectPage(input, PAGE_B)?.oneWireLayoutVersion, 11)
  assert.equal(nativeStateForProjectPage(input, GROUND_PAGE)?.oneWireLayoutVersion, undefined)
})

test('does not stamp a page when its migration cannot be completed', () => {
  const input = project()
  const changed = migrateOneWireProjectPages(input, 11, (state, pageKey) =>
    pageKey === PAGE_A ? { ...state, oneWireLayoutVersion: 11 } : null
  )

  assert.equal(changed, true)
  assert.equal(nativeStateForProjectPage(input, PAGE_A)?.oneWireLayoutVersion, 11)
  assert.equal(nativeStateForProjectPage(input, PAGE_B)?.oneWireLayoutVersion, undefined)
})
