import { escapeHtml, lineMetrics, shapeBounds } from '../../editor/model/model.js'
import { applySymbolTextOverrides, getCachedSymbolSvg } from '../symbol-svg-cache.js'
import type { LineShape, Point, Shape } from '../../editor/model/types.js'
import type { PaperPresetConfig } from '../constants.js'
import type { Project } from '../../types.js'
import { buildProjectTitleBlockMarkup } from '../layout/project-title-block.js'
import { bindingLabelsMarkup } from '../svg-templates.js'

const pointToSegmentDistance = (point: Point, start: Point, end: Point): number => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  const projectionX = start.x + t * dx
  const projectionY = start.y + t * dy
  return Math.hypot(point.x - projectionX, point.y - projectionY)
}

const openingOnWall = (opening: LineShape, wall: LineShape, tolerance: number): boolean => {
  const midpoint: Point = {
    x: (opening.start.x + opening.end.x) / 2,
    y: (opening.start.y + opening.end.y) / 2
  }
  const startDistance = pointToSegmentDistance(opening.start, wall.start, wall.end)
  const endDistance = pointToSegmentDistance(opening.end, wall.start, wall.end)
  const middleDistance = pointToSegmentDistance(midpoint, wall.start, wall.end)
  return startDistance <= tolerance && endDistance <= tolerance && middleDistance <= tolerance
}

const openingMatchesWall = (opening: LineShape, walls: LineShape[], tolerance = 4): boolean => {
  if (!opening.wallId) return false
  const boundWall = walls.find((wall) => wall.id === opening.wallId)
  return Boolean(boundWall && openingOnWall(opening, boundWall, tolerance))
}

const EXPORT_STYLE_BLOCK = `
  .shape { vector-effect: non-scaling-stroke; }
  .shape-line, .shape-wall { fill: none; stroke-linecap: round; }
  .shape-wall { stroke: #3b2c20; stroke-width: 8; }
  .shape-line { stroke-width: 2; }

  .binding-label-text {
    fill: #2f241a;
    font: 700 11px 'IBM Plex Sans', 'Segoe UI', sans-serif;
    letter-spacing: 0.03em;
    dominant-baseline: middle;
    stroke: rgba(255, 255, 255, 0.88);
    stroke-width: 1.6;
    paint-order: stroke;
  }

  .shape-door-opening { fill: none; stroke: none; }
  .shape-door-leaf { fill: none; stroke: #3b2c20; stroke-width: 3.5; stroke-linecap: round; }
  .shape-door-arc { fill: none; stroke: #3b2c20; stroke-width: 2; stroke-dasharray: 8 5; stroke-linecap: round; }
  .shape-door-hinge { display: none; }

  .shape-window-glass { fill: none; stroke: rgba(100, 190, 240, 0.92); stroke-width: 12; stroke-linecap: butt; }
  .shape-window-jamb { fill: none; stroke: #3b2c20; stroke-width: 3; stroke-linecap: round; }

  .shape-gate-opening { fill: none; stroke: none; }
  .shape-gate-leaf { fill: none; stroke: #3b2c20; stroke-width: 3.5; stroke-linecap: round; }
  .shape-gate-arc { fill: none; stroke: #3b2c20; stroke-width: 2; stroke-dasharray: 8 5; stroke-linecap: round; }
  .shape-gate-hinge { display: none; }

  .shape-rect { stroke-width: 2; }
  .shape-text {
    font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
    font-weight: 600;
  }
`

