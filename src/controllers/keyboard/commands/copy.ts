import { isPrimaryShortcut, isMac, type NativeHotkeyAction } from '../hotkeys.js'

export const isCopy = (event: KeyboardEvent) => event.key.toLowerCase() === 'c' && isPrimaryShortcut(event)

export const copy = (): NativeHotkeyAction => 'copy'

export const keyCombination = { key: 'c', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'c'] : ['ctrl', 'c']]
