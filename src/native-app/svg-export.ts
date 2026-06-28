import { escapeHtml, lineMetrics, shapeBounds } from '../native-draw/model.js'
import type { LineShape, Point, Shape } from '../native-draw/types.js'
import type { PaperPresetConfig } from './constants.js'

const shapeTransform = (shape: Extract<Shape, { position: Point }>): string => {
  const rotate = shape.rotation ? ` rotate(${shape.rotation})` : ''
  const scale = shape.flipX || shape.flipY ? ` scale(${shape.flipX ? -1 : 1} ${shape.flipY ? -1 : 1})` : ''
  return rotate || scale
    ? ` transform="translate(${shape.position.x} ${shape.position.y})${rotate}${scale} translate(${-shape.position.x} ${-shape.position.y})"`
    : ''
}

const rectTransform = (shape: Extract<Shape, { kind: 'rect' }>, bounds: { x: number; y: number; width: number; height: number }): string => {
  if (!shape.rotation) return ''
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  return ` transform="rotate(${shape.rotation} ${cx} ${cy})"`
}

export const selectedOutlineMarkup = (shape: Shape | null): string => {
  if (!shape) return ''
  const bounds = shapeBounds(shape)
  const padding = shape.kind === 'wall' ? 12 : shape.kind === 'text' ? 6 : 8
  return `
      <rect
        class="selected-outline"
        x="${bounds.x - padding}"
        y="${bounds.y - padding}"
        width="${Math.max(12, bounds.width + padding * 2)}"
        height="${Math.max(12, bounds.height + padding * 2)}"></rect>
    `
}

export const shapeMarkup = (shape: Shape, selected: boolean, extraClass = ''): string => {
  const selectedAttr = selected ? 'true' : 'false'
  switch (shape.kind) {
    case 'wall':
    case 'line':
      return `
          <line
            class="shape shape-${shape.kind} ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            x1="${shape.start.x}"
            y1="${shape.start.y}"
            x2="${shape.end.x}"
            y2="${shape.end.y}"></line>
        `
    case 'door': {
      const { length, nx, ny } = lineMetrics(shape)
      const side = shape.flipSide ? -1 : 1
      const fnx = nx * side
      const fny = ny * side
      const tipX = shape.start.x + fnx * length
      const tipY = shape.start.y + fny * length
      const sweepFlag = shape.flipSide ? 1 : 0
      const arcD = `M ${tipX} ${tipY} A ${length} ${length} 0 0 ${sweepFlag} ${shape.end.x} ${shape.end.y}`
      return `
          <line class="shape shape-door-opening ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}"></line>
          <line class="shape shape-door-leaf ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.start.x}" y1="${shape.start.y}" x2="${tipX}" y2="${tipY}"></line>
          <path class="shape shape-door-arc ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" d="${arcD}"></path>
          <circle class="shape shape-door-hinge ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" cx="${shape.start.x}" cy="${shape.start.y}" r="4"></circle>
        `
    }
    case 'window': {
      const { nx, ny } = lineMetrics(shape)
      const jambLength = 12
      return `
          <line class="shape shape-window-glass ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}"></line>
          <line class="shape shape-window-jamb ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.start.x - nx * jambLength}" y1="${shape.start.y - ny * jambLength}" x2="${shape.start.x + nx * jambLength}" y2="${shape.start.y + ny * jambLength}"></line>
          <line class="shape shape-window-jamb ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.end.x - nx * jambLength}" y1="${shape.end.y - ny * jambLength}" x2="${shape.end.x + nx * jambLength}" y2="${shape.end.y + ny * jambLength}"></line>
        `
    }
    case 'gate': {
      const { length, nx, ny } = lineMetrics(shape)
      const side = shape.flipSide ? -1 : 1
      const fnx = nx * side
      const fny = ny * side
      const half = length / 2
      const mx = (shape.start.x + shape.end.x) / 2
      const my = (shape.start.y + shape.end.y) / 2
      const tip1x = shape.start.x + fnx * half
      const tip1y = shape.start.y + fny * half
      const tip2x = shape.end.x + fnx * half
      const tip2y = shape.end.y + fny * half
      const sweepFlag = shape.flipSide ? 1 : 0
      const arc1D = `M ${tip1x} ${tip1y} A ${half} ${half} 0 0 ${sweepFlag} ${mx} ${my}`
      const sweepFlag2 = shape.flipSide ? 0 : 1
      const arc2D = `M ${tip2x} ${tip2y} A ${half} ${half} 0 0 ${sweepFlag2} ${mx} ${my}`
      return `
          <line class="shape shape-gate-opening ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}"></line>
          <line class="shape shape-gate-leaf ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.start.x}" y1="${shape.start.y}" x2="${tip1x}" y2="${tip1y}"></line>
          <line class="shape shape-gate-leaf ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.end.x}" y1="${shape.end.y}" x2="${tip2x}" y2="${tip2y}"></line>
          <path class="shape shape-gate-arc ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" d="${arc1D}"></path>
          <path class="shape shape-gate-arc ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" d="${arc2D}"></path>
          <circle class="shape shape-gate-hinge ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" cx="${shape.start.x}" cy="${shape.start.y}" r="3"></circle>
          <circle class="shape shape-gate-hinge ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" cx="${shape.end.x}" cy="${shape.end.y}" r="3"></circle>
        `
    }
    case 'rect': {
      const bounds = shapeBounds(shape)
      const fillAttr = shape.fill ? ` fill="${escapeHtml(shape.fill)}"` : ''
      const strokeAttr = shape.stroke ? ` stroke="${escapeHtml(shape.stroke)}"` : ''
      if (shape.variant === 'circle') {
        const cx = bounds.x + bounds.width / 2
        const cy = bounds.y + bounds.height / 2
        const transform = rectTransform(shape, bounds)
        return `
          <ellipse
            class="shape shape-rect ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${transform}
            cx="${cx}"
            cy="${cy}"
            rx="${Math.max(0.5, bounds.width / 2)}"
            ry="${Math.max(0.5, bounds.height / 2)}"${fillAttr}${strokeAttr}></ellipse>
        `
      }
      if (shape.variant === 'arc') {
        const startX = bounds.x
        const startY = bounds.y + bounds.height
        const endX = bounds.x + bounds.width
        const endY = startY
        const rx = Math.max(0.5, bounds.width / 2)
        const ry = Math.max(0.5, bounds.height)
        const transform = rectTransform(shape, bounds)
        const path = `M ${startX} ${startY} A ${rx} ${ry} 0 0 1 ${endX} ${endY}`
        return `
          <path
            class="shape shape-rect ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${transform}
            d="${path}"
            fill="none"${strokeAttr}></path>
        `
      }
      const transform = rectTransform(shape, bounds)
      return `
          <rect
            class="shape shape-rect ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${transform}
            x="${bounds.x}"
            y="${bounds.y}"
            width="${Math.max(1, bounds.width)}"
            height="${Math.max(1, bounds.height)}"${fillAttr}${strokeAttr}></rect>
        `
    }
    case 'text':
      return `
          <text
            class="shape shape-text ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${shapeTransform(shape)}
            ${shape.fill ? `fill="${escapeHtml(shape.fill)}"` : ''}
            x="${shape.position.x}"
            y="${shape.position.y}">${escapeHtml(shape.text)}</text>
        `
    case 'symbol': {
      const size = 40 * Math.max(0.4, shape.scale)
      const x = shape.position.x - size / 2
      const y = shape.position.y - size / 2
      return `
          <image
            class="shape shape-symbol ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${shapeTransform(shape)}
            href="${escapeHtml(shape.path)}"
            x="${x}"
            y="${y}"
            width="${size}"
            height="${size}"></image>
        `
    }
    case 'image': {
      const x = shape.position.x - shape.width / 2
      const y = shape.position.y - shape.height / 2
      return `
          <image
            class="shape shape-image ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${shapeTransform(shape)}
            href="${escapeHtml(shape.path)}"
            x="${x}"
            y="${y}"
            width="${shape.width}"
            height="${shape.height}"></image>
        `
    }
  }
}

