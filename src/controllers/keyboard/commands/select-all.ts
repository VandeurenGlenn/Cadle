import { isPrimaryShortcut, isMac, type NativeHotkeyAction } from '../hotkeys.js'

export const isSelectAll = (event: KeyboardEvent): boolean => event.key.toLowerCase() === 'a' && isPrimaryShortcut(event)
export const selectAll = (): NativeHotkeyAction => 'select-all'
export const keyCombination = { key: 'a', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'a'] : ['ctrl', 'a']]