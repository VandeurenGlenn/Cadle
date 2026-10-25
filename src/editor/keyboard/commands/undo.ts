import { isPrimaryShortcut, isMac } from '../utils.js'
import type { NativeHotkeyAction } from '../hotkeys.js'

export const isUndo = (event: KeyboardEvent): boolean => {
  if (!isPrimaryShortcut(event)) return false
  const key = event.key.toLowerCase()
  return key === 'z' || key === 'y'
}

export const undo = (event: KeyboardEvent): NativeHotkeyAction => {
  const key = event.key.toLowerCase()
  if (key === 'y') return 'redo'
  return event.shiftKey ? 'redo' : 'undo'
}

export const keyCombination = { key: 'z', metaKey: isMac, ctrlKey: !isMac }
export const keys = [
  isMac ? ['meta', 'z'] : ['ctrl', 'z'],
  isMac ? ['meta', 'shift', 'z'] : ['ctrl', 'shift', 'z'],
  isMac ? ['meta', 'y'] : ['ctrl', 'y']
]
