import { canvas, getActiveObjects } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isUndo = ({ metaKey, ctrlKey, key }: KeyboardEvent) => key === 'z' && (isMac ? metaKey : ctrlKey)

export const undo = () => {
  const canvas_ = canvas as any
  canvas_.shouldRender = true
  canvas_.discardActiveObject()
  const lastAction = canvas_.history.pop()
  if (lastAction?.type)
    switch (lastAction.type) {
    case 'remove':
      canvas_.add(lastAction.item)
      break

    case 'add':
      canvas_.remove(lastAction.item)
      break
    case 'move-left':
      canvas_.setActiveObject(lastAction.item)
      break

    case 'move-right':
      canvas_.setActiveObject(lastAction.item)
      break
    default:
      break
    }
}

export const keyCombination = { key: 'z', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'z'] : ['ctrl', 'z']]
