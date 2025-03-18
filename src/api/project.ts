import Storage from '@leofcoin/storage'
import jsPDF from 'jspdf'
import { Project, ProjectInput, UUID } from '../types.js'

export const decoder = new TextDecoder()

export const projectStore = new Storage('projects', 'cadle')

export const projectDataStore = new Storage('project-data', 'cadle')

await projectStore.init()
await projectDataStore.init()

console.log('projectStore', projectStore)
console.log(await projectStore.keys())
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

export const del = (key) => projectStore.delete(new TextEncoder().encode(key))

export const set = (key, value) => projectStore.put(key, value)

export const create = async (project: ProjectInput, pageName) => {
  const creationTime = new Date().getTime()
  const uuid = crypto.randomUUID()

  const pageUuid = crypto.randomUUID()
  const pages = {}
  pages[pageUuid] = {
    name: pageName
  }
  const _project = { creationTime, ...project, pages }
  await projectDataStore.put(uuid, JSON.stringify(_project))
  await projectStore.put(uuid, project.name)

  cadleShell.pages.select('projects')
  cadleShell.projects = await getProjects()
  return
}

export const addPage = async (uuid: UUID, pageName: string, schema) => {
  const project = await getProjectData(uuid)
  const pageUuid = crypto.randomUUID() as UUID
  project.pages[pageUuid] = { name: pageName, schema }
  await setProjectData(uuid, project)
}

export const save = async () => {
  await cadleShell.savePage()
  console.log(cadleShell.project)
  await setProjectData(cadleShell.projectKey, cadleShell.project)
  if (cadleShell.project.uuid) {
    // await set(cadleShell.project.uuid, cadleShell.project.name ?? cadleShell.projectName)
  }
  // await setProjectData(cadleShell.project.uuid ?? new TextEncoder().encode(cadleShell.projectName), cadleShell.project)
}

export const share = () => {
  const project = JSON.stringify({
    name: cadleShell.projectName,
    schema: cadleShell.renderRoot.querySelector('draw-field')?.toJSON()
  })
  const data = {
    title: cadleShell.projectName,
    url: `https://vandeurenglenn.github.io/Cadle?import=${new TextEncoder().encode(project).join(',')}`
  }

  console.log(`https://vandeurenglenn.github.io/Cadle?import=${new TextEncoder().encode(project).join(',')}`)

  navigator.share(data)
}

export const upload = async () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.addEventListener('change', (e) => {
    var fr = new FileReader()

    fr.onload = async (e) => {
      console.log(e.target.result)
      console.log(e)

      var result = JSON.parse(e.target.result)
      console.log(result)
      const projectKey = result.projectKey
      delete result.projectKey
      if (await projectDataStore.has(projectKey)) {
        if (confirm('Project already exists, do you want to overwrite it?')) {
          await projectDataStore.put(projectKey, JSON.stringify(result))
          await projectStore.put(projectKey, result.name)
          cadleShell.projects = await getProjects()
        }
      } else {
        await projectDataStore.put(projectKey, JSON.stringify(result))
        await projectStore.put(projectKey, result.name)
        cadleShell.projects = await getProjects()
      }
    }

    fr.readAsText(input.files[0])
  })
  input.click()
}

export const download = async () => {
  console.log('down')

  // const fields: DrawField[] = Array.from(this.renderRoot.querySelectorAll('draw-field'))
  const pdf = new jsPDF({ format: 'a4', unit: 'px', orientation: 'landscape', dpi: 300 })
  // only jpeg is supported by jsPDF
  console.log(cadleShell.project)

  let i = 0
  for (const [key, page] of Object.entries(cadleShell.project.pages)) {
    await cadleShell.loadPage(key)
    const dataUrl = await cadleShell.toPNG()
    // const svg = await cadleShell.field.canvas.toSVG()

    if (i !== 0) pdf.addPage('a4', 'landscape')
    // @ts-ignore
    pdf.addImage(dataUrl, 'a4', 0, 0, cadleShell.field.canvas.width / 2, cadleShell.field.canvas.height / 2)
    // pdf.addSvgAsImage(svg, 0, 0, undefined, undefined, { autoPaging: true })
    // URL.revokeObjectURL(dataUrl)
    i += 1
  }

  pdf.save(`${cadleShell.project.name}.pdf`)

  const projectData = { ...cadleShell.project, projectKey: cadleShell.projectKey }
  const blob = new Blob([JSON.stringify(projectData, null, 2)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${cadleShell.project.name}-${cadleShell.projectKey}.json`
  a.click()
  URL.revokeObjectURL(url)
  // };
  // for (const field of fields) {
  //   const json = field.toJSON()
  //   console.log(json)
  //   // await this.renderRoot.querySelector('draw-field').loadFromJSON(json)

  //   const url = this.renderRoot.querySelector('draw-field').toDataURL()
  //   console.log(url)
  //   const a = document.createElement('a')
  //   a.href = url
  //   a.download = `${this.loadedPage}.png`
  //   a.click()
  // }
}
