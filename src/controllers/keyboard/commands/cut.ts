import { isPrimaryShortcut, isMac, type NativeHotkeyAction } from '../hotkeys.js'

export const isCut = (event: KeyboardEvent): boolean => event.key.toLowerCase() === 'x' && isPrimaryShortcut(event)
export const cut = (): NativeHotkeyAction => 'cut'
export const keyCombination = { key: 'x', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'x'] : ['ctrl', 'x']]