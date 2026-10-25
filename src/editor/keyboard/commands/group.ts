import { isPrimaryShortcut, isMac } from '../utils.js'
import type { NativeHotkeyAction } from '../hotkeys.js'

export const isGroup = (event: KeyboardEvent): boolean => event.key.toLowerCase() === 'g' && isPrimaryShortcut(event)
export const group = (): NativeHotkeyAction => 'group'
export const keyCombination = { key: 'g', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'g'] : ['ctrl', 'g']]
