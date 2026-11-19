import ARKit
import Combine
import Foundation
import RoomPlan

@MainActor
final class RoomPlanScannerModel: ObservableObject {
    let arSession = ARSession()

    @Published private(set) var rooms: [CapturedRoom] = []
    @Published private(set) var isCapturing = false
    @Published private(set) var isProcessingRoom = false
    @Published private(set) var isBuilding = false
    @Published private(set) var status = "Scan ruimte per ruimte en maak daarna de plattegrond."
    @Published private(set) var error: String?
    @Published private(set) var exportURL: URL?
    var captureSession: RoomCaptureSession?

    func startCapture() {
        guard RoomCaptureSession.isSupported else {
            error = "RoomPlan is niet beschikbaar op dit toestel."
            return
        }
        error = nil
        exportURL = nil
        isCapturing = true
    }

    func stopCapture() {
        guard !isProcessingRoom else { return }
        isProcessingRoom = true
        captureSession?.stop(pauseARSession: false)
    }

    func captureFinished(_ room: CapturedRoom) {
        rooms.append(room)
        captureSession = nil
        isProcessingRoom = false
        isCapturing = false
        status = "Ruimte toegevoegd. Scan nog een ruimte of maak de plattegrond."
    }

    func captureFailed(_ failure: Error) {
        captureSession = nil
        isProcessingRoom = false
        isCapturing = false
        error = "Ruimte verwerken mislukt: \(failure.localizedDescription)"
    }

    func createDrawing() async {
        guard !rooms.isEmpty else { return }
        isBuilding = true
        error = nil
        defer { isBuilding = false }

        do {
            let structure = try await StructureBuilder(options: .init()).capturedStructure(from: rooms)
            let segments =
                structure.walls.map { Self.segment($0, kind: "wall") } +
                structure.doors.map { Self.segment($0, kind: "door") } +
                structure.windows.map { Self.segment($0, kind: "window") }
            let data = try CadleDrawingExporter.encode(segments)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("cadle-roomplan-\(UUID().uuidString).json")
            try data.write(to: url, options: .atomic)
            exportURL = url
            status = "Plattegrond klaar. Bewaar het JSON-bestand en importeer het in Cadle."
        } catch {
            self.error = "Plattegrond maken mislukt: \(error.localizedDescription)"
        }
    }

    private static func segment(_ surface: CapturedRoom.Surface, kind: String) -> RoomPlanSegment {
        let axis = surface.transform.columns.0
        let center = surface.transform.columns.3
        return RoomPlanSegment(
            kind: kind,
            centerX: Double(center.x),
            centerZ: Double(center.z),
            axisX: Double(axis.x),
            axisZ: Double(axis.z),
            widthMetres: Double(surface.dimensions.x)
        )
    }
}
