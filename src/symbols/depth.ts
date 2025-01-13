import { IText, classRegistry } from 'fabric'

export class CadleDepth extends IText {
  uuid: `${string}-${string}-${string}-${string}-${string}`

  constructor(text, options) {
    super(text, options)

    this.uuid = options.uuid || crypto.randomUUID()
  }
  toObject(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      type: 'CadleDepth'
    }
  }
}

classRegistry.setClass(CadleDepth, 'CadleDepth')
