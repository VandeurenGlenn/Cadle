import { isPrimaryShortcut, isMac, type NativeHotkeyAction } from '../hotkeys.js'

export const isPaste = (event: KeyboardEvent): boolean => event.key.toLowerCase() === 'v' && isPrimaryShortcut(event)
export const paste = (): NativeHotkeyAction => 'paste'
export const keyCombination = { key: 'v', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'v'] : ['ctrl', 'v']]