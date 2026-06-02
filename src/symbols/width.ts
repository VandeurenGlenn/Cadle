import { IText, classRegistry } from 'fabric'

type WidthOptions = ConstructorParameters<typeof IText>[1] & {
  uuid?: string
}

export class CadleWidth extends IText {
  uuid: `${string}-${string}-${string}-${string}-${string}`

  constructor(text: string, options: WidthOptions = {}) {
    super(text, options)
    this.uuid = (
      typeof options.uuid === 'string' ? options.uuid : crypto.randomUUID()
    ) as `${string}-${string}-${string}-${string}-${string}`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toObject(propertiesToInclude?: any[]): any {
    return {
      ...super.toObject(propertiesToInclude),
      uuid: this.uuid,
      type: 'CadleWidth'
    }
  }
}
classRegistry.setClass(CadleWidth, 'CadleWidth')
