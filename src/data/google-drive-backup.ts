import {
  BACKUP_FILE_NAME,
  createProjectBackup,
  markBackupCompleted,
  parseProjectBackup,
  projectBackupFileName,
  type ProjectBackup
} from './project-backup.js'

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
const DRIVE_FOLDER_NAME = 'Cadle Projects'
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
export const GOOGLE_DRIVE_CONNECTED_KEY = 'cadle.backup.google-drive-connected'
export const GOOGLE_DRIVE_RETENTION_KEY = 'cadle.backup.google-drive-retention'
export const GOOGLE_DRIVE_EXIT_BACKUP_KEY = 'cadle.backup.google-drive-on-exit'
export type GoogleDriveRetention = 0 | 3 | 5 | 10

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string }
type TokenClient = { requestAccessToken(options?: { prompt?: string }): void }

declare global {
  interface Window {
    cadleConfig?: { googleDriveClientId?: string }
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(options: {
            client_id: string
            scope: string
            callback(response: TokenResponse): void
            error_callback?(error: { type?: string }): void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | undefined
let accessToken = ''
let accessTokenExpiresAt = 0
let exitBackupInstalled = false
let exitBackupStarted = false

const notifyAuthRequired = () => {
  if (
    document.visibilityState === 'visible' &&
    readGoogleDriveExitBackup() &&
    googleDriveWasConnected() &&
    (!accessToken || Date.now() >= accessTokenExpiresAt)
  ) {
    window.dispatchEvent(new CustomEvent('cadle-google-drive-auth-required'))
  }
}

export const googleDriveClientId = () =>
  window.cadleConfig?.googleDriveClientId?.trim() ||
  document.querySelector<HTMLMetaElement>('meta[name="cadle-google-drive-client-id"]')?.content.trim() ||
  ''

export const googleDriveIsConfigured = () => Boolean(googleDriveClientId())
export const googleDriveWasConnected = () => localStorage.getItem(GOOGLE_DRIVE_CONNECTED_KEY) === 'true'
export const readGoogleDriveRetention = (): GoogleDriveRetention => {
  const value = Number(localStorage.getItem(GOOGLE_DRIVE_RETENTION_KEY) ?? '3')
  return value === 0 || value === 3 || value === 5 || value === 10 ? value : 3
}
export const writeGoogleDriveRetention = (value: GoogleDriveRetention) =>
  localStorage.setItem(GOOGLE_DRIVE_RETENTION_KEY, String(value))
export const readGoogleDriveExitBackup = () => localStorage.getItem(GOOGLE_DRIVE_EXIT_BACKUP_KEY) !== 'false'
export const writeGoogleDriveExitBackup = (enabled: boolean) =>
  localStorage.setItem(GOOGLE_DRIVE_EXIT_BACKUP_KEY, String(enabled))

const loadIdentityServices = (): Promise<void> => {
  if (window.google?.accounts.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`)
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('Google-aanmelding kon niet worden geladen.')), { once: true })
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })
  return scriptPromise
}

const requestAccessToken = async (forceConsent = false): Promise<string> => {
  const clientId = googleDriveClientId()
  if (!clientId) throw new Error('Google Drive is nog niet geconfigureerd voor deze Cadle-installatie.')
  await loadIdentityServices()
  return new Promise((resolve, reject) => {
    const oauth = window.google?.accounts.oauth2
    if (!oauth) return reject(new Error('Google-aanmelding is niet beschikbaar.'))
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || 'Google Drive gaf geen toegang.'))
          return
        }
        accessToken = response.access_token
        accessTokenExpiresAt = Date.now() + Math.max(0, Number(response.expires_in ?? 3600) - 60) * 1000
        localStorage.setItem(GOOGLE_DRIVE_CONNECTED_KEY, 'true')
        resolve(accessToken)
      },
      error_callback: () => reject(new Error('Google-aanmelding werd gesloten of geblokkeerd.'))
    })
    client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' })
  })
}

const driveFetch = async (url: string, init: RequestInit, retry = true): Promise<Response> => {
  const token = accessToken || (await requestAccessToken(false))
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` }
  })
  if (response.status === 401 && retry) {
    accessToken = ''
    await requestAccessToken(false)
    return driveFetch(url, init, false)
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(error?.error?.message || `Google Drive-fout (${response.status}).`)
  }
  return response
}

const findBackupFolder = async (): Promise<{ id: string; name: string } | undefined> => {
  const query = encodeURIComponent(
    `trashed=false and mimeType='${DRIVE_FOLDER_MIME_TYPE}' and appProperties has { key='cadleBackupFolder' and value='true' }`
  )
  const response = await driveFetch(
    `${DRIVE_API}?q=${query}&spaces=drive&fields=files(id,name)&pageSize=1`,
    { method: 'GET' }
  )
  const payload = await response.json() as { files?: Array<{ id: string; name: string }> }
  return payload.files?.[0]
}

const ensureBackupFolder = async (): Promise<{ id: string; name: string }> => {
  const existing = await findBackupFolder()
  if (existing) return existing
  const response = await driveFetch(`${DRIVE_API}?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      appProperties: { cadleBackupFolder: 'true' }
    })
  })
  return response.json() as Promise<{ id: string; name: string }>
}

const findLatestBackupFile = async (folderId?: string): Promise<{ id: string; name: string } | undefined> => {
  const parentQuery = folderId ? `'${folderId}' in parents and ` : ''
  const query = encodeURIComponent(
    `${parentQuery}trashed=false and (name='${BACKUP_FILE_NAME}' or appProperties has { key='cadleBackup' and value='true' })`
  )
  const response = await driveFetch(
    `${DRIVE_API}?q=${query}&spaces=drive&orderBy=createdTime%20desc&fields=files(id,name,createdTime)&pageSize=1`,
    { method: 'GET' }
  )
  const payload = await response.json() as { files?: Array<{ id: string; name: string }> }
  return payload.files?.[0]
}

const pruneDriveBackups = async (folderId: string, keep: GoogleDriveRetention): Promise<void> => {
  if (keep === 0) return
  const query = encodeURIComponent(
    `'${folderId}' in parents and trashed=false and appProperties has { key='cadleBackup' and value='true' }`
  )
  const response = await driveFetch(
    `${DRIVE_API}?q=${query}&spaces=drive&orderBy=createdTime%20desc&fields=files(id)&pageSize=100`,
    { method: 'GET' }
  )
  const payload = await response.json() as { files?: Array<{ id: string }> }
  for (const file of (payload.files ?? []).slice(keep)) {
    await driveFetch(`${DRIVE_API}/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
  }
}

const multipartBody = (backup: ProjectBackup, boundary: string, folderId: string) => {
  const metadata = JSON.stringify({
    name: projectBackupFileName(backup),
    mimeType: 'application/json',
    parents: [folderId],
    appProperties: { cadleBackup: 'true', backupId: backup.backupId }
  })
  const content = JSON.stringify(backup, null, 2)
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
}

export const connectGoogleDrive = async (): Promise<void> => {
  await requestAccessToken(true)
}

export const backupToGoogleDrive = async (): Promise<ProjectBackup> => {
  const backup = await createProjectBackup()
  const folder = await ensureBackupFolder()
  const boundary = `cadle_${crypto.randomUUID()}`
  await driveFetch(`${DRIVE_UPLOAD_API}?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody(backup, boundary, folder.id)
  })
  await pruneDriveBackups(folder.id, readGoogleDriveRetention())
  markBackupCompleted(backup.createdAt)
  return backup
}

export const readBackupFromGoogleDrive = async (): Promise<ProjectBackup> => {
  const folder = await findBackupFolder()
  const file = (folder ? await findLatestBackupFile(folder.id) : undefined) ?? (await findLatestBackupFile())
  if (!file) throw new Error('Geen Cadle-back-up gevonden in Google Drive.')
  const response = await driveFetch(`${DRIVE_API}/${encodeURIComponent(file.id)}?alt=media`, { method: 'GET' })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('De Google Drive-back-up bevat geen geldige JSON.')
  }
  return parseProjectBackup(payload)
}

export const disconnectGoogleDrive = async (): Promise<void> => {
  if (accessToken && window.google?.accounts.oauth2) {
    await new Promise<void>((resolve) => window.google!.accounts.oauth2.revoke(accessToken, resolve))
  }
  accessToken = ''
  accessTokenExpiresAt = 0
  localStorage.removeItem(GOOGLE_DRIVE_CONNECTED_KEY)
}

const tryExitBackup = () => {
  if (
    exitBackupStarted ||
    !readGoogleDriveExitBackup() ||
    !googleDriveWasConnected() ||
    !accessToken ||
    Date.now() >= accessTokenExpiresAt
  ) return
  exitBackupStarted = true
  void backupToGoogleDrive().catch((error) => {
    console.warn('Drive-back-up bij afsluiten is niet voltooid', error)
  })
}

export const installGoogleDriveExitBackup = () => {
  if (exitBackupInstalled) return
  exitBackupInstalled = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') tryExitBackup()
    else {
      exitBackupStarted = false
      notifyAuthRequired()
    }
  })
  window.addEventListener('pagehide', tryExitBackup)
  queueMicrotask(notifyAuthRequired)
}
