import assert from 'node:assert/strict'
import test from 'node:test'
import { PROJECT_MENU_GROUPS, PROJECT_MENU_PRIMARY_ACTIONS } from '../src/elements/actions/project-menu.ts'

test('keeps the file menu compact and groups every document action once', () => {
  const actions = [...PROJECT_MENU_PRIMARY_ACTIONS, ...PROJECT_MENU_GROUPS.flatMap((group) => group.items)].map(
    (item) => item.action
  )

  assert.equal(PROJECT_MENU_PRIMARY_ACTIONS.length + PROJECT_MENU_GROUPS.length, 5)
  assert.equal(new Set(actions).size, actions.length)
  assert.deepEqual(
    PROJECT_MENU_GROUPS.map((group) => group.id),
    ['new', 'import', 'export']
  )
})

test('keeps project, import and export commands discoverable', () => {
  const groupedActions = Object.fromEntries(
    PROJECT_MENU_GROUPS.map((group) => [group.id, group.items.map((item) => item.action)])
  )

  assert.deepEqual(groupedActions.new, ['create', 'new-from-template'])
  assert.deepEqual(groupedActions.import, ['import-pdf', 'upload', 'import-json'])
  assert.deepEqual(groupedActions.export, ['download', 'export-pdf', 'export-json', 'print-svg', 'export-bom', 'share'])
  assert.deepEqual(
    PROJECT_MENU_PRIMARY_ACTIONS.map((item) => item.action),
    ['open', 'edit-project-details']
  )
})

test('keeps a visible icon for every direct and nested file action', () => {
  const actions = [...PROJECT_MENU_PRIMARY_ACTIONS, ...PROJECT_MENU_GROUPS.flatMap((group) => group.items)]

  assert.ok(actions.every((action) => action.icon.length > 0))
  assert.equal(
    actions.some((action) => action.action === 'import-custom-symbol'),
    false
  )
  assert.equal(
    actions.some((action) => action.action === 'generate-one-wire'),
    false
  )
})
