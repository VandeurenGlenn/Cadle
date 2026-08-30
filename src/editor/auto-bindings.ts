import {
  inferCircuitType,
  inferElectricalRole,
  isDistributionBoardDevice,
  type ElectricalCircuitType,
  type ElectricalRole
} from './model/electrical.js'
import type { Point, Shape } from './model/types.js'
import { namedRoomRegions, roomNameAtPoint, shapeAnchorPoint } from './room-regions.js'

const MAX_SOCKET_POINTS_PER_CIRCUIT = 8

type Device = {
  shape: Shape
  point: Point
  role: ElectricalRole
  circuitType: ElectricalCircuitType
  roomName?: string
}

type DeviceCluster = Device[]

export type AutomaticBindingPlan = {
  assignments: Map<string, string>
  circuitCount: number
  lightingCircuitCount: number
  socketCircuitCount: number
}

const bindingFamily = (bindingId: string | undefined): string | null => {
  const match = /^([A-Z]{1,4})(?:\d+)?$/.exec(bindingId?.trim().toUpperCase() ?? '')
  return match?.[1] ?? null
}

const familyName = (index: number): string => {
  let value = index
  let result = ''
  do {
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return result
}

const distanceSquared = (left: Point, right: Point): number => (left.x - right.x) ** 2 + (left.y - right.y) ** 2

const centroid = (cluster: DeviceCluster): Point => ({
  x: cluster.reduce((sum, device) => sum + device.point.x, 0) / cluster.length,
  y: cluster.reduce((sum, device) => sum + device.point.y, 0) / cluster.length
})

const spatialOrder = (devices: Device[]): Device[] =>
  [...devices].sort((left, right) => left.point.y - right.point.y || left.point.x - right.point.x)

const clusterOrder = (clusters: DeviceCluster[]): DeviceCluster[] =>
  [...clusters].sort((left, right) => {
    const leftCenter = centroid(left)
    const rightCenter = centroid(right)
    return leftCenter.y - rightCenter.y || leftCenter.x - rightCenter.x
  })

const mergeToCount = (devices: Device[], targetCount: number): DeviceCluster[] => {
  const clusters = devices.map((device) => [device])
  while (clusters.length > targetCount) {
    let bestLeft = 0
    let bestRight = 1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let left = 0; left < clusters.length; left += 1) {
      for (let right = left + 1; right < clusters.length; right += 1) {
        const distance = distanceSquared(centroid(clusters[left]), centroid(clusters[right]))
        if (distance < bestDistance) {
          bestDistance = distance
          bestLeft = left
          bestRight = right
        }
      }
    }
    clusters[bestLeft].push(...clusters[bestRight])
    clusters.splice(bestRight, 1)
  }
  return clusterOrder(clusters)
}

const proximityOrder = (devices: Device[]): Device[] => {
  const remaining = new Set(devices)
  const ordered: Device[] = []
  let current = spatialOrder(devices)[0]
  while (current) {
    ordered.push(current)
    remaining.delete(current)
    let nearest: Device | undefined
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const candidate of remaining) {
      const roomPenalty = current.roomName && candidate.roomName && current.roomName !== candidate.roomName ? 1e12 : 0
      const distance = distanceSquared(current.point, candidate.point) + roomPenalty
      if (distance < nearestDistance) {
        nearest = candidate
        nearestDistance = distance
      }
    }
    current = nearest
  }
  return ordered
}

const socketClusters = (devices: Device[]): DeviceCluster[] => {
  const ordered = proximityOrder(devices)
  const clusters: DeviceCluster[] = []
  for (let index = 0; index < ordered.length; index += MAX_SOCKET_POINTS_PER_CIRCUIT) {
    clusters.push(ordered.slice(index, index + MAX_SOCKET_POINTS_PER_CIRCUIT))
  }
  return clusters
}

