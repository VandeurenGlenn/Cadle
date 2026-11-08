import { sanitizeHeatingDesign, type HeatingDesignInputs } from './heating-design.js'

export type HeatingPipeProfile = { id: string; name: string; diameterMm: number; design: HeatingDesignInputs }
const key = 'cadle.heating.pipe-profiles.v1'
const productKeys = ['product', 'pipeWallMm', 'roughnessMm', 'minBendRadiusMm', 'maxCircuitLengthM'] as const
/** Product properties are reusable; room loads and project temperatures stay with the plan. */
export const heatingPipeProfile = (name: string, diameterMm: number, design?: HeatingDesignInputs): HeatingPipeProfile => ({
  id: name.trim().slice(0, 160).toLocaleLowerCase(), name: name.trim().slice(0, 160), diameterMm,
  design: sanitizeHeatingDesign(Object.fromEntries(productKeys.map((k) => [k, design?.[k]]))) ?? {}
})
export const readHeatingPipeProfiles = (storage?: Pick<Storage, 'getItem'>): HeatingPipeProfile[] => {
  try {
    const value = JSON.parse((storage ?? globalThis.localStorage).getItem(key) ?? '[]')
    return Array.isArray(value) ? value.flatMap((v) => v && typeof v.name === 'string' && v.name.trim() && Number.isFinite(v.diameterMm) && v.diameterMm >= 6 && v.diameterMm <= 50
      ? [heatingPipeProfile(v.name, v.diameterMm, sanitizeHeatingDesign(v.design))] : []).slice(0, 50) : []
  } catch { return [] }
}
export const saveHeatingPipeProfile = (profile: HeatingPipeProfile, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) => {
  const profiles = readHeatingPipeProfiles(storage).filter((p) => p.id !== profile.id)
  storage.setItem(key, JSON.stringify([...profiles, profile].slice(-50)))
}
export const deleteHeatingPipeProfile = (id: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) =>
  storage.setItem(key, JSON.stringify(readHeatingPipeProfiles(storage).filter((p) => p.id !== id)))
export const applyHeatingPipeProfile = (profile: HeatingPipeProfile, design?: HeatingDesignInputs): HeatingDesignInputs => ({
  ...design, ...Object.fromEntries(productKeys.map((k) => [k, profile.design[k]])), systemOutputBasis: undefined
})