export const buildWallMask = (shapes: Shape[], worldWidth: number, worldHeight: number): string => {
  const openingStrokes = shapes
    .filter((shape): shape is LineShape => shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate')
    .map(
      (shape) =>
        `<line x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}" stroke="black" stroke-width="16" stroke-linecap="butt" vector-effect="non-scaling-stroke"/>`
    )
    .join('')
  if (!openingStrokes) return ''
  return `<mask id="wall-opening-mask" maskUnits="userSpaceOnUse">
      <rect width="${worldWidth}" height="${worldHeight}" fill="white"/>
      ${openingStrokes}
    </mask>`
}

export const buildSvgDocument = (options: {
  shapes: Shape[]
  selectedShape: Shape | null
  paper: PaperPresetConfig
  worldWidth: number
  worldHeight: number
}): string => {
  const wallMaskDef = buildWallMask(options.shapes, options.worldWidth, options.worldHeight)
  const maskAttr = wallMaskDef ? ' mask="url(#wall-opening-mask)"' : ''
  const wallMarkup = options.shapes
    .filter((shape) => shape.kind === 'wall')
    .map((shape) => shapeMarkup(shape, false))
    .join('')
  const symbolMarkup = options.shapes
    .filter((shape) => shape.kind !== 'wall')
    .map((shape) => shapeMarkup(shape, false))
    .join('')
  const markup = `<g${maskAttr}>${wallMarkup}</g>${symbolMarkup}`
  return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${options.worldWidth} ${options.worldHeight}" width="${options.paper.widthMm}mm" height="${options.paper.heightMm}mm">
        ${wallMaskDef ? `<defs>${wallMaskDef}</defs>` : ''}
        <rect width="100%" height="100%" fill="#f8f3ed"></rect>
        ${markup}
        ${selectedOutlineMarkup(options.selectedShape)}
      </svg>
    `.trim()
}

export const safeAreaRect = (
  paper: PaperPresetConfig,
  printMargin: number,
  worldWidth: number,
  worldHeight: number
) => {
  const marginX = (printMargin / paper.widthMm) * worldWidth
  const marginY = (printMargin / paper.heightMm) * worldHeight
  const width = Math.max(0, worldWidth - marginX * 2)
  const height = Math.max(0, worldHeight - marginY * 2)
  return {
    x: marginX,
    y: marginY,
    width,
    height
  }
}
