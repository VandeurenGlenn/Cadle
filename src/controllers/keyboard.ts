import { canvas, field, moveDown, moveLeft, moveRight, moveUp } from '../utils.js';
import { getHotkey } from './keyboard/hotkeys.js';

addEventListener('keydown', async event => {
  const hotkey = getHotkey(event)
  console.log({hotkey});
  
  if (hotkey) {
    event.preventDefault()
    hotkey()
  }
 
  if (canvas.shouldRender) {
    field.canvas.renderAll()
    canvas.shouldRender = false
  }
})