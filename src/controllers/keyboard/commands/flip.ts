import type { NativeHotkeyAction } from '../hotkeys.js'

export const isFlip = (event: KeyboardEvent): boolean =>
  event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && ['h', 'v'].includes(event.key.toLowerCase())

export const flip = (event: KeyboardEvent): NativeHotkeyAction | null => {
  const key = event.key.toLowerCase()
  if (key === 'h') return 'flip-horizontal'
  if (key === 'v') return 'flip-vertical'
  return null
}

export const keyCombination = [
  { key: 'H', shiftKey: true },
  { key: 'V', shiftKey: true }
]
export const keys = [
  ['shift', 'h'],
  ['shift', 'v']
]
