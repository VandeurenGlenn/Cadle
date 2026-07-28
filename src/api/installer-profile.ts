import Storage from '@leofcoin/storage'

export type InstallerProfile = {
  name: string
  lastname: string
  company: string
  btw: string
}

const PROFILE_KEY = 'default'
const decoder = new TextDecoder()
const installerProfileStore = new Storage('installer-profile', 'cadle')

await installerProfileStore.init()

const cleanProfile = (value: Partial<InstallerProfile> | undefined): InstallerProfile => ({
  name: typeof value?.name === 'string' ? value.name.trim() : '',
  lastname: typeof value?.lastname === 'string' ? value.lastname.trim() : '',
  company: typeof value?.company === 'string' ? value.company.trim() : '',
  btw: typeof value?.btw === 'string' ? value.btw.trim() : ''
})

export const getInstallerProfile = async (): Promise<InstallerProfile> => {
  try {
    const encoded = await installerProfileStore.get(PROFILE_KEY)
    return cleanProfile(JSON.parse(decoder.decode(encoded)) as Partial<InstallerProfile>)
  } catch {
    return cleanProfile(undefined)
  }
}

export const saveInstallerProfile = async (profile: Partial<InstallerProfile>): Promise<void> => {
  await installerProfileStore.put(PROFILE_KEY, JSON.stringify(cleanProfile(profile)))
}
