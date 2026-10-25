import type { Point } from '../../editor/model/types.js'
import { renderedSymbolScale } from '../model/symbol-scale.js'

// One canonical rendered size for every Automaat.svg, independent of where it
// appears in the one-wire topology. The breaker is intentionally the visual
// anchor, while the rest of the row stays smaller so the feeder and cable labels
// remain legible and proportionate to the electrical reference.
export const ONE_WIRE_DEFAULT_SCALE = 0.68
export const ONE_WIRE_BREAKER_SCALE = 2.8

// The RCD asset has a much wider viewBox than the breaker asset. It therefore
// needs a slightly larger numeric scale to reach the same visible device height
// without competing with the dominant breaker treatment.
export const ONE_WIRE_RCD_SCALE = 2.2
export const ONE_WIRE_RENDERED_STROKE_WIDTH = 2

// Trikker-style wire connection metadata for the built-in one-wire symbols.
// node — not the bounding box — lands on the wire axis, and defines how wide
// the wire interruption around that node should be. `cutRadius: null` means
// the wire passes through uncut (e.g. lamp crosses drawn on top of the wire).
export type OneWireNodeInfo = {
  // Offset from the shape's 24×scale box center to the connection node.
  offset: Point
  // Half-width of the wire interruption around the node; null = passthrough.
  cutHalfWidth: number | null
}

export type OneWireTerminalInfo = {
  top?: Point
  bottom?: Point
}

type NodeSpec = {
  viewBox: { width: number; height: number }
  node: Point
  cutRadius: number | null
  // Explicit one-wire scale for symbols without a standard node circle.
  oneWireScale?: number
  // Rotate the symbol when placed inline on a horizontal wire (e.g. TL bar).
  rotation?: number
}

// All Visio switch symbols share the same node circle radius (2.83465) inside
// differently sized viewBoxes — normalizing on the node keeps every switch's
// circle the same rendered size on the wire.
const SWITCH_NODE_RADIUS = 2.83465

