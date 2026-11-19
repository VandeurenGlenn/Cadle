import ARKit
import RoomPlan
import SwiftUI

struct RoomPlanCaptureView: UIViewRepresentable {
    @ObservedObject var scanner: RoomPlanScannerModel

    func makeCoordinator() -> Coordinator {
        Coordinator(scanner: scanner)
    }

    func makeUIView(context: Context) -> RoomCaptureView {
        let view = RoomCaptureView(frame: .zero, arSession: scanner.arSession)
        let session = view.captureSession!
        session.delegate = context.coordinator
        scanner.captureSession = session
        session.run(RoomCaptureSession.Configuration())
        return view
    }

    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}

    static func dismantleUIView(_ uiView: RoomCaptureView, coordinator: Coordinator) {
        coordinator.scanner.captureSession = nil
    }

    final class Coordinator: NSObject, RoomCaptureSessionDelegate {
        let scanner: RoomPlanScannerModel

        init(scanner: RoomPlanScannerModel) {
            self.scanner = scanner
        }

        func captureSession(
            _ session: RoomCaptureSession,
            didEndWith data: CapturedRoomData,
            error: Error?
        ) {
            Task {
                if let error {
                    await scanner.captureFailed(error)
                    return
                }

                do {
                    let room = try await RoomBuilder(options: .init()).capturedRoom(from: data)
                    await scanner.captureFinished(room)
                } catch {
                    await scanner.captureFailed(error)
                }
            }
        }
    }
}
