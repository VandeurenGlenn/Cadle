import { IText, classRegistry } from 'fabric'

type DepthOptions = {
  uuid?: string
  [key: string]: unknown
}

export class CadleDepth extends IText {
  uuid: `${string}-${string}-${string}-${string}-${string}`

  constructor(text: string, options: DepthOptions = {}) {
    super(text, options as unknown as ConstructorParameters<typeof IText>[1])

    this.uuid = (
      typeof options.uuid === 'string' ? options.uuid : crypto.randomUUID()
    ) as `${string}-${string}-${string}-${string}-${string}`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toObject(propertiesToInclude?: any[]): any {
    return {
      ...super.toObject(propertiesToInclude),
      uuid: this.uuid,
      type: 'CadleDepth'
    }
  }
}

classRegistry.setClass(CadleDepth, 'CadleDepth')
