import Storage from '@leofcoin/storage'
import type { PDFImporter } from '../elements/pdf-importer.js'
import { Project, ProjectInput, type PageType, UUID } from '../types.js'
import { safeExportName } from '../shell/export-commands.js'

export const decoder = new TextDecoder()

export const projectStore = new Storage('projects', 'cadle')

export const projectDataStore = new Storage('project-data', 'cadle')

await projectStore.init()
await projectDataStore.init()

/** */
export const getProjects = async () => {
  const projects: [string, string][] = []
  for await (const [key, projectName] of await projectStore.iterate()) {
    projects.push([key, await (await projectName.getFile()).text()])
  }
  return projects
}

export const getProjectData = async (uuid: UUID) =>
  JSON.parse(decoder.decode(await projectDataStore.get(uuid))) as Promise<Project>

export const setProjectData = (uuid: UUID, project: Project) => projectDataStore.put(uuid, JSON.stringify(project))

export const keys = () => projectStore.keys()

export const get = (key) => projectStore.get(key)

export const del = async (key: string) => {
  await projectStore.delete(key)
  await projectDataStore.delete(key)
}

export const renameProject = async (key: string, nextName: string) => {
  await projectStore.put(key, nextName)
  try {
    const project = await getProjectData(key as UUID)
    project.name = nextName
    await setProjectData(key as UUID, project)
  } catch {
    // Keep index rename even if metadata payload is missing/corrupt.
  }
}

export const set = (key, value) => projectStore.put(key, value)

export const create = async (project: ProjectInput, pageName: string) => {
  const creationTime = new Date().getTime()
  const uuid = crypto.randomUUID()

  const pageUuid = crypto.randomUUID()
  const pages: Project['pages'] = {}
  pages[pageUuid] = {
    creationTime,
    name: pageName,
    pageType: 'groundplan',
    schema: { version: '6.0.0', objects: [] },
    order: 0
  }
  const _project = { creationTime, ...project, pages }
  await projectDataStore.put(uuid, JSON.stringify(_project))
  await projectStore.put(uuid, project.name)

  cadleShell.projects = await getProjects()
  cadleShell.project = (await getProjectData(uuid as UUID)) as Project
  cadleShell.projectKey = uuid as UUID
  await cadleShell.loadPage(pageUuid)
  location.hash = `#!/editor/model?project=${uuid}&page=${pageUuid}`
  return
}

export const addPage = async (uuid: UUID, pageName: string, schema, pageType: PageType = 'groundplan') => {
  const project = await getProjectData(uuid)
  const pageUuid = crypto.randomUUID() as UUID
  const maxOrder = Math.max(
    -1,
    ...Object.values(project.pages ?? {}).map((page) => (typeof page.order === 'number' ? page.order : -1))
  )
  project.pages[pageUuid] = {
    creationTime: Date.now(),
    name: pageName,
    pageType,
    schema,
    order: maxOrder + 1
  }
  await setProjectData(uuid, project)
}

export const save = async () => {
  await cadleShell.savePage()
  await setProjectData(cadleShell.projectKey, cadleShell.project)
  if (cadleShell.project.uuid) {
    // If needed, save project metadata separately here.
  }
}

export const share = () => {
  cadleShell.openProjectShareDialog()
}

export const importProjectPayload = async (payload: Project & { projectKey?: string }) => {
  const projectKey = payload.projectKey
  if (!projectKey || !payload.name || !payload.pages || typeof payload.pages !== 'object') {
    throw new Error('Invalid Cadle project payload')
  }
  const project = { ...payload }
  delete project.projectKey
  if (await projectDataStore.has(projectKey)) {
    const overwrite = confirm(`“${project.name}” bestaat al. Wil je het overschrijven?`)
    if (!overwrite) return false
  }
  await projectDataStore.put(projectKey, JSON.stringify(project))
  await projectStore.put(projectKey, project.name)
  cadleShell.projects = await getProjects()
  return true
}

export const upload = async () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.addEventListener('change', () => {
    const fr = new FileReader()

    fr.onload = async (e) => {
      const payload = e.target?.result
      if (typeof payload !== 'string') return
      let result: Project & { projectKey?: string }
      try {
        result = JSON.parse(payload) as Project & { projectKey?: string }
      } catch {
        globalThis.alert('This file is not a valid Cadle project.')
        return
      }
      if (!result.projectKey || !result.name || !result.pages || typeof result.pages !== 'object') {
        globalThis.alert('This Cadle project is incomplete or damaged.')
        return
      }
      await importProjectPayload(result)
    }

    fr.readAsText(input.files[0])
  }, { once: true })
  input.click()
}

export const download = async () => {
  await cadleShell.savePage()
  const projectName = safeExportName(cadleShell.project.name)
  await cadleShell.exportProjectPdf(`${projectName}.pdf`)

  const projectData = { ...cadleShell.project, projectKey: cadleShell.projectKey }
  const blob = new Blob([JSON.stringify(projectData, null, 2)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${projectName}-${cadleShell.projectKey}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export const importPlan = async () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/pdf'
  input.addEventListener('change', async () => {
    const file = input.files[0]
    if (!file) return

    await import('../elements/pdf-importer.js')
    // Show PDF importer dialog
    const importer = document.createElement('pdf-importer')
    const dialog = document.createElement('dialog')

    dialog.style.cssText = `
      width: 90vw;
      height: 90vh;
      max-width: 1200px;
      max-height: 800px;
      border: none;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      padding: 0;
    `

    // Handle import completion
    const handleImportComplete = async (event: CustomEvent) => {
      dialog.close()
      dialog.remove()
      cadleShell.projects = await getProjects()
      void event.detail.pagesImported
    }

    // Handle import cancellation
    const handleImportCancel = () => {
      dialog.close()
      dialog.remove()
    }

    importer.addEventListener('import-complete', handleImportComplete, { once: true })
    importer.addEventListener('import-cancel', handleImportCancel, { once: true })

    dialog.appendChild(importer)
    document.body.appendChild(dialog)
    dialog.showModal()

    // Load PDF into importer
    const typedImporter = importer as PDFImporter
    await typedImporter.loadPDF(file)
  }, { once: true })
  input.click()
}
