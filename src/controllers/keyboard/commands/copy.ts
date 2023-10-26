import { Group } from 'fabric'
import { clipboard, field, getActiveObjects, canvas } from '../../../utils.js'
import { isMac } from '../utils.js'

export const isCopy = ({metaKey, key, ctrlKey}: KeyboardEvent) => key === 'c' && isMac ? metaKey : ctrlKey

export const copy = async () => {
  const items = getActiveObjects()
  const group = new Group()
  // @ts-ignore
  group.add(items)
  clipboard.object = await group.clone()
}