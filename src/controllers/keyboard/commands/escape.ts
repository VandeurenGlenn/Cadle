import { canvas } from '../../../utils.js'

export const isEscape = ({ key }: KeyboardEvent) => key === 'Escape'

export const escape = () => {
  // End an in-flight wall chain first so Esc always cancels the next
  // segment immediately (matches Sweet Home 3D / AutoCAD).
  const field = window.cadleShell?.field as { endWallChain?: () => void } | undefined
  field?.endWallChain?.()

  if (canvas.getActiveObjects()?.length) {
    canvas.discardActiveObject()
    canvas.shouldRender = true
    return
  }

  if (cadleShell.action === 'draw') {
    cadleShell.action = undefined
    cadleShell.field.canvas.isDrawingMode = false
    cadleShell.field.canvas.renderAll()
    return
  }

  if (cadleShell.action) return (cadleShell.action = undefined)
}

export const keyCombination = { key: 'Escape' }
export const keys = [['Escape']]
