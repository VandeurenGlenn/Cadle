import type { Project, UUID } from '../types.js'
import { getProjectData, getProjects, projectDataStore, projectStore } from '../api/project.js'

export const BACKUP_VERSION = 1
export const BACKUP_FILE_NAME = 'cadle-backup.json'
export const LAST_BACKUP_KEY = 'cadle.backup.last-completed-at'

export type ProjectBackup = {
  format: 'cadle-backup'
  version: number
  createdAt: string
  projects: Array<{ projectKey: string; project: Project }>
}

type FileSystemWritableFileStreamLike = { write(data: Blob | string): Promise<void>; close(): Promise<void> }
export type DirectoryHandleLike = {
  name: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<FileSystemWritableFileStreamLike> }>
  queryPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandleLike>
  }
}

const HANDLE_DATABASE = 'cadle-backup'
const HANDLE_STORE = 'settings'
const HANDLE_KEY = 'directory-handle'

export const createProjectBackup = async (): Promise<ProjectBackup> => {
  const projects = await getProjects()
  return {
    format: 'cadle-backup',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    projects: await Promise.all(projects.map(async ([projectKey]) => ({ projectKey, project: await getProjectData(projectKey as UUID) })))
  }
}

export const parseProjectBackup = (value: unknown): ProjectBackup => {
  if (!value || typeof value !== 'object') throw new Error('Dit is geen geldige Cadle-back-up.')
  const backup = value as Partial<ProjectBackup>
  if (backup.format !== 'cadle-backup' || backup.version !== BACKUP_VERSION || !Array.isArray(backup.projects)) {
    throw new Error('Deze back-upversie wordt niet ondersteund.')
  }
  for (const entry of backup.projects) {
    if (!entry || typeof entry.projectKey !== 'string' || !entry.project || typeof entry.project.name !== 'string' || !entry.project.pages || typeof entry.project.pages !== 'object') {
      throw new Error('De back-up bevat ongeldige projectgegevens.')
    }
  }
  return backup as ProjectBackup
}

export const restoreProjectBackup = async (backup: ProjectBackup): Promise<number> => {
  const validated = parseProjectBackup(backup)
  for (const { projectKey, project } of validated.projects) {
    await projectDataStore.put(projectKey, JSON.stringify(project))
    await projectStore.put(projectKey, project.name)
  }
  return validated.projects.length
}

export const downloadProjectBackup = async (): Promise<ProjectBackup> => {
  const backup = await createProjectBackup()
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `cadle-backup-${backup.createdAt.slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  markBackupCompleted(backup.createdAt)
  return backup
}

const openHandleDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(HANDLE_DATABASE, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE)
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const handleTransaction = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
  const database = await openHandleDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(database.transaction(HANDLE_STORE, mode).objectStore(HANDLE_STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { database.close() }
}

export const saveBackupDirectory = (handle: DirectoryHandleLike) => handleTransaction('readwrite', (store) => store.put(handle, HANDLE_KEY))
export const getBackupDirectory = () => handleTransaction<DirectoryHandleLike | undefined>('readonly', (store) => store.get(HANDLE_KEY))
export const forgetBackupDirectory = () => handleTransaction('readwrite', (store) => store.delete(HANDLE_KEY))

export const chooseBackupDirectory = async (): Promise<DirectoryHandleLike> => {
  if (!window.showDirectoryPicker) throw new Error('Je browser ondersteunt het koppelen van een map niet.')
  const handle = await window.showDirectoryPicker({ id: 'cadle-backup', mode: 'readwrite' })
  await saveBackupDirectory(handle)
  return handle
}

export const writeBackupToDirectory = async (handle: DirectoryHandleLike): Promise<ProjectBackup> => {
  const permission = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt'
  if (permission !== 'granted' && (await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') {
    throw new Error('Cadle heeft geen schrijftoegang tot deze map.')
  }
  const backup = await createProjectBackup()
  const writable = await (await handle.getFileHandle(BACKUP_FILE_NAME, { create: true })).createWritable()
  await writable.write(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
  await writable.close()
  markBackupCompleted(backup.createdAt)
  return backup
}

export const markBackupCompleted = (createdAt: string) => localStorage.setItem(LAST_BACKUP_KEY, createdAt)
export const readLastBackupAt = (): Date | null => {
  const stored = localStorage.getItem(LAST_BACKUP_KEY)
  if (!stored) return null
  const date = new Date(stored)
  return Number.isNaN(date.getTime()) ? null : date
}
