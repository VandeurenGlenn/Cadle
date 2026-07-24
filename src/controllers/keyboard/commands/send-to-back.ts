import { isPrimaryShortcut, isMac } from '../utils.js'
import type { NativeHotkeyAction } from '../hotkeys.js'

export const isSendToBack = (event: KeyboardEvent): boolean =>
  event.key === '[' && event.shiftKey && isPrimaryShortcut(event)
export const sendToBack = (): NativeHotkeyAction => 'send-to-back'
export const keyCombination = { key: '[', shiftKey: true, metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'shift', '['] : ['ctrl', 'shift', '[']]
