export type ProjectMenuAction = {
  title: string
  action: string
  icon: string
}

export type ProjectMenuGroupId = 'new' | 'import' | 'export' | 'onewire' | 'tools'

export type ProjectMenuGroup = {
  id: ProjectMenuGroupId
  title: string
  items: ProjectMenuAction[]
}

export const PROJECT_MENU_PRIMARY_ACTIONS: ProjectMenuAction[] = [
  { title: 'Open project', action: 'open', icon: 'folder_open' }
]

export const PROJECT_MENU_GROUPS: ProjectMenuGroup[] = [
  {
    id: 'new',
    title: 'New',
    items: [
      { title: 'Create project', action: 'create', icon: 'create_new_folder' },
      { title: 'New from template', action: 'new-from-template', icon: 'dashboard' }
    ]
  },
  {
    id: 'import',
    title: 'Import',
    items: [
      { title: 'Import plan', action: 'import-pdf', icon: 'upload_file' },
      { title: 'Upload project', action: 'upload', icon: 'upload_file' },
      { title: 'Import drawing JSON', action: 'import-json', icon: 'data_object' },
      { title: 'Import custom symbol', action: 'import-custom-symbol', icon: 'category' }
    ]
  },
  {
    id: 'export',
    title: 'Export & share',
    items: [
      { title: 'Download project', action: 'download', icon: 'download' },
      { title: 'Export PDF', action: 'export-pdf', icon: 'picture_as_pdf' },
      { title: 'Export JSON', action: 'export-json', icon: 'download' },
      { title: 'Print drawing', action: 'print-svg', icon: 'print' },
      { title: 'Export BOM', action: 'export-bom', icon: 'table_view' },
      { title: 'Share project', action: 'share', icon: 'share' }
    ]
  },
  {
    id: 'onewire',
    title: 'One-wire',
    items: [
      { title: 'Validate bindings', action: 'validate-bindings', icon: 'check' },
      { title: 'Describe structure', action: 'describe-one-wire', icon: 'account_tree' },
      { title: 'Generate schema', action: 'generate-one-wire', icon: 'output' }
    ]
  },
  {
    id: 'tools',
    title: 'Project tools',
    items: [
      { title: 'Edit project details', action: 'edit-project-details', icon: 'edit' },
      { title: 'History panel', action: 'toggle-history-panel', icon: 'menu' },
      { title: 'One-wire training data', action: 'open-onewire-training-data', icon: 'dataset' }
    ]
  }
]
