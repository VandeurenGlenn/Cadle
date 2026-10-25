import type { NativeHotkeyAction } from '../hotkeys.js'
import { isPrimaryShortcut, isMac } from '../utils.js'

export const isScale = (event: KeyboardEvent): boolean => {
  if (!isPrimaryShortcut(event)) return false
  const key = event.key.toLowerCase()
  return key === '+' || key === '=' || key === '-' || event.code === 'NumpadAdd' || event.code === 'NumpadSubtract'
}

export const scale = (event: KeyboardEvent): NativeHotkeyAction => {
  const key = event.key.toLowerCase()
  return key === '+' || key === '=' || event.code === 'NumpadAdd' ? 'scale-up' : 'scale-down'
}

export const keyCombination = [
  { key: '+', metaKey: isMac, ctrlKey: !isMac },
  { key: '=', metaKey: isMac, ctrlKey: !isMac },
  { key: '-', metaKey: isMac, ctrlKey: !isMac }
]

export const keys = [
  isMac ? ['meta', '+'] : ['ctrl', '+'],
  isMac ? ['meta', '='] : ['ctrl', '='],
  isMac ? ['meta', '-'] : ['ctrl', '-']
]
