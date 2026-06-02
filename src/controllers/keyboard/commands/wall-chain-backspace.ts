// Backspace during an active wall chain undoes the most recent committed
// segment without aborting the chain. Matches Sweet Home 3D / SketchUp /
// Floorplanner. Only intercepts when a chain is active and no input is
// focused (otherwise Backspace must edit text normally).
const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  const closest = target.closest('md-outlined-text-field, md-filled-text-field, md-outlined-select, md-filled-select')
  return Boolean(closest)
}

export const isWallChainBackspace = (event: KeyboardEvent): boolean => {
  if (event.key !== 'Backspace') return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  if (isTextEntry(event.target)) return false
  const field = window.cadleShell?.field as
    | {
        popWallChainSegment?: () => void
        isWallChainActive?: () => boolean
      }
    | undefined
  return Boolean(field && typeof field.popWallChainSegment === 'function' && field.isWallChainActive?.())
}

export const wallChainBackspace = () => {
  const field = window.cadleShell?.field as
    | {
        popWallChainSegment?: () => void
        isWallChainActive?: () => boolean
      }
    | undefined
  field?.popWallChainSegment?.()
}

export const keys = [['Backspace']]
