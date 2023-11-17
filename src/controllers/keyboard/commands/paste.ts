import { clipboard, canvas, positionObject } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isPaste = ({metaKey, key, ctrlKey}: KeyboardEvent) => key === 'v' && (isMac ? metaKey : ctrlKey)

export const paste = async () => {
  await canvas.discardActiveObject();
  const { left, top } = positionObject()
  const cloned = await clipboard.object?.clone()
  
  if (cloned) {
    cloned.set({
      left: left - (cloned.width / 2),
      top: top - (cloned.height / 2),
      evented: true
    })
    
    if (cloned.type === 'activeSelection') {
      // active selection needs a reference to the canvas.
      cloned.canvas = canvas;
      cloned.forEachObject(function(obj) {
        canvas.add(obj);
      });
      // this should solve the unselectability
      cloned.setCoords();
    } else {
      canvas.add(cloned);
    }
    
    await canvas.setActiveObject(cloned);
  }
  canvas.shouldRender = true
  
}