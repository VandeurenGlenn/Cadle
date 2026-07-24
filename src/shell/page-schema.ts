export type PageCloneOptions = {
  includeWalls: boolean
  outsideWallsOnly: boolean
  includeOpenings: boolean
  includeElectrical: boolean
}

export const clonePageSchema = (
  schema: { version?: string; objects?: unknown[] },
  _options: PageCloneOptions
) => {
  const version = schema?.version ?? '6.0.0'
  const objects = Array.isArray(schema?.objects) ? schema.objects : []
  // Native documents currently clone atomically. Keeping the options in the
  // contract allows object-level filtering later without changing callers.
  return structuredClone({ version, objects })
}
