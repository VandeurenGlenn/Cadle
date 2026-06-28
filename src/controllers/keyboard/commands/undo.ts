import { isPrimaryShortcut, isMac, type NativeHotkeyAction } from '../hotkeys.js'

export const isUndo = (event: KeyboardEvent): boolean => event.key.toLowerCase() === 'z' && isPrimaryShortcut(event)
export const undo = (event: KeyboardEvent): NativeHotkeyAction => (event.shiftKey ? 'redo' : 'undo')
export const keyCombination = { key: 'z', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'z'] : ['ctrl', 'z']]