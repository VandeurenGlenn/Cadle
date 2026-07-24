import { isPrimaryShortcut, isMac } from '../utils.js'
import type { NativeHotkeyAction } from '../hotkeys.js'

export const isSendBackwards = (event: KeyboardEvent): boolean => event.key === '[' && isPrimaryShortcut(event)
export const sendBackwards = (): NativeHotkeyAction => 'send-backwards'
export const keyCombination = { key: '[', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', '['] : ['ctrl', '[']]
