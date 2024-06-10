import ProjectsStore from '../storage/projects.js'
import { Project, ProjectInput } from '../types.js'

export const projectStore = new ProjectsStore()

export const get = (key) => projectStore.get(key)

export const del = (key) => projectStore.delete(key)

export const set = (key, value) => projectStore.set(key, value)


export const create = async (project: ProjectInput, pageName) => {
  const creationTime = new Date().getTime()
  const uuid = crypto.randomUUID()
  const pageUuid = crypto.randomUUID()
  const pages = {}
  pages[pageUuid] = {
    name: pageName
  }
  const _project = {creationTime, ...project, pages}
  await projectStore.set(uuid, _project)
  return 
}

export const upload = async () => {
  
}