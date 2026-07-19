import type { Point } from '../native-draw/types.js'

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
    match: /switches\/switch general symbol\.svg$/i,
    spec: { viewBox: { width: 6.82076, height: 13.368 }, node: { x: 2.955, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
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
    match: /switches\/single pole illuminated switch\.svg$/i,
    spec: { viewBox: { width: 6.82076, height: 13.368 }, node: { x: 2.955, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
  },
  {
    match: /switches\/single pole (delayed|pull) switch\.svg$/i,
    spec: { viewBox: { width: 8.79345, height: 13.368 }, node: { x: 2.955, y: 10.41 }, cutRadius: SWITCH_NODE_RADIUS }
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
    // Plain X cross — drawn over the wire, no interruption. Lamps render
    // noticeably smaller than switch assemblies.
    match: /consumption appliances\/lighting\.svg$/i,
    spec: {
      viewBox: { width: 11.6358, height: 11.6358 },
      node: { x: 5.8179, y: 5.8179 },
      cutRadius: null,
      oneWireScale: 1.15
    }
  },
  {
    // Spot symbol should sit inline on the branch and keep the wire continuous.
    match: /consumption appliances\/recessed spotlight\.svg$/i,
    spec: {
      viewBox: { width: 13.2, height: 13.2 },
      node: { x: 6.6, y: 6.6 },
      cutRadius: null,
      oneWireScale: 0.82
    }
  },
  {
    // Wall light is rotated to stand upright on horizontal one-wire branches.
    match: /consumption appliances\/wall light\.svg$/i,
    spec: {
      viewBox: { width: 22.9172, height: 14.4132 },
      // Keep wall light centered on the branch axis and let the branch pass
      // through to avoid asymmetric edge-cut artifacts after rotation.
      node: { x: 11.4586, y: 7.2066 },
      cutRadius: null,
      oneWireScale: 1.7,
      rotation: 90
    }
  },
  {
    // Projector variants align on the body center; passthrough keeps branch
    // continuity and avoids oversized gaps from beam geometry.
    match: /consumption appliances\/projector with (little )?divergent beam\.svg$/i,
    spec: {
      viewBox: { width: 26.5538, height: 24.5211 },
      node: { x: 13.2769, y: 12.26056 },
      cutRadius: null,
      oneWireScale: 0.92
    }
  },
  {
    // TL bar — placed rotated 90° so it stands upright on the wire; the wire is
    // interrupted over the bar's (rotated) thickness.
    match: /consumption appliances\/fluorescent lamp\.svg$/i,
    spec: {
      viewBox: { width: 22.9172, height: 5.90929 },
      node: { x: 11.58, y: 2.83 },
      cutRadius: 2.955,
      oneWireScale: 1.5,
      rotation: 90
    }
  },
  {
    // Circle with M — interrupt at the circle edge.
    match: /consumption appliances\/motor\.svg$/i,
    spec: {
      viewBox: { width: 11.5886, height: 11.5886 },
      node: { x: 5.7943, y: 5.7943 },
      cutRadius: 5.66929,
      oneWireScale: 0.7
    }
  }
]

// Rendered node radius shared by every switch on a wire (matches the two-way /
// intermediate switch look the user approved).
const TARGET_NODE_RADIUS = 5.6
const NODE_CUT_MARGIN = 0.35

const findSpec = (path: string): NodeSpec | null => NODE_SPECS.find(({ match }) => match.test(path))?.spec ?? null

// Maps the node from viewBox coordinates into the rendered 24×scale box
// (inner <svg> uses preserveAspectRatio "xMidYMid meet").
export const oneWireSymbolNodeInfo = (path: string, scale: number): OneWireNodeInfo | null => {
  const spec = findSpec(path)
  if (!spec) return null
  const { viewBox, node, cutRadius } = spec
  const size = 24 * Math.max(0.4, scale)
  const svgScale = size / Math.max(viewBox.width, viewBox.height)
  const xOff = (size - viewBox.width * svgScale) / 2
  const yOff = (size - viewBox.height * svgScale) / 2
  return {
    offset: {
      x: xOff + node.x * svgScale - size / 2,
      y: yOff + node.y * svgScale - size / 2
    },
    cutHalfWidth: cutRadius === null ? null : cutRadius * svgScale + NODE_CUT_MARGIN
  }
}

// Node-normalized one-wire scale: every switch circle renders at the same
// radius regardless of its viewBox proportions; lamps/TL/motor use explicit
// scales. Returns null for unknown symbols (caller keeps its heuristic).
export const oneWireSymbolScaleFor = (path: string): number | null => {
  const spec = findSpec(path)
  if (!spec) return null
  if (typeof spec.oneWireScale === 'number') return spec.oneWireScale
  if (spec.cutRadius === null) return null
  const maxViewBox = Math.max(spec.viewBox.width, spec.viewBox.height)
  return (TARGET_NODE_RADIUS * maxViewBox) / (24 * spec.cutRadius)
}

// Inline placement rotation (e.g. TL bars stand upright on horizontal wires).
export const oneWireSymbolRotationFor = (path: string): number | undefined => findSpec(path)?.rotation
