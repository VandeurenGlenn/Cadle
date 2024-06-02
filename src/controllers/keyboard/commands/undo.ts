import { canvas, getActiveObjects } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isUndo = ({ metaKey, ctrlKey, key }: KeyboardEvent) => key === 'z' && (isMac ? metaKey : ctrlKey)

export const undo = () => {
  canvas.shouldRender = true
  canvas.discardActiveObject()
  const lastAction = canvas.history.pop()
  if (lastAction?.type)
    switch (lastAction.type) {
      case 'remove':
        canvas.add(lastAction.item)
        break

      case 'add':
        canvas.remove(lastAction.item)
        break
      case 'move-left':
        canvas.setActiveObject(lastAction.item)
        break

      case 'move-right':
        canvas.setActiveObject(lastAction.item)
        break
      default:
        break
    }
}