const EXPORT_STYLE_BLOCK_MONO = `
  .shape { vector-effect: non-scaling-stroke; }
  .shape-line, .shape-wall { fill: none; stroke-linecap: round; }
  .shape-wall { stroke: #101010; stroke-width: 8; }
  .shape-line { stroke: #151515; stroke-width: 2.4; }

  .binding-label-text {
    fill: #151515;
    font: 700 11px 'IBM Plex Sans', 'Segoe UI', sans-serif;
    letter-spacing: 0.03em;
    dominant-baseline: middle;
    stroke: rgba(255, 255, 255, 0.92);
    stroke-width: 1.8;
    paint-order: stroke;
  }

  .shape-door-opening { fill: none; stroke: none; }
  .shape-door-leaf { fill: none; stroke: #151515; stroke-width: 3.8; stroke-linecap: round; }
  .shape-door-arc { fill: none; stroke: #3a3a3a; stroke-width: 2.4; stroke-dasharray: 8 5; stroke-linecap: round; }
  .shape-door-hinge { display: none; }

  .shape-window-glass { fill: none; stroke: #ffffff; stroke-width: 8; stroke-linecap: butt; }
  .shape-window-jamb { fill: none; stroke: #151515; stroke-width: 3.2; stroke-linecap: round; }

  .shape-gate-opening { fill: none; stroke: none; }
  .shape-gate-leaf { fill: none; stroke: #151515; stroke-width: 3.8; stroke-linecap: round; }
  .shape-gate-arc { fill: none; stroke: #3a3a3a; stroke-width: 2.4; stroke-dasharray: 8 5; stroke-linecap: round; }
  .shape-gate-hinge { display: none; }

  .shape-rect { stroke-width: 2.4; }
  .shape-text {
    font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
    font-weight: 600;
    fill: #121212;
  }
`

const shapeTransform = (shape: Extract<Shape, { position: Point }>): string => {
  const rotate = shape.rotation ? ` rotate(${shape.rotation})` : ''
  const scale = shape.flipX || shape.flipY ? ` scale(${shape.flipX ? -1 : 1} ${shape.flipY ? -1 : 1})` : ''
  return rotate || scale
    ? ` transform="translate(${shape.position.x} ${shape.position.y})${rotate}${scale} translate(${-shape.position.x} ${-shape.position.y})"`
    : ''
}

const rectTransform = (
  shape: Extract<Shape, { kind: 'rect' }>,
  bounds: { x: number; y: number; width: number; height: number }
): string => {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const rotate = shape.rotation ? ` rotate(${shape.rotation})` : ''
  const scale = shape.flipX || shape.flipY ? ` scale(${shape.flipX ? -1 : 1} ${shape.flipY ? -1 : 1})` : ''
  return rotate || scale ? ` transform="translate(${cx} ${cy})${rotate}${scale} translate(${-cx} ${-cy})"` : ''
}

