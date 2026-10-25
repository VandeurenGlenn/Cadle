import type { NativeHotkeyAction } from '../hotkeys.js'

export const isRemove = ({ key, metaKey, ctrlKey }: KeyboardEvent): boolean =>
  (key === 'Backspace' || key === 'Delete') && !metaKey && !ctrlKey
export const remove = (): NativeHotkeyAction => 'delete'
export const keyCombination = [{ key: 'Backspace' }, { key: 'Delete' }]
export const keys = [['backspace'], ['delete']]