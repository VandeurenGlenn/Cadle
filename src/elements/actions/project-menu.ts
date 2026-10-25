export type ProjectMenuAction = {
  title: string
  action: string
  icon: string
}

export type ProjectMenuGroupId = 'new' | 'import' | 'export'

export type ProjectMenuGroup = {
  id: ProjectMenuGroupId
  title: string
  items: ProjectMenuAction[]
}

export const PROJECT_MENU_PRIMARY_ACTIONS: ProjectMenuAction[] = [
  { title: 'Open project', action: 'open', icon: 'folder_open' },
  { title: 'Project details', action: 'edit-project-details', icon: 'edit' }
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
      { title: 'Import old plan from PDF', action: 'import-pdf', icon: 'picture_as_pdf' },
      { title: 'Upload project', action: 'upload', icon: 'upload_file' },
      { title: 'Import drawing JSON', action: 'import-json', icon: 'data_object' }
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
  }
]