const electricalDevice = (shape: Shape, roomName?: string): Device | null => {
  if (shape.kind !== 'symbol' && shape.kind !== 'image') return null
  if (shape.groupId?.startsWith('onewire-')) return null
  const point = shapeAnchorPoint(shape)
  if (!point) return null
  if (shape.kind === 'image') {
    return {
      shape,
      point,
      role: inferElectricalRole(shape.name, shape.path),
      circuitType: inferCircuitType(shape.name, shape.path),
      roomName
    }
  }
  if (shape.electrical?.oneWireEligible === false) return null
  const inferredRole = inferElectricalRole(shape.name, shape.path)
  const role = shape.electrical?.role && shape.electrical.role !== 'neutral' ? shape.electrical.role : inferredRole
  if (role === 'neutral') return null
  return {
    shape,
    point,
    role,
    circuitType: shape.electrical?.circuitType ?? inferCircuitType(shape.name, shape.path),
    roomName
  }
}

export const planAutomaticBindings = (shapes: readonly Shape[], lightingCircuitCount: number): AutomaticBindingPlan => {
  const requestedLightingCircuits = Math.max(1, Math.floor(lightingCircuitCount))
  const rooms = namedRoomRegions(shapes)
  const devices = shapes.flatMap((shape) => {
    const point = shapeAnchorPoint(shape)
    const roomName = point ? roomNameAtPoint(rooms, point) : undefined
    const device = electricalDevice(shape, roomName)
    return device ? [device] : []
  })
  const assignments = new Map<string, string>()
  const usedFamilies = new Set(
    shapes.map((shape) => bindingFamily(shape.bindingId)).filter((family): family is string => Boolean(family))
  )
  const createdFamilies = new Set<string>()
  let familyIndex = 0
  const nextFamily = (): string => {
    while (usedFamilies.has(familyName(familyIndex))) familyIndex += 1
    const family = familyName(familyIndex)
    familyIndex += 1
    usedFamilies.add(family)
    createdFamilies.add(family)
    return family
  }
  const assignCluster = (cluster: DeviceCluster): string => {
    const family = nextFamily()
    spatialOrder(cluster).forEach((device, index) => assignments.set(device.shape.id, `${family}${index + 1}`))
    return family
  }

  const unlabeled = devices.filter((device) => !device.shape.bindingId?.trim())
  const lightingLoads = unlabeled.filter((device) => device.role === 'load' && device.circuitType === 'lighting')
  const lightingClusters = lightingLoads.length
    ? mergeToCount(lightingLoads, Math.min(requestedLightingCircuits, lightingLoads.length))
    : []
  lightingClusters.forEach(assignCluster)

  const labeledLighting = devices.filter(
    (device) =>
      device.role === 'load' &&
      device.circuitType === 'lighting' &&
      (device.shape.bindingId?.trim() || assignments.has(device.shape.id))
  )
  const switches = unlabeled.filter((device) => device.role === 'switch')
  for (const device of switches) {
    const nearestLight = labeledLighting.reduce<Device | null>((nearest, candidate) => {
      if (!nearest) return candidate
      return distanceSquared(device.point, candidate.point) < distanceSquared(device.point, nearest.point)
        ? candidate
        : nearest
    }, null)
    const lightBinding = nearestLight
      ? (assignments.get(nearestLight.shape.id) ?? nearestLight.shape.bindingId?.trim().toUpperCase())
      : undefined
    if (lightBinding) assignments.set(device.shape.id, lightBinding)
    else assignCluster([device])
  }

  const sockets = unlabeled.filter((device) => device.role === 'load' && device.circuitType === 'sockets')
  const groupedSockets = socketClusters(sockets)
  groupedSockets.forEach(assignCluster)

  const handled = new Set(assignments.keys())
  const remaining = unlabeled.filter((device) => !handled.has(device.shape.id))
  for (const device of spatialOrder(remaining)) {
    if (
      isDistributionBoardDevice(
        device.shape.kind === 'symbol' || device.shape.kind === 'image' ? device.shape.name : '',
        device.shape.kind === 'symbol' || device.shape.kind === 'image' ? device.shape.path : ''
      ) &&
      !usedFamilies.has('ALSB')
    ) {
      assignments.set(device.shape.id, 'ALSB')
      usedFamilies.add('ALSB')
      createdFamilies.add('ALSB')
      continue
    }
    assignCluster([device])
  }

  return {
    assignments,
    circuitCount: createdFamilies.size,
    lightingCircuitCount: lightingClusters.length,
    socketCircuitCount: groupedSockets.length
  }
}