const NODE_SPECS: Array<{ match: RegExp; spec: NodeSpec }> = [
  {
    match: /wires\/underground cable\.svg$/i,
    spec: {
      viewBox: { width: 24, height: 54 },
      node: { x: 14, y: 52 },
      cutRadius: null,
      oneWireScale: 2.25
    }
  },
  {
    match:
      /wires\/(?:cable (?:in conduit(?: recessed in wall)?|without conduit|on wall|recessed in wall)|underground cable)\.svg$/i,
    spec: {
      viewBox: { width: 24, height: 54 },
      node: { x: 12, y: 52 },
      cutRadius: null,
      oneWireScale: 2.25
    }
  },
  {
    match: /socket outlets\/.*for floorplan\.svg$/i,
    spec: {
      viewBox: { width: 8.5115, height: 11.5955 },
      node: { x: 0.12, y: 5.8 },
      cutRadius: null,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE
    }
  },
  {
    match: /socket outlets\/.*\.svg$/i,
    spec: {
      viewBox: { width: 4.96819, height: 11.5955 },
      node: { x: 0.12, y: 5.8 },
      cutRadius: null,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE
    }
  },
  {
    match: /switches\/switch general symbol\.svg$/i,
    spec: { viewBox: { width: 6.82076, height: 13.368 }, node: { x: 2.955, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/(?:illuminated )?push button\.svg$/i,
    spec: {
      viewBox: { width: 8.74394, height: 8.74394 },
      node: { x: 4.37197, y: 4.37197 },
      cutRadius: 4.25197
    }
  },
  {
    match: /switches\/double push button\.svg$/i,
    spec: {
      viewBox: { width: 13.68, height: 8.74394 },
      node: { x: 6.9, y: 4.13197 },
      cutRadius: 5.5,
      oneWireScale: 1.425
    }
  },
  {
    match: /switches\/push switch with safety cover\.svg$/i,
    spec: {
      viewBox: { width: 10.1613, height: 20.2715 },
      node: { x: 4.37197, y: 10.04123 },
      cutRadius: 4.25197,
      oneWireScale: 0.95
    }
  },
  {
    match: /switches\/single pole switch with indicator light\.svg$/i,
    spec: { viewBox: { width: 17.2974, height: 13.368 }, node: { x: 11.455, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/single pole change over switch\.svg$/i,
    // Change-over uses a tall viewBox; include outer group translation so the
    // contact circle center lands exactly on the wire axis.
    spec: { viewBox: { width: 11.6776, height: 20.8268 }, node: { x: 5.835, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /(?:Custom breaker|protection devices\/automaat)\.svg$/i,
    spec: {
      viewBox: { width: 28.783, height: 28.8265 },
      node: { x: 15.3836, y: 28.47 },
      cutRadius: 2.83465,
      oneWireScale: ONE_WIRE_BREAKER_SCALE,
      rotation: 0
    }
  },
  {
    match: /(?:Custom )?Residual-current circuit breaker\.svg$/i,
    spec: {
      viewBox: { width: 38.5625, height: 29.8893 },
      node: { x: 15.3836, y: 29.5293 },
      cutRadius: 2.83465,
      // Its wide viewBox otherwise makes the visible breaker body shorter
      // than the square custom automaat at the same numerical scale.
      oneWireScale: ONE_WIRE_RCD_SCALE,
      rotation: 0
    }
  },
  {
    match: /switches\/single pole illuminated switch\.svg$/i,
    spec: { viewBox: { width: 6.82076, height: 13.368 }, node: { x: 2.955, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/(?:single pole (?:delayed|pull)|double pole(?: illuminated)?|triple pole) switch\.svg$/i,
    spec: { viewBox: { width: 8.79345, height: 13.368 }, node: { x: 2.955, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/dimmer switch\.svg$/i,
    spec: { viewBox: { width: 9.00472, height: 13.368 }, node: { x: 2.955, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/dual switch, single casing\.svg$/i,
    spec: { viewBox: { width: 12.0176, height: 13.2972 }, node: { x: 6.005, y: 10.34 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/double pole change over switch\.svg$/i,
    spec: { viewBox: { width: 11.6776, height: 20.8268 }, node: { x: 5.835, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/double change over switch \(wissel-wissel\)\.svg$/i,
    spec: { viewBox: { width: 11.6776, height: 20.8268 }, node: { x: 5.835, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/intermediate switch\.svg$/i,
    spec: { viewBox: { width: 11.6776, height: 20.8268 }, node: { x: 5.835, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/(?:impulse relay|time switch|electric lock or guard tour control device|thermostat|timer)\.svg$/i,
    spec: {
      viewBox: { width: 20.0825, height: 8.74394 },
      node: { x: 10.04125, y: 4.37197 },
      cutRadius: 9.92125,
      oneWireScale: 0.67473017
    }
  },
  {
    match: /switches\/niko home control dimmer\.svg$/i,
    spec: {
      viewBox: { width: 20, height: 10 },
      node: { x: 10, y: 5 },
      cutRadius: 9.5,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE
    }
  },
  {
    // Plain X cross — drawn over the wire, no interruption. Lamps render
    // noticeably smaller than switch assemblies.
    match: /consumption appliances\/lighting\.svg$/i,
    spec: {
      viewBox: { width: 11.6358, height: 11.6358 },
      node: { x: 5.8179, y: 5.8179 },
      cutRadius: null,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE
    }
  },
  {
    // Recessed spotlight should sit inline on the branch and keep the wire continuous.
    match: /consumption appliances\/recessed spotlight\.svg$/i,
    spec: {
      viewBox: { width: 13.2, height: 13.2 },
      node: { x: 2, y: 6.6 },
      cutRadius: null,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE
    }
  },
  {
    // Circular spot with an X, matching its ground-plan representation.
    match: /consumption appliances\/spot\.svg$/i,
    spec: {
      viewBox: { width: 16, height: 16 },
      node: { x: 1, y: 8 },
      cutRadius: null,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE
    }
  },
  {
    // The wall line forms the symbol's electrical base. Anchor its left end to
    // the branch so the lamp remains upright and entirely above the conductor.
    match: /consumption appliances\/wall light\.svg$/i,
    spec: {
      viewBox: { width: 22.9172, height: 14.4132 },
      node: { x: 0.12, y: 14.2932 },
      cutRadius: null,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE
    }
  },
  {
    // Projector variants align on the body center; passthrough keeps branch
    // continuity and avoids oversized gaps from beam geometry.
    match: /consumption appliances\/projector with (little )?divergent beam\.svg$/i,
    spec: {
      viewBox: { width: 26.5538, height: 24.5211 },
      node: { x: 4, y: 12.26056 },
      cutRadius: null,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE
    }
  },
  {
    // TL bar — placed rotated 90° so it stands upright on the wire; the wire is
    // interrupted over the bar's (rotated) thickness.
    match: /consumption appliances\/fluorescent lamp\.svg$/i,
    spec: {
      viewBox: { width: 22.9172, height: 5.90929 },
      node: { x: 11.46, y: 2.95 },
      cutRadius: 0.12,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE,
      rotation: 90
    }
  },
  {
    // Breaker anchors to its bottom terminal so it sits above the rail.
    match: /protection devices\/automaat\.svg$/i,
    spec: {
      viewBox: { width: 28.783, height: 28.8265 },
      node: { x: 15.3836, y: 28.47 },
      cutRadius: 2.83465,
      oneWireScale: ONE_WIRE_BREAKER_SCALE
    }
  },
  {
    // Circle with M — interrupt at the circle edge.
    match: /consumption appliances\/motor\.svg$/i,
    spec: {
      viewBox: { width: 11.5886, height: 11.5886 },
      node: { x: 5.7943, y: 5.7943 },
      cutRadius: 5.66929,
      oneWireScale: ONE_WIRE_DEFAULT_SCALE
    }
  }
]

type TerminalSpec = {
  viewBox: { width: number; height: number }
  top?: Point
  bottom?: Point
}

const TERMINAL_SPECS: Array<{ match: RegExp; spec: TerminalSpec }> = [
  {
    match: /consumption appliances\/kwh meter\.svg$/i,
    spec: {
      viewBox: { width: 17.5861, height: 17.2479 },
      top: { x: 8.8167, y: 0.12 },
      bottom: { x: 8.8167, y: 17.1279 }
    }
  },
  {
    match: /(?:Custom )?Residual-current circuit breaker\.svg$/i,
    spec: {
      viewBox: { width: 38.5625, height: 29.8893 },
      top: { x: 15.3836, y: 1.18 },
      bottom: { x: 15.3836, y: 29.5293 }
    }
  },
  {
    match: /protection devices\/automaat\.svg$/i,
    spec: {
      viewBox: { width: 28.783, height: 28.8265 },
      top: { x: 15.3836, y: 0.12 },
      bottom: { x: 15.3836, y: 28.47 }
    }
  },
  {
    match: /photovoltaic devices \(≠arei\)\/inverter\.svg$/i,
    spec: {
      viewBox: { width: 17.7579, height: 17.2579 },
      top: { x: 8.87895, y: 0.125 },
      bottom: { x: 8.87895, y: 17.1329 }
    }
  },
  {
    match: /photovoltaic devices \(≠arei\)\/solar panel\.svg$/i,
    spec: {
      viewBox: { width: 48.6079, height: 28.9659 },
      bottom: { x: 24.30395, y: 28.8459 }
    }
  },
  {
    match: /protection devices\/earth electrode\.svg$/i,
    spec: {
      viewBox: { width: 17.2479, height: 17.2479 },
      top: { x: 8.62, y: 0.12 }
    }
  },
  {
    match: /consumption appliances\/elektrische wagen ev\.svg$/i,
    spec: {
      viewBox: { width: 44, height: 34 },
      bottom: { x: 22, y: 34 }
    }
  },
  {
    match: /electrical devices\/laadpaal ev\.svg$/i,
    spec: {
      viewBox: { width: 40, height: 40 },
      bottom: { x: 20, y: 35 }
    }
  }
]

// Rendered node radius shared by every switch on a wire; the node itself must
// stay at the same electrical width no matter how the body is scaled. This keeps
// the visual balance right without disturbing the branch connection geometry.
const TARGET_NODE_RADIUS = 5.8
const MAX_NODE_NORMALIZED_SCALE = 0.85

const findSpec = (path: string): NodeSpec | null => NODE_SPECS.find(({ match }) => match.test(path))?.spec ?? null

export const oneWireSymbolBounds = (shape: { path: string; scale: number; position: Point; rotation?: number }) => {
  const spec = findSpec(shape.path)
  if (!spec) return null
  const svgScale =
    (24 * renderedSymbolScale(shape.path, shape.scale)) / Math.max(spec.viewBox.width, spec.viewBox.height)
  const radians = ((shape.rotation ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const width = svgScale * (spec.viewBox.width * cos + spec.viewBox.height * sin)
  const height = svgScale * (spec.viewBox.width * sin + spec.viewBox.height * cos)
  return { x: shape.position.x - width / 2, y: shape.position.y - height / 2, width, height }
}

const pointOffset = (viewBox: { width: number; height: number }, point: Point, scale: number): Point => {
  const size = 24 * Math.max(0.4, scale)
  const svgScale = size / Math.max(viewBox.width, viewBox.height)
  const xOff = (size - viewBox.width * svgScale) / 2
  const yOff = (size - viewBox.height * svgScale) / 2
  return {
    x: xOff + point.x * svgScale - size / 2,
    y: yOff + point.y * svgScale - size / 2
  }
}

// Maps the node from viewBox coordinates into the rendered 24×scale box
// (inner <svg> uses preserveAspectRatio "xMidYMid meet").
export const oneWireSymbolNodeInfo = (path: string, scale: number, rotation = 0): OneWireNodeInfo | null => {
  const spec = findSpec(path)
  if (!spec) return null
  const { viewBox, node, cutRadius } = spec
  const size = 24 * renderedSymbolScale(path, scale)
  const svgScale = size / Math.max(viewBox.width, viewBox.height)
  const xOff = (size - viewBox.width * svgScale) / 2
  const yOff = (size - viewBox.height * svgScale) / 2
  const rawOffset = {
    x: xOff + node.x * svgScale - size / 2,
    y: yOff + node.y * svgScale - size / 2
  }
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    offset: {
      x: rawOffset.x * cos - rawOffset.y * sin,
      y: rawOffset.x * sin + rawOffset.y * cos
    },
    cutHalfWidth: cutRadius === null ? null : cutRadius * svgScale
  }
}

// Electrical terminal offsets used by generated vertical topology chains.
// Unlike visual bounds, these points land on the actual SVG conductor ends.
export const oneWireSymbolTerminalInfo = (path: string, scale: number): OneWireTerminalInfo | null => {
  const spec = TERMINAL_SPECS.find(({ match }) => match.test(path))?.spec
  if (!spec) return null
  return {
    ...(spec.top ? { top: pointOffset(spec.viewBox, spec.top, scale) } : {}),
    ...(spec.bottom ? { bottom: pointOffset(spec.viewBox, spec.bottom, scale) } : {})
  }
}

// Node-normalized one-wire scale: every switch circle renders at the same
// radius regardless of its viewBox proportions; lamps/TL/motor use explicit
// scales. Returns null for unknown symbols (caller keeps its heuristic).
export const oneWireSymbolScaleFor = (path: string): number | null => {
  const spec = findSpec(path)
  if (!spec) return ONE_WIRE_DEFAULT_SCALE
  if (typeof spec.oneWireScale === 'number') return spec.oneWireScale
  if (spec.cutRadius === null) return ONE_WIRE_DEFAULT_SCALE
  const maxViewBox = Math.max(spec.viewBox.width, spec.viewBox.height)
  return Math.min(MAX_NODE_NORMALIZED_SCALE, (TARGET_NODE_RADIUS * maxViewBox) / (24 * spec.cutRadius))
}

export const oneWireSymbolStrokeWidthFor = (path: string, scale: number): number => {
  const spec = findSpec(path)
  if (!spec) return 0.65
  const size = 24 * renderedSymbolScale(path, scale)
  const svgScale = size / Math.max(spec.viewBox.width, spec.viewBox.height)
  return ONE_WIRE_RENDERED_STROKE_WIDTH / svgScale
}

// Inline placement rotation (e.g. TL bars stand upright on horizontal wires).
export const oneWireSymbolRotationFor = (path: string): number | undefined => findSpec(path)?.rotation
