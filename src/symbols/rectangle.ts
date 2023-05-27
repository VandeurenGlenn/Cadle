import { Rect } from 'fabric'
import defaultOptions from './default-options.js'

export default class extends Rect {
  constructor(options) {
    super({ ...defaultOptions, ...options})
  }
}