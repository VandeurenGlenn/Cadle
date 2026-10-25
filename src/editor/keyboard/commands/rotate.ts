import type { NativeHotkeyAction } from '../hotkeys.js'

export const isRotate = (event: KeyboardEvent): boolean =>
  !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === '[' || event.key === ']')

export const rotate = (event: KeyboardEvent): NativeHotkeyAction => (event.key === '[' ? 'rotate-left' : 'rotate-right')

export const keyCombination = [{ key: '[' }, { key: ']' }]
export const keys = [['['], [']']]
