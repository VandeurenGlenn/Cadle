import type { NativeHotkeyAction } from '../hotkeys.js'

export const isEscape = ({ key }: KeyboardEvent): boolean => key === 'Escape'
export const escape = (): NativeHotkeyAction => 'escape'
export const keyCombination = { key: 'Escape' }
export const keys = [['escape']]