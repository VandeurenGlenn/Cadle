import { print, isPrint } from './commands/print.js'
import { selectAll, isSelectAll } from './commands/select-all.js'
import { cut, isCut } from './commands/cut.js'
import { isGroup, group } from './commands/group.js'
import { isUngroup, ungroup } from './commands/ungroup.js'
import { isPaste, paste } from './commands/paste.js'
import { isRemove, remove } from './commands/remove.js'
import { insertText, isInsertText } from './commands/insert-text.js'
import { isSave, save } from './commands/save.js'
import { copy, isCopy } from './commands/copy.js'
import { moveDown, moveLeft, moveRight, moveUp } from '../../utils.js'
import { isMac } from './utils.js'
import state from '../../state.js'
import { isFlip, flip } from './commands/flip.js'
import { isRotate, rotate } from './commands/rotate.js'
import { isScale, scale } from './commands/scale.js'
import { isEscape, escape } from './commands/escape.js'

// note whenever shiftKey is pressed it will return upperkey
export const getHotkey = (event: KeyboardEvent): Function => {
  // if (isPrint(event)) return print
  if (isSelectAll(event)) return selectAll
  if (isCopy(event)) return copy
  if (isPaste(event)) return paste
  if (isRemove(event)) return remove
  if (isCut(event)) return cut
  if (isGroup(event)) return group
  if (isUngroup(event)) return ungroup
  if (isInsertText(event)) return insertText
  if (isSave(event)) return save
  if (isFlip(event)) return flip
  if (isRotate(event)) return rotate
  if (isScale(event)) return scale
  if (isEscape(event)) return escape

  if (
    (event.metaKey && isMac && event.key === 'ArrowRight' && event.ctrlKey) ||
    (event.ctrlKey && event.key === 'ArrowRight' && !isMac)
  ) {
    return () => moveRight(state.move.amount)
  }

  if (
    (event.metaKey && isMac && event.key === 'ArrowLeft' && event.ctrlKey) ||
    (event.ctrlKey && event.key === 'ArrowLeft' && !isMac)
  ) {
    return () => moveLeft(state.move.amount)
  }

  if (
    (event.metaKey && isMac && event.key === 'ArrowUp' && event.ctrlKey) ||
    (event.ctrlKey && event.key === 'ArrowUp' && !isMac)
  ) {
    return () => moveUp(state.move.amount)
  }

  if (
    (event.metaKey && isMac && event.key === 'ArrowDown' && event.ctrlKey) ||
    (event.ctrlKey && event.key === 'ArrowDown' && !isMac)
  ) {
    return () => moveDown(state.move.amount)
  }

  return undefined
}
