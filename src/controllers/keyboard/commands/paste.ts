import state from '../../../state.js'
import { clipboard, canvas, positionObject, snapToGrid } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isPaste = ({ metaKey, key, ctrlKey }: KeyboardEvent) => key === 'v' && (isMac ? metaKey : ctrlKey)

export const paste = async () => {
  const { left, top } = positionObject()
  const cloned = await clipboard.object?.clone()

  await canvas.discardActiveObject()

  if (cloned) {
    const pointer = state.mouse.position
    const currentPoints = snapToGrid({ left: pointer.x - cloned.width / 2, top: pointer.y - cloned.height / 2 })
    // cloned.set({
    //   left: left - cloned.width / 2,
    //   top: top - cloned.height / 2,
    //   evented: true
    // })
    cloned.set(currentPoints)
    if (cloned.type === 'activeSelection') {
      // active selection needs a reference to the canvas.
      cloned.canvas = canvas
      cloned.forEachObject(function (obj) {
        canvas.add(obj)
      })
      // this should solve the unselectability
      cloned.setCoords()
    } else {
      canvas.add(cloned)
    }

    canvas.shouldRender = true
    canvas.requestRenderAll()
    canvas.history.push({ type: 'add', item: cloned })
    await canvas.setActiveObject(cloned)
  }
}
