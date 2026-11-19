import Foundation

struct RoomPlanSegment {
    let kind: String
    let centerX: Double
    let centerZ: Double
    let axisX: Double
    let axisZ: Double
    let widthMetres: Double
}

private struct CadlePoint: Encodable {
    let x: Double
    let y: Double
}

private struct CadleShape: Encodable {
    let id: String
    let kind: String
    let start: CadlePoint
    let end: CadlePoint
}

private struct CadleDrawing: Encodable {
    let format = "cadle-roomplan"
    let formatVersion = 1
    let version = 1
    let drawingScale = 100
    let paperPreset: String
    let printMargin = 10
    let worldWidth: Double
    let worldHeight: Double
    let shapes: [CadleShape]
}

enum CadleDrawingExportError: Error {
    case noUsableSurfaces
}

enum CadleDrawingExporter {
    private static let worldUnitsPerMillimetre = 8.0
    private static let metresToWorldUnitsAtScale100 = 80.0

    static func encode(_ source: [RoomPlanSegment]) throws -> Data {
        let segments = source.compactMap(normalize)
        guard !segments.isEmpty else { throw CadleDrawingExportError.noUsableSurfaces }

        let points = segments.flatMap { [$0.start, $0.end] }
        let minX = points.map(\.x).min() ?? 0
        let maxX = points.map(\.x).max() ?? 0
        let minY = points.map(\.y).min() ?? 0
        let maxY = points.map(\.y).max() ?? 0
        let widthMetres = (maxX - minX) / metresToWorldUnitsAtScale100
        let heightMetres = (maxY - minY) / metresToWorldUnitsAtScale100
        let paper = paperPreset(widthMetres: widthMetres, heightMetres: heightMetres)
        let worldWidth = paper.widthMillimetres * worldUnitsPerMillimetre
        let worldHeight = paper.heightMillimetres * worldUnitsPerMillimetre
        let centerX = (minX + maxX) / 2
        let centerY = (minY + maxY) / 2
        let shapes = segments.enumerated().map { index, segment in
            CadleShape(
                id: "roomplan-\(segment.kind)-\(index + 1)",
                kind: segment.kind,
                start: CadlePoint(
                    x: worldWidth / 2 + segment.start.x - centerX,
                    y: worldHeight / 2 + segment.start.y - centerY
                ),
                end: CadlePoint(
                    x: worldWidth / 2 + segment.end.x - centerX,
                    y: worldHeight / 2 + segment.end.y - centerY
                )
            )
        }
        let drawing = CadleDrawing(
            paperPreset: paper.name,
            worldWidth: worldWidth,
            worldHeight: worldHeight,
            shapes: shapes
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(drawing)
    }

    private static func normalize(_ segment: RoomPlanSegment) -> (kind: String, start: CadlePoint, end: CadlePoint)? {
        guard
            ["wall", "door", "window"].contains(segment.kind),
            segment.centerX.isFinite,
            segment.centerZ.isFinite,
            segment.axisX.isFinite,
            segment.axisZ.isFinite,
            segment.widthMetres.isFinite,
            segment.widthMetres > 0
        else {
            return nil
        }

        let axisLength = hypot(segment.axisX, segment.axisZ)
        guard axisLength > 0 else { return nil }
        let halfWidth = segment.widthMetres * metresToWorldUnitsAtScale100 / 2
        let axisX = segment.axisX / axisLength
        let axisY = -segment.axisZ / axisLength
        let center = CadlePoint(
            x: segment.centerX * metresToWorldUnitsAtScale100,
            y: -segment.centerZ * metresToWorldUnitsAtScale100
        )
        return (
            segment.kind,
            CadlePoint(x: center.x - axisX * halfWidth, y: center.y - axisY * halfWidth),
            CadlePoint(x: center.x + axisX * halfWidth, y: center.y + axisY * halfWidth)
        )
    }

    private static func paperPreset(widthMetres: Double, heightMetres: Double) -> (name: String, widthMillimetres: Double, heightMillimetres: Double) {
        let widthAtScale = widthMetres * 10
        let heightAtScale = heightMetres * 10
        if widthAtScale <= 277 && heightAtScale <= 173 {
            return ("a4-landscape", 297, 210)
        }
        if widthAtScale <= 190 && heightAtScale <= 260 {
            return ("a4-portrait", 210, 297)
        }
        if widthAtScale <= 400 && heightAtScale <= 260 {
            return ("a3-landscape", 420, 297)
        }
        if widthAtScale <= 277 && heightAtScale <= 383 {
            return ("a3-portrait", 297, 420)
        }
        return widthAtScale >= heightAtScale ? ("a3-landscape", 420, 297) : ("a3-portrait", 297, 420)
    }
}
