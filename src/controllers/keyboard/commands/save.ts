import { isMac } from '../utils.js'
export { save } from './../../../api/project.js'
export const isSave = ({ metaKey, key, ctrlKey }: KeyboardEvent): boolean => key === 's' && (isMac ? metaKey : ctrlKey)

export const keyCombination = { key: 's', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 's'] : ['ctrl', 's']]
