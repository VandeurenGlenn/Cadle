import Storage from '../storage/storage.js'
import jsPDF from 'jspdf'
import { Project, ProjectInput, UUID } from '../types.js'

export const projectStore = new Storage('projects')

export const projectDataStore = new Storage('project-data')

/** */
export const getProjects = () => projectStore.entries() as Promise<[uuid: UUID, name: string][]>

export const getProjectData = (uuid: UUID) => projectDataStore.get(uuid) as Promise<Project>

export const setProjectData = (uuid: UUID, project: Project) => projectDataStore.set(uuid, project)

export const get = (key) => projectStore.get(key)

export const del = (key) => projectStore.delete(new TextEncoder().encode(key))

export const set = (key, value) => projectStore.set(key, value)

export const create = async (project: ProjectInput, pageName) => {
  const creationTime = new Date().getTime()
  const uuid = crypto.randomUUID()
  const pageUuid = crypto.randomUUID()
  const pages = {}
  pages[pageUuid] = {
    name: pageName
  }
  const _project = { creationTime, ...project, pages }
  await projectDataStore.set(uuid, _project)
  await projectStore.set(uuid, project.name)
  return
}

export const save = async () => {
  await cadleShell.savePage()
  await set(new TextEncoder().encode(cadleShell.projectName), cadleShell.project)
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

    fr.onload = (e) => {
      var result = JSON.parse(e.target.result)
      set(new TextEncoder().encode(result.name), result)
    }

    fr.readAsText(input.files[0])
  })
  input.click()
}

export const download = async () => {
  console.log('down')

  // const fields: DrawField[] = Array.from(this.renderRoot.querySelectorAll('draw-field'))
  const pdf = new jsPDF({ format: 'a4', unit: 'px', orientation: 'landscape' })
  // only jpeg is supported by jsPDF
  let i = 0
  for (const page of cadleShell.project.pages) {
    await cadleShell.loadPage(page.name)
    const dataUrl = await cadleShell.toPNG()

    if (i !== 0) pdf.addPage()
    // @ts-ignore
    pdf.addImage(dataUrl, 0, 0)
    // pdf.addSvgAsImage(svg, 0, 0, 1123, 842, undefined, undefined,  90);
    URL.revokeObjectURL(dataUrl)
    i += 1
  }

  pdf.save(`${cadleShell.projectName}.pdf`)
  cadleShell.project.name = cadleShell.projectName
  const blob = new Blob([JSON.stringify(cadleShell.project, null, 2)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${cadleShell.projectName}.json`
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