const resolveExportAssetHref = (path: string): string => {
  // For symbols in export, try to use absolute URL if possible
  if (path.startsWith('symbols/')) {
    if (typeof window !== 'undefined' && window.location) {
      return `${window.location.origin}/www/${path}`
    }
    return `http://localhost:5173/www/${path}`
  }
  return path
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
      const lineStrokeAttr = ` stroke="${escapeHtml(shape.stroke ?? '#a85427')}"`
      const lineStrokeWidthStyle =
        typeof shape.strokeWidth === 'number' ? ` style="stroke-width: ${Math.max(0.5, shape.strokeWidth)}px;"` : ''
      return `
          <line
            class="shape shape-${shape.kind} ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${lineStrokeAttr}${lineStrokeWidthStyle}
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
      const strokeWidthStyle =
        typeof shape.strokeWidth === 'number' ? ` style="stroke-width: ${Math.max(0.5, shape.strokeWidth)}px;"` : ''
      return `
          <line class="shape shape-door-opening ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}"></line>
          <line class="shape shape-door-leaf ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}"${strokeWidthStyle} x1="${shape.start.x}" y1="${shape.start.y}" x2="${tipX}" y2="${tipY}"></line>
          <path class="shape shape-door-arc ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}"${strokeWidthStyle} d="${arcD}"></path>
          <circle class="shape shape-door-hinge ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" cx="${shape.start.x}" cy="${shape.start.y}" r="4"></circle>
        `
    }
    case 'window': {
      const { nx, ny } = lineMetrics(shape)
      const jambLength = 12
      const strokeWidthStyle =
        typeof shape.strokeWidth === 'number' ? ` style="stroke-width: ${Math.max(0.5, shape.strokeWidth)}px;"` : ''
      return `
          <line class="shape shape-window-glass ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}"${strokeWidthStyle} x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}"></line>
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
      const strokeWidthStyle =
        typeof shape.strokeWidth === 'number' ? ` style="stroke-width: ${Math.max(0.5, shape.strokeWidth)}px;"` : ''
      return `
          <line class="shape shape-gate-opening ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}"></line>
          <line class="shape shape-gate-leaf ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}"${strokeWidthStyle} x1="${shape.start.x}" y1="${shape.start.y}" x2="${tip1x}" y2="${tip1y}"></line>
          <line class="shape shape-gate-leaf ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}"${strokeWidthStyle} x1="${shape.end.x}" y1="${shape.end.y}" x2="${tip2x}" y2="${tip2y}"></line>
          <path class="shape shape-gate-arc ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}"${strokeWidthStyle} d="${arc1D}"></path>
          <path class="shape shape-gate-arc ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}"${strokeWidthStyle} d="${arc2D}"></path>
          <circle class="shape shape-gate-hinge ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" cx="${shape.start.x}" cy="${shape.start.y}" r="3"></circle>
          <circle class="shape shape-gate-hinge ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" cx="${shape.end.x}" cy="${shape.end.y}" r="3"></circle>
        `
    }
    case 'rect': {
      const bounds = shapeBounds(shape)
      const fillAttr = ` fill="${escapeHtml(shape.fill ?? 'transparent')}"`
      const strokeAttr = ` stroke="${escapeHtml(shape.stroke ?? '#000000')}"`
      const strokeWidthStyle =
        typeof shape.strokeWidth === 'number' ? ` style="stroke-width: ${Math.max(0.5, shape.strokeWidth)}px;"` : ''
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
            ${strokeWidthStyle}
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
            ${strokeWidthStyle}
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
            ${strokeWidthStyle}
            x="${bounds.x}"
            y="${bounds.y}"
            width="${Math.max(1, bounds.width)}"
            height="${Math.max(1, bounds.height)}"${fillAttr}${strokeAttr}></rect>
        `
    }
    case 'text':
      const textFillAttr = `fill="${escapeHtml(shape.fill ?? '#000000')}"`
      const textStrokeAttr = shape.stroke ? ` stroke="${escapeHtml(shape.stroke)}"` : ' stroke="none"'
      const fontFamilyStyle = shape.fontFamily ? `font-family: ${shape.fontFamily}; ` : ''
      const letterSpacingStyle =
        typeof shape.letterSpacing === 'number' ? `letter-spacing: ${shape.letterSpacing}px; ` : ''
      const textStyle =
        typeof shape.strokeWidth === 'number'
          ? `${fontFamilyStyle}${letterSpacingStyle}font-size: ${18 * (shape.scale ?? 1)}px; stroke-width: ${Math.max(0.5, shape.strokeWidth)}px;`
          : `${fontFamilyStyle}${letterSpacingStyle}font-size: ${18 * (shape.scale ?? 1)}px;`
      return `
          <text
            class="shape shape-text ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${shapeTransform(shape)}
            style="${textStyle}"
            ${textFillAttr}${textStrokeAttr}
            x="${shape.position.x}"
            y="${shape.position.y}">${escapeHtml(shape.text)}</text>
        `
    case 'symbol': {
      const size = 24 * Math.max(0.4, shape.scale)
      const x = shape.position.x - size / 2
      const y = shape.position.y - size / 2
      const symbolSvg = getCachedSymbolSvg(shape.path)
      if (symbolSvg) {
        const symbolInner = applySymbolTextOverrides(shape.path, symbolSvg.inner, shape.symbolTextOverrides)
        const symbolStyle =
          `--symbol-fill:#000000;` +
          `--symbol-stroke:#000000;` +
          `${shape.fill ? `--symbol-fill:${escapeHtml(shape.fill)};` : ''}` +
          `${shape.stroke ? `--symbol-stroke:${escapeHtml(shape.stroke)};` : ''}` +
          `${typeof shape.strokeWidth === 'number' ? `--symbol-stroke-width:${shape.strokeWidth};` : ''}`
        return `
          <g class="shape shape-symbol ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" ${shapeTransform(shape)}>
            <svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${escapeHtml(symbolSvg.viewBox)}"${symbolStyle ? ` style="${symbolStyle}"` : ''}>${symbolInner}</svg>
          </g>
        `
      }
      const symbolHref = resolveExportAssetHref(shape.path)
      return `
          <image
            class="shape shape-symbol ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${shapeTransform(shape)}
            href="${escapeHtml(symbolHref)}"
            xlink:href="${escapeHtml(symbolHref)}"
            x="${x}"
            y="${y}"
            width="${size}"
            height="${size}"></image>
        `
    }
    case 'image': {
      const x = shape.position.x - shape.width / 2
      const y = shape.position.y - shape.height / 2
      const imageHref = resolveExportAssetHref(shape.path)
      const imageStrokeWidth = typeof shape.strokeWidth === 'number' ? Math.max(0.5, shape.strokeWidth) : 1
      const imageHasDecoration = Boolean(shape.fill || shape.stroke)
      const imageDecoration = imageHasDecoration
        ? `<rect class="shape shape-image-decoration ${extraClass}" data-shape-id="${shape.id}" data-selected="${selectedAttr}" ${shapeTransform(shape)} x="${x}" y="${y}" width="${shape.width}" height="${shape.height}" fill="${escapeHtml(shape.fill || 'none')}" stroke="${escapeHtml(shape.stroke || 'none')}" style="stroke-width: ${imageStrokeWidth}px;"></rect>`
        : ''
      return `
          ${imageDecoration}
          <image
            class="shape shape-image ${extraClass}"
            data-shape-id="${shape.id}"
            data-selected="${selectedAttr}"
            ${shapeTransform(shape)}
            href="${escapeHtml(imageHref)}"
            xlink:href="${escapeHtml(imageHref)}"
            x="${x}"
            y="${y}"
            width="${shape.width}"
            height="${shape.height}"></image>
        `
    }
  }
}

export const buildWallMask = (shapes: Shape[], worldWidth: number, worldHeight: number): string => {
  const openingMaskWidth = 8
  const walls = shapes.filter((shape): shape is LineShape => shape.kind === 'wall')
  const openings = shapes
    .filter((shape): shape is LineShape => shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate')
    .filter((opening) => openingMatchesWall(opening, walls))
  if (!openings.length) return ''

  const maskShapes = [...walls, ...openings]
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const shape of maskShapes) {
    const bounds = shapeBounds(shape)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  const padding = 128
  const maskX = Number.isFinite(minX) ? minX - padding : -padding
  const maskY = Number.isFinite(minY) ? minY - padding : -padding
  const maskWidth = Number.isFinite(maxX - minX) ? Math.max(worldWidth, maxX - minX + padding * 2) : worldWidth
  const maskHeight = Number.isFinite(maxY - minY) ? Math.max(worldHeight, maxY - minY + padding * 2) : worldHeight

  const openingStrokes = openings
    .map(
      (shape) =>
        `<line x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}" stroke="black" stroke-width="${openingMaskWidth}" stroke-linecap="butt" vector-effect="non-scaling-stroke"/>`
    )
    .join('')
  return `<mask id="wall-opening-mask" maskUnits="userSpaceOnUse">
      <rect x="${maskX}" y="${maskY}" width="${maskWidth}" height="${maskHeight}" fill="white"/>
      ${openingStrokes}
    </mask>`
}

const buildWallOpeningCuts = (shapes: Shape[], cutColor: string): string => {
  const openingCutWidth = 8.4
  const walls = shapes.filter((shape): shape is LineShape => shape.kind === 'wall')
  const openings = shapes
    .filter((shape): shape is LineShape => shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate')
    .filter((opening) => openingMatchesWall(opening, walls))
  if (!openings.length) return ''

  return openings
    .map(
      (shape) =>
        `<line class="wall-opening-cut" x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}" stroke="${cutColor}" stroke-width="${openingCutWidth}" stroke-linecap="butt" vector-effect="non-scaling-stroke"/>`
    )
    .join('')
}

export const buildSvgDocument = (options: {
  shapes: Shape[]
  selectedShape: Shape | null
  paper: PaperPresetConfig
  worldWidth: number
  worldHeight: number
  project?: Project | null
  pageName?: string
  pageKey?: string
  pageOverlayScale?: number
  viewBox?: { x: number; y: number; width: number; height: number }
  monochrome?: boolean
}): string => {
  const groupedMarkup = (shapes: Shape[]) => {
    const entries: Array<{ type: 'single'; shape: Shape } | { type: 'group'; groupId: string; shapes: Shape[] }> = []
    const groups = new Map<string, Shape[]>()

    for (const shape of shapes) {
      if (!shape.groupId) {
        entries.push({ type: 'single', shape })
        continue
      }

      const existing = groups.get(shape.groupId)
      if (existing) {
        existing.push(shape)
        continue
      }

      const grouped: Shape[] = [shape]
      groups.set(shape.groupId, grouped)
      entries.push({ type: 'group', groupId: shape.groupId, shapes: grouped })
    }

    return entries
      .map((entry) =>
        entry.type === 'single'
          ? shapeMarkup(entry.shape, false)
          : `<g class="shape-group" data-group-id="${entry.groupId}">${entry.shapes
              .map((shape) => shapeMarkup(shape, false))
              .join('')}</g>`
      )
      .join('')
  }

  const wallOpeningCuts = buildWallOpeningCuts(options.shapes, '#ffffff')
  const wallMarkup = groupedMarkup(options.shapes.filter((shape) => shape.kind === 'wall'))
  const nonSymbolMarkup = groupedMarkup(
    options.shapes.filter((shape) => shape.kind !== 'wall' && shape.kind !== 'symbol')
  )
  const symbolMarkup = groupedMarkup(options.shapes.filter((shape) => shape.kind === 'symbol'))
  const labelMarkup = bindingLabelsMarkup(options.shapes)
  const shell =
    typeof window !== 'undefined'
      ? (window as unknown as {
          cadleShell?: { project?: Project | null; currentPageName?: string; loadedPage?: string }
        })
      : {}
  const viewBox = options.viewBox ?? { x: 0, y: 0, width: options.worldWidth, height: options.worldHeight }
  const project = options.project ?? shell.cadleShell?.project ?? null
  const pageName = options.pageName ?? shell.cadleShell?.currentPageName ?? ''
  const pageKey = options.pageKey ?? shell.cadleShell?.loadedPage ?? ''
  const pageOverlayScale =
    typeof options.pageOverlayScale === 'number' && Number.isFinite(options.pageOverlayScale)
      ? options.pageOverlayScale
      : 1
  const titleBlockMarkup = buildProjectTitleBlockMarkup(
    project,
    pageName,
    viewBox.width,
    viewBox.height,
    pageKey,
    pageOverlayScale,
    viewBox.x,
    viewBox.y
  )
  const markup = `${wallMarkup}${wallOpeningCuts}${nonSymbolMarkup}${symbolMarkup}${labelMarkup}${titleBlockMarkup}`
  const exportStyle = options.monochrome ? EXPORT_STYLE_BLOCK_MONO : EXPORT_STYLE_BLOCK
  const defs = `<style><![CDATA[${exportStyle}]]></style>`
  return `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" width="${options.paper.widthMm}mm" height="${options.paper.heightMm}mm" style="background:#ffffff;">
        <defs>${defs}</defs>
        <rect width="100%" height="100%" fill="#ffffff"></rect>
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
