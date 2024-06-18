import { isMac } from '../utils.js'
export { save } from './../../../api/project.js'
export const isSave = ({ metaKey, key, ctrlKey }: KeyboardEvent): boolean => key === 's' && (isMac ? metaKey : ctrlKey)
