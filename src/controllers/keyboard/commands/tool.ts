// Single-letter tool hotkeys (Floorplanner / Sweet Home 3D / SketchUp
// convention). Only fire when no input is focused and no modifier keys
// are held — otherwise we'd hijack browser shortcuts like Cmd+W.
const TOOL_MAP: Record<string, string | undefined> = {
  v: undefined, // selection / move
  r: 'resize',
  w: 'draw-wall',
  d: 'draw-door',
  n: 'draw-window',
  g: 'draw-gate'
}

const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  // Material-web inputs delegate to internal form controls; treat any
  // element inside a known text-entry custom element as a text entry.
  const closest = target.closest('md-outlined-text-field, md-filled-text-field, md-outlined-select, md-filled-select')
  return Boolean(closest)
}

export const isToolHotkey = (event: KeyboardEvent): boolean => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
  if (event.repeat) return false
  if (isTextEntry(event.target)) return false
  const key = event.key?.toLowerCase()
  return Boolean(key && key in TOOL_MAP)
}

export const tool = (event: KeyboardEvent) => {
  const key = event.key?.toLowerCase()
  if (!key || !(key in TOOL_MAP)) return
  const action = TOOL_MAP[key]
  // End any active wall chain when switching tools.
  const field = window.cadleShell?.field as { endWallChain?: () => void } | undefined
  field?.endWallChain?.()
  if (window.cadleShell) window.cadleShell.action = action
  if (window.cadleShell?.field?.canvas) {
    window.cadleShell.field.canvas.isDrawingMode = false
    window.cadleShell.field.canvas.discardActiveObject?.()
    window.cadleShell.field.canvas.requestRenderAll?.()
  }
}

export const keys = [['V'], ['R'], ['W'], ['D'], ['N'], ['G']]
