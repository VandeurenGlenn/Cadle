type RGB = `rgb(${number}, ${number}, ${number})`
type RGBA = `rgba(${number}, ${number}, ${number}, ${number})`
type HEX = `#${string}`
type Transparent = 'transparent'

export declare type Color = RGB | RGBA | HEX | Transparent

export declare type optionalSymbolOptions = {
  id?: string
  index?: number
  originX?: string
  originY?: string
  angle?: number
  fill?: Color
  stroke?: Color
  borderScaleFactor?: number
  strokeWidth?: number
  centeredRotation?: boolean
  snapAngle?: number
}
export declare type symbolOptions = {
  originX: string
  originY: string
  angle: number
  fill: Color
  stroke: Color
  borderScaleFactor: number
  strokeWidth: number
  centeredRotation: boolean
  snapAngle: number
}

const options: symbolOptions = {
  originX: 'left',
  originY: 'top',
  angle: 0,
  fill: 'transparent',
  stroke: '#555',
  borderScaleFactor: 0,
  strokeWidth: 1,
  centeredRotation: true,
  snapAngle: 5
}

export default options
