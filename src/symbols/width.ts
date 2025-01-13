import { IText, classRegistry } from 'fabric'

export class CadleWidth extends IText {
  uuid: `${string}-${string}-${string}-${string}-${string}`

  constructor(text, options) {
    super(text, options)
    this.uuid = options.uuid || crypto.randomUUID()
  }

  toObject(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      type: 'CadleWidth'
    }
  }
}
classRegistry.setClass(CadleWidth, 'CadleWidth')
