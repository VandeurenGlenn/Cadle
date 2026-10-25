import { BACKUP_FILE_NAME, createProjectBackup, markBackupCompleted, type ProjectBackup } from './project-backup.js'

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
export const GOOGLE_DRIVE_CONNECTED_KEY = 'cadle.backup.google-drive-connected'

type TokenResponse = { access_token?: string; error?: string; error_description?: string }
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

export const googleDriveClientId = () =>
  window.cadleConfig?.googleDriveClientId?.trim() ||
  document.querySelector<HTMLMetaElement>('meta[name="cadle-google-drive-client-id"]')?.content.trim() ||
  ''

export const googleDriveIsConfigured = () => Boolean(googleDriveClientId())
export const googleDriveWasConnected = () => localStorage.getItem(GOOGLE_DRIVE_CONNECTED_KEY) === 'true'

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

const findBackupFileId = async (): Promise<string | undefined> => {
  const query = encodeURIComponent(`name='${BACKUP_FILE_NAME}' and trashed=false`)
  const response = await driveFetch(`${DRIVE_API}?q=${query}&spaces=drive&fields=files(id,name)&pageSize=1`, { method: 'GET' })
  const payload = await response.json() as { files?: Array<{ id: string }> }
  return payload.files?.[0]?.id
}

const multipartBody = (backup: ProjectBackup, boundary: string) => {
  const metadata = JSON.stringify({ name: BACKUP_FILE_NAME, mimeType: 'application/json' })
  const content = JSON.stringify(backup, null, 2)
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
}

export const connectGoogleDrive = async (): Promise<ProjectBackup> => {
  await requestAccessToken(true)
  return backupToGoogleDrive()
}

export const backupToGoogleDrive = async (): Promise<ProjectBackup> => {
  const backup = await createProjectBackup()
  const fileId = await findBackupFileId()
  const boundary = `cadle_${crypto.randomUUID()}`
  const url = fileId
    ? `${DRIVE_UPLOAD_API}/${encodeURIComponent(fileId)}?uploadType=multipart`
    : `${DRIVE_UPLOAD_API}?uploadType=multipart`
  await driveFetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody(backup, boundary)
  })
  markBackupCompleted(backup.createdAt)
  return backup
}

export const disconnectGoogleDrive = async (): Promise<void> => {
  if (accessToken && window.google?.accounts.oauth2) {
    await new Promise<void>((resolve) => window.google!.accounts.oauth2.revoke(accessToken, resolve))
  }
  accessToken = ''
  localStorage.removeItem(GOOGLE_DRIVE_CONNECTED_KEY)
}
