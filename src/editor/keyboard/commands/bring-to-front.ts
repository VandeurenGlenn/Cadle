import { isPrimaryShortcut, isMac } from '../utils.js'
import type { NativeHotkeyAction } from '../hotkeys.js'

export const isBringToFront = (event: KeyboardEvent): boolean =>
  event.key === ']' && event.shiftKey && isPrimaryShortcut(event)
export const bringToFront = (): NativeHotkeyAction => 'bring-to-front'
export const keyCombination = { key: ']', shiftKey: true, metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'shift', ']'] : ['ctrl', 'shift', ']']]
