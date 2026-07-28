import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROJECT_MENU_GROUPS,
  PROJECT_MENU_PRIMARY_ACTIONS
} from '../src/elements/actions/project-menu.ts'

test('keeps the file menu compact and groups every action once', () => {
  const actions = [
    ...PROJECT_MENU_PRIMARY_ACTIONS,
    ...PROJECT_MENU_GROUPS.flatMap((group) => group.items)
  ].map((item) => item.action)

  assert.equal(PROJECT_MENU_PRIMARY_ACTIONS.length + PROJECT_MENU_GROUPS.length, 6)
  assert.equal(new Set(actions).size, actions.length)
  assert.deepEqual(PROJECT_MENU_GROUPS.map((group) => group.id), [
    'new',
    'import',
    'export',
    'onewire',
    'tools'
  ])
})

test('keeps project, import, export and one-wire commands discoverable', () => {
  const groupedActions = Object.fromEntries(
    PROJECT_MENU_GROUPS.map((group) => [group.id, group.items.map((item) => item.action)])
  )

  assert.deepEqual(groupedActions.new, ['create', 'new-from-template'])
  assert.deepEqual(groupedActions.import, ['import-pdf', 'upload', 'import-json', 'import-custom-symbol'])
  assert.deepEqual(groupedActions.export, [
    'download',
    'export-pdf',
    'export-json',
    'print-svg',
    'export-bom',
    'share'
  ])
  assert.deepEqual(groupedActions.onewire, ['validate-bindings', 'describe-one-wire', 'generate-one-wire'])
})

test('keeps a visible icon for every direct and nested file action', () => {
  const actions = [
    ...PROJECT_MENU_PRIMARY_ACTIONS,
    ...PROJECT_MENU_GROUPS.flatMap((group) => group.items)
  ]

  assert.ok(actions.every((action) => action.icon.length > 0))
  assert.equal(actions.find((action) => action.action === 'describe-one-wire')?.icon, 'account_tree')
  assert.equal(actions.find((action) => action.action === 'open-onewire-training-data')?.icon, 'dataset')
})
