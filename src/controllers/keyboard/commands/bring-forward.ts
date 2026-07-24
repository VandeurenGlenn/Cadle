import { isPrimaryShortcut, isMac } from '../utils.js'
import type { NativeHotkeyAction } from '../hotkeys.js'

export const isBringForward = (event: KeyboardEvent): boolean => event.key === ']' && isPrimaryShortcut(event)
export const bringForward = (): NativeHotkeyAction => 'bring-forward'
export const keyCombination = { key: ']', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', ']'] : ['ctrl', ']']]
