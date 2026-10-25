import type { NativeHotkeyAction } from '../hotkeys.js'
import { isPrimaryShortcut } from '../utils.js'

const ARROW_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

export const isNudge = (event: KeyboardEvent): boolean => {
  if (isPrimaryShortcut(event)) return false
  const key = event.key.toLowerCase()
  return ARROW_KEYS.has(key)
}

export const nudge = (event: KeyboardEvent): NativeHotkeyAction | null => {
  const key = event.key.toLowerCase()
  if (!ARROW_KEYS.has(key)) return null

  if (key === 'arrowup') {
    if (event.altKey) return 'nudge-up-precision'
    return event.shiftKey ? 'nudge-up-grid' : 'nudge-up'
  }
  if (key === 'arrowdown') {
    if (event.altKey) return 'nudge-down-precision'
    return event.shiftKey ? 'nudge-down-grid' : 'nudge-down'
  }
  if (key === 'arrowleft') {
    if (event.altKey) return 'nudge-left-precision'
    return event.shiftKey ? 'nudge-left-grid' : 'nudge-left'
  }
  if (key === 'arrowright') {
    if (event.altKey) return 'nudge-right-precision'
    return event.shiftKey ? 'nudge-right-grid' : 'nudge-right'
  }

  return null
}

export const keys = [['↑'], ['↓'], ['←'], ['→']]
export const precisionKeys = [['alt', '↑↓←→']]
export const gridKeys = [['shift', '↑↓←→']]
