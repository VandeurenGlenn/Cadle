import { clipboard, canvas, positionObject } from '../../../utils.js'
import { isMac } from '../utils.js'

// only flip on active object
export const isScale = ({ metaKey, key, ctrlKey, shiftKey }: KeyboardEvent) =>
  canvas.getActiveObject() && (key === '/' || key === '*')

export const scale = ({ key }) => {
  canvas.shouldRender = true
  const object = canvas.getActiveObject()
  console.log(object)

  if (key === '/') {
    if (!object.currentScale) {
      object.currentScale = 0.9
      object?.scale(object.currentScale)
    } else {
      let scaleAmount = object.currentScale - 0.1
      object.currentScale = scaleAmount
      object?.scale(scaleAmount)
    }
    canvas.history.push({ type: 'scale-down', item: object })
  } else {
    if (!object.currentScale) {
      object.currentScale = 1.1
      object?.scale(object.currentScale)
    } else {
      let scaleAmount = object.currentScale + 0.1
      object.currentScale = scaleAmount
      object?.scale(scaleAmount)
    }
    canvas.history.push({ type: 'scale-up', item: object })
  }
}
