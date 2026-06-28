import { nothing, svg } from 'lit'
import { lineMetrics, shapeBounds } from '../native-draw/model.js'
import type { LineShape, Point, Shape } from '../native-draw/types.js'

const shapeTransform = (shape: Extract<Shape, { position: Point }>): string => {
  const rotate = shape.rotation ? ` rotate(${shape.rotation})` : ''
  const scale = shape.flipX || shape.flipY ? ` scale(${shape.flipX ? -1 : 1} ${shape.flipY ? -1 : 1})` : ''
  return rotate || scale
    ? `translate(${shape.position.x} ${shape.position.y})${rotate}${scale} translate(${-shape.position.x} ${-shape.position.y})`
    : ''
}

const rectTransform = (shape: Extract<Shape, { kind: 'rect' }>, bounds: { x: number; y: number; width: number; height: number }): string => {
  if (!shape.rotation) return ''
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  return `rotate(${shape.rotation} ${cx} ${cy})`
}

export const shapeTemplate = (shape: Shape, selected: boolean, extraClass = '') => {
  const selectedAttr = selected ? 'true' : 'false'
  const shapeClass = `shape shape-${shape.kind} ${extraClass}`
  switch (shape.kind) {
    case 'wall':
    case 'line':
      return svg`
        <line
          class=${shapeClass}
          data-shape-id=${shape.id}
          data-selected=${selectedAttr}
          x1=${shape.start.x}
          y1=${shape.start.y}
          x2=${shape.end.x}
          y2=${shape.end.y}></line>
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
      return svg`
        <line class=${`shape shape-door-opening ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.start.x} y1=${shape.start.y} x2=${shape.end.x} y2=${shape.end.y}></line>
        <line class=${`shape shape-door-leaf ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.start.x} y1=${shape.start.y} x2=${tipX} y2=${tipY}></line>
        <path class=${`shape shape-door-arc ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} d=${arcD}></path>
        <circle class=${`shape shape-door-hinge ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} cx=${shape.start.x} cy=${shape.start.y} r="4"></circle>
      `
    }
    case 'window': {
      const { nx, ny } = lineMetrics(shape)
      const jambLength = 12
      return svg`
        <line class=${`shape shape-window-glass ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.start.x} y1=${shape.start.y} x2=${shape.end.x} y2=${shape.end.y}></line>
        <line class=${`shape shape-window-jamb ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.start.x - nx * jambLength} y1=${shape.start.y - ny * jambLength} x2=${shape.start.x + nx * jambLength} y2=${shape.start.y + ny * jambLength}></line>
        <line class=${`shape shape-window-jamb ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.end.x - nx * jambLength} y1=${shape.end.y - ny * jambLength} x2=${shape.end.x + nx * jambLength} y2=${shape.end.y + ny * jambLength}></line>
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
      const sweepFlag2 = shape.flipSide ? 0 : 1
      const arc1D = `M ${tip1x} ${tip1y} A ${half} ${half} 0 0 ${sweepFlag} ${mx} ${my}`
      const arc2D = `M ${tip2x} ${tip2y} A ${half} ${half} 0 0 ${sweepFlag2} ${mx} ${my}`
      return svg`
        <line class=${`shape shape-gate-opening ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.start.x} y1=${shape.start.y} x2=${shape.end.x} y2=${shape.end.y}></line>
        <line class=${`shape shape-gate-leaf ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.start.x} y1=${shape.start.y} x2=${tip1x} y2=${tip1y}></line>
        <line class=${`shape shape-gate-leaf ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.end.x} y1=${shape.end.y} x2=${tip2x} y2=${tip2y}></line>
        <path class=${`shape shape-gate-arc ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} d=${arc1D}></path>
        <path class=${`shape shape-gate-arc ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} d=${arc2D}></path>
        <circle class=${`shape shape-gate-hinge ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} cx=${shape.start.x} cy=${shape.start.y} r="3"></circle>
        <circle class=${`shape shape-gate-hinge ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} cx=${shape.end.x} cy=${shape.end.y} r="3"></circle>
      `
    }
    case 'rect': {
      const bounds = shapeBounds(shape)
      const fill = shape.fill ?? nothing
      const stroke = shape.stroke ?? nothing
      if (shape.variant === 'circle') {
        const cx = bounds.x + bounds.width / 2
        const cy = bounds.y + bounds.height / 2
        const transform = rectTransform(shape, bounds)
        return svg`
          <ellipse
            class=${shapeClass}
            data-shape-id=${shape.id}
            data-selected=${selectedAttr}
            transform=${transform || nothing}
            cx=${cx}
            cy=${cy}
            rx=${Math.max(0.5, bounds.width / 2)}
            ry=${Math.max(0.5, bounds.height / 2)}
            fill=${fill}
            stroke=${stroke}></ellipse>
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
        return svg`
          <path
            class=${shapeClass}
            data-shape-id=${shape.id}
            data-selected=${selectedAttr}
            transform=${transform || nothing}
            d=${path}
            fill="none"
            stroke=${stroke}></path>
        `
      }
      const transform = rectTransform(shape, bounds)
      return svg`
        <rect
          class=${shapeClass}
          data-shape-id=${shape.id}
          data-selected=${selectedAttr}
          transform=${transform || nothing}
          x=${bounds.x}
          y=${bounds.y}
          width=${Math.max(1, bounds.width)}
          height=${Math.max(1, bounds.height)}
          fill=${fill}
          stroke=${stroke}></rect>
      `
    }
    case 'text':
      return svg`
        <text
          class=${shapeClass}
          data-shape-id=${shape.id}
          data-selected=${selectedAttr}
          transform=${shapeTransform(shape)}
          fill=${shape.fill ?? nothing}
          x=${shape.position.x}
          y=${shape.position.y}>${shape.text}</text>
      `
    case 'symbol': {
      const size = 40 * Math.max(0.4, shape.scale)
      const x = shape.position.x - size / 2
      const y = shape.position.y - size / 2
      return svg`
        <image
          class=${shapeClass}
          data-shape-id=${shape.id}
          data-selected=${selectedAttr}
          transform=${shapeTransform(shape)}
          href=${shape.path}
          x=${x}
          y=${y}
          width=${size}
          height=${size}></image>
      `
    }
    case 'image': {
      const x = shape.position.x - shape.width / 2
      const y = shape.position.y - shape.height / 2
      return svg`
        <image
          class=${shapeClass}
          data-shape-id=${shape.id}
          data-selected=${selectedAttr}
          transform=${shapeTransform(shape)}
          href=${shape.path}
          x=${x}
          y=${y}
          width=${shape.width}
          height=${shape.height}></image>
      `
    }
  }
}

export const bindingLabelsTemplate = (shapes: Shape[]) => {
  const labeledShapes = new Map<string, Shape>()
  for (const shape of shapes) {
    if (!('bindingId' in shape) || typeof shape.bindingId !== 'string' || shape.bindingId.length === 0) continue
    // One-wire circuits render their own text labels — skip them here.
    if (typeof shape.groupId === 'string' && shape.groupId.startsWith('onewire-')) continue
    const key = shape.groupId ?? shape.id
    if (!labeledShapes.has(key)) labeledShapes.set(key, shape)
  }

  return [...labeledShapes.values()].map((shape) => {
    const bounds = shapeBounds(shape)
    const x = bounds.x + bounds.width / 2
    const y = bounds.y - 10
    const bindingId = 'bindingId' in shape ? shape.bindingId : undefined
    if (!bindingId) return nothing
    const width = Math.max(36, bindingId.length * 8 + 10)
    return svg`
        <g class="binding-label" data-shape-id=${shape.id}>
          <rect class="binding-label-bg" x=${x - width / 2} y=${y - 10} width=${width} height="16" rx="4"></rect>
          <text class="binding-label-text" x=${x} y=${y + 1} text-anchor="middle">${bindingId}</text>
        </g>
      `
  })
}

export const selectedOutlineTemplate = (shape: Shape | null) => {
  if (!shape) return nothing
  const bounds = shapeBounds(shape)
  const padding = shape.kind === 'wall' ? 12 : shape.kind === 'text' ? 6 : 8
  return svg`
    <rect
      class="selected-outline"
      x=${bounds.x - padding}
      y=${bounds.y - padding}
      width=${Math.max(12, bounds.width + padding * 2)}
      height=${Math.max(12, bounds.height + padding * 2)}></rect>
  `
}

export const safeAreaTemplate = (rect: { x: number; y: number; width: number; height: number }) => svg`
  <rect
    class="print-safe-area"
    x=${rect.x}
    y=${rect.y}
    width=${rect.width}
    height=${rect.height}></rect>
`

export const rubberBandTemplate = (start: Point | null, end: Point | null) => {
  if (!start || !end) return nothing
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  return svg`<rect class="rubber-band" x=${x} y=${y} width=${width} height=${height}></rect>`
}

export const wallChainPreviewTemplate = (
  wallChain: { startPoint: Point } | null,
  chainPreviewEnd: Point | null,
  snapTarget: Point | null
) => {
  if (!wallChain || !chainPreviewEnd) return nothing
  const { startPoint } = wallChain
  return svg`
    <line class="shape shape-wall draft" x1=${startPoint.x} y1=${startPoint.y} x2=${chainPreviewEnd.x} y2=${chainPreviewEnd.y}></line>
    ${snapTarget ? svg`<circle class="snap-indicator" cx=${snapTarget.x} cy=${snapTarget.y} r="9"></circle>` : nothing}
  `
}

export const measurementTemplate = (from: Point | null, to: Point | null) => {
  if (!from || !to) return nothing
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 2) return nothing
  const meters = length / 50
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  return svg`
    <g class="measurement-overlay">
      <rect class="measurement-label-bg" x=${midX - 44} y=${midY - 26} width="88" height="20" rx="6"></rect>
      <text class="measurement-label" x=${midX} y=${midY - 12} text-anchor="middle">${meters.toFixed(2)}m · ${angle.toFixed(0)}°</text>
    </g>
  `
}

export const wallMaskTemplate = (shapes: Shape[], worldWidth: number, worldHeight: number) => {
  const openings = shapes.filter(
    (shape): shape is LineShape => shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate'
  )
  if (!openings.length) return nothing
  return svg`
    <mask id="wall-opening-mask" maskUnits="userSpaceOnUse">
      <rect width=${worldWidth} height=${worldHeight} fill="white"></rect>
      ${openings.map(
        (shape) => svg`
          <line
            x1=${shape.start.x}
            y1=${shape.start.y}
            x2=${shape.end.x}
            y2=${shape.end.y}
            stroke="black"
            stroke-width="16"
            stroke-linecap="butt"
            vector-effect="non-scaling-stroke"></line>
        `
      )}
    </mask>
  `
}
