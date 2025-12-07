import { moveDown, moveLeft, moveRight, moveUp } from '../../utils.js'
import { isMac } from './utils.js'
import state from '../../state.js'
import { print, isPrint } from './commands/print.js'
import { selectAll, isSelectAll, keys as selectAllKeys } from './commands/select-all.js'
import { cut, isCut, keys as cutKeys } from './commands/cut.js'
import { isGroup, group, keys as groupKeys } from './commands/group.js'
import { isUngroup, ungroup, keys as ungroupKeys } from './commands/ungroup.js'
import { isPaste, paste, keys as pasteKeys } from './commands/paste.js'
import { isRemove, remove, keys as removeKeys } from './commands/remove.js'
import { insertText, isInsertText, keys as insertTextKeys } from './commands/insert-text.js'
import { isSave, save, keys as saveKeys } from './commands/save.js'
import { copy, isCopy, keys as copyKeys } from './commands/copy.js'
import { isFlip, flip, keys as flipKeys } from './commands/flip.js'
import { isRotate, rotate, keys as rotateKeys } from './commands/rotate.js'
import { isScale, scale, keys as scaleKeys } from './commands/scale.js'
import { isEscape, escape, keys as escapeKeys } from './commands/escape.js'
import { bringForward, isBringForward, keys as bringForwardKeys } from './commands/bring-forward.js'
import { bringToFront, isBringToFront, keys as bringToFrontKeys } from './commands/bring-to-front.js'
import { isSendBackwards, sendBackwards, keys as sendBackwardsKeys } from './commands/send-backwards.js'
import { isSendToBack, sendToBack, keys as sendToBackKeys } from './commands/send-to-back.js'

// note whenever shiftKey is pressed it will return upperkey
export const getHotkey = (event: KeyboardEvent): undefined | Function => {
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
  if (isBringForward(event)) return bringForward
  if (isBringToFront(event)) return bringToFront
  if (isSendBackwards(event)) return sendBackwards
  if (isSendToBack(event)) return sendToBack

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

export const hotkeyList = {
  general: [
    { action: 'remove', keys: removeKeys },
    { action: 'copy', keys: copyKeys },
    { action: 'paste', keys: pasteKeys },
    { action: 'cut', keys: cutKeys },
    { action: 'select all', keys: selectAllKeys },
    { action: 'save', keys: saveKeys }
  ],
  drawing: [
    { action: 'group', keys: groupKeys },
    { action: 'ungroup', keys: ungroupKeys },
    { action: 'insert text', keys: insertTextKeys }
  ],
  transform: [
    { action: 'flip', keys: flipKeys },
    { action: 'rotate', keys: rotateKeys },
    { action: 'scale', keys: scaleKeys },
    { action: 'escape', keys: escapeKeys }
  ],
  layer: [
    { action: 'bring forward', keys: bringForwardKeys },
    { action: 'bring to front', keys: bringToFrontKeys },
    { action: 'send backwards', keys: sendBackwardsKeys },
    { action: 'send to back', keys: sendToBackKeys }
  ]
}
