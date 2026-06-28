import { isPrimaryShortcut, isMac, type NativeHotkeyAction } from '../hotkeys.js'

export const isInsertText = (event: KeyboardEvent): boolean =>
  event.key.toLowerCase() === 't' && isPrimaryShortcut(event)
export const insertText = (): NativeHotkeyAction => 'tool-text'
export const keyCombination = { key: 't', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 't'] : ['ctrl', 't']]
