import { clipboard, canvas, positionObject } from '../../../utils.js'
import { isMac } from '../utils.js'

// only flip on active object
export const isRotate = ({ metaKey, key, ctrlKey, shiftKey }: KeyboardEvent) =>
  canvas.getActiveObject() && (key === '+' || key === '-')

export const rotate = ({ key }) => {
  canvas.shouldRender = true
  const object = canvas.getActiveObject()
  console.log(object)

  if (key === '-') {
    if (!object.currentRotation) {
      object.currentRotation = -45
      object?.rotate(object.currentRotation)
    } else {
      let rotationAmount = -45
      if (object.currentRotation + -45 >= -180) {
        rotationAmount = -180
      } else {
        rotationAmount = object.currentRotation > 0 ? object.currentRotation - 45 : object.currentRotation + -45
      }
      object.currentRotation = rotationAmount
      object?.rotate(rotationAmount)
    }
    canvas.history.push({ type: 'rotate-up', item: object })
  } else {
    if (!object.currentRotation) {
      object.currentRotation = 45
      object?.rotate(object.currentRotation)
    } else {
      let rotationAmount = 45
      if (object.currentRotation + 45 >= 180) {
        rotationAmount = -180
      } else {
        rotationAmount = object.currentRotation + 45
      }
      object.currentRotation = rotationAmount
      object?.rotate(rotationAmount)
    }
    canvas.history.push({ type: 'rotate-down', item: object })
  }
}
