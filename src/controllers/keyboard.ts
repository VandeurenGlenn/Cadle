import { canvas, field, moveDown, moveLeft, moveRight, moveUp } from '../utils.js'
import { getHotkey } from './keyboard/hotkeys.js'

const isEditableKeyEvent = (event: KeyboardEvent): boolean => {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue
    const tag = node.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (node.isContentEditable) return true
    if (node.getAttribute('role') === 'textbox') return true
    if (node.localName.endsWith('-text-field')) return true
  }
  return false
}

addEventListener('keydown', async (event) => {
  if (isEditableKeyEvent(event)) return

  const hotkey = getHotkey(event)
  // console.log({ hotkey })

  if (hotkey) {
    event.preventDefault()
    await hotkey(event)
  }

  if (canvas.shouldRender) {
    await canvas.requestRenderAll()
    canvas.shouldRender = false
  }
})
