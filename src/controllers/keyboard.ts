import { canvas, field, moveDown, moveLeft, moveRight, moveUp } from '../utils.js';
import { copy, isCopy } from './keyboard/commands/copy.js';
import { isPrint } from './keyboard/hotkeys.js';
import { cut, isCut } from './keyboard/commands/cut.js';
import { isGroup, group } from './keyboard/commands/group.js';
import { isUngroup, ungroup } from './keyboard/commands/ungroup.js';
import { isPaste, paste } from './keyboard/commands/paste.js';
import { isRemove, remove } from './keyboard/commands/remove.js';
import { insertText, isInsertText } from './keyboard/commands/insert-text.js';
import { isSelectAll, selectAll } from './keyboard/commands/select-all.js';
import { isSave, save } from './keyboard/commands/save.js';
import state from '../state.js';
import { isMac } from './keyboard/utils.js';

addEventListener('keydown', async event => {

  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    if (isSelectAll(event)) selectAll()
    if (isCopy(event)) copy()
    if (isPaste(event)) paste()
    if (isRemove(event)) remove()
    if (isPrint(event)) print()
    if (isCut(event)) cut()
    if (isGroup(event)) group()
    if (isUngroup(event)) ungroup()
    if (isInsertText(event)) insertText()
    if (isSave(event)) save()
    
    if (event.metaKey && isMac && event.key === 'ArrowRight' && event.ctrlKey || event.ctrlKey && event.key === 'ArrowRight' && !isMac) {
      moveRight(state.move.amount)
    }

    if (event.metaKey && isMac && event.key === 'ArrowLeft' && event.ctrlKey || event.ctrlKey && event.key === 'ArrowLeft' && !isMac) {
      moveLeft(state.move.amount)
    }

    if (event.metaKey && isMac && event.key === 'ArrowUp' && event.ctrlKey || event.ctrlKey && event.key === 'ArrowUp' && !isMac) {
      moveUp(state.move.amount)
    }

    if (event.metaKey && isMac && event.key === 'ArrowDown' && event.ctrlKey || event.ctrlKey && event.key === 'ArrowDown' && !isMac) {
      moveDown(state.move.amount)
    }
  }
 
  if (canvas.shouldRender) {
    field.canvas.renderAll()
    canvas.shouldRender = false
  }  
})