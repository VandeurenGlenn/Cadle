import { clipboard, canvas, positionObject } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isPaste = ({metaKey, key, ctrlKey}: KeyboardEvent) => key === 'v' && isMac ? metaKey : ctrlKey

export const paste = () => {
  const json = clipboard.object
  const { left, top } = positionObject()
  json.left = left - (json.width / 2)
  json.top = top - (json.height / 2)
  // @ts-ignore
  canvas.add(json)
  clipboard.object = undefined
  canvas.shouldRender = true
}