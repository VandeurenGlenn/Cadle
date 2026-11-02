import type { LineShape } from './model/types.js'
import { CONNECTION_NAMES, connectionLabel, connectionPoints, connectionTextLayout } from './model/electrical-connection.js'
import { PROTECTION_FONT_FAMILY, PROTECTION_TEXT_SIZE } from './layout/protection-label-layout.js'
import { paperTextContentMarkup, wrapPaperText } from './layout/paper-text-layout.js'

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Identical markup for editor, preview and export; the endpoints stay exact. */
export const electricalConnectionMarkup = (shape: LineShape, selected: boolean, extraClass = ''): string => {
  const connection = shape.connection!
  const color = escape(shape.stroke ?? '#000000')
  const points = connectionPoints(shape)
  const d = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
  const conductor = points.length > 2
    ? `<path class="connection-conductor" data-shape-id="${escape(shape.id)}" d="${d}"/>`
    : `<line class="shape-line connection-conductor" data-shape-id="${escape(shape.id)}" data-selected="${selected}" style="stroke:inherit;stroke-width:inherit" x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}"/>`
  const branch = connection.kind === 'branch' ? `<circle class="connection-junction" cx="${shape.start.x}" cy="${shape.start.y}" r="4" fill="${color}" stroke="none"/>` : ''
  const label = connectionTextLayout(shape)
  // Circuit trunks already have a placement symbol beside their cable caption.
  // Keep the generic slash for standalone cables and the topology supply only.
  const cable = connection.kind === 'cable' && connection.labelOwner !== 'circuit' && Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y) > 24
    ? `<path class="connection-cable-marker" d="M -5 -7 L 5 7" transform="translate(${label.x - (Math.abs(label.angle) > 45 ? 32 : 0)} ${label.y + (Math.abs(label.angle) > 45 ? 0 : 16)}) rotate(${label.angle})"/>` : ''
  const value = connection.labelOwner ? '' : connectionLabel(connection)
  const text = value ? `<text class="connection-label" x="${label.x}" y="${label.y}" transform="rotate(${label.angle} ${label.x} ${label.y})" text-anchor="middle" font-family="${PROTECTION_FONT_FAMILY}" font-size="${PROTECTION_TEXT_SIZE}" font-weight="400" fill="${color}" stroke="none">${paperTextContentMarkup({ id: shape.id, kind: 'text', position: label,
    text: wrapPaperText(value, PROTECTION_TEXT_SIZE).join('\n'), scale: PROTECTION_TEXT_SIZE / 18 })}</text>` : ''
  return `<g class="shape shape-line shape-connection ${escape(extraClass)}" data-shape-id="${escape(shape.id)}" data-connection-kind="${connection.kind}" data-selected="${selected}" fill="none" stroke="${color}" style="stroke-width:${shape.strokeWidth ?? 2}px" stroke-linecap="round" stroke-linejoin="round"><title>${CONNECTION_NAMES[connection.kind]}</title>${conductor}${branch}${cable}${text}</g>`
}
