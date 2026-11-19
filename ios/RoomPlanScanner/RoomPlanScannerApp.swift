import SwiftUI

@main
struct RoomPlanScannerApp: App {
    @StateObject private var scanner = RoomPlanScannerModel()

    var body: some Scene {
        WindowGroup {
            ScannerScreen(scanner: scanner)
        }
    }
}

private struct ScannerScreen: View {
    @ObservedObject var scanner: RoomPlanScannerModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if scanner.isCapturing {
                    RoomPlanCaptureView(scanner: scanner)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(alignment: .bottom) {
                            Button("Kamer afronden") {
                                scanner.stopCapture()
                            }
                            .buttonStyle(.borderedProminent)
                            .padding()
                            .disabled(scanner.isProcessingRoom)
                        }
                        .overlay(alignment: .top) {
                            Text("Beweeg langzaam en scan alle muren.")
                                .font(.subheadline)
                                .padding(10)
                                .background(.regularMaterial, in: Capsule())
                                .padding()
                        }
                } else {
                    ContentUnavailableView(
                        scanner.rooms.isEmpty ? "Scan je eerste ruimte" : "Ruimte gescand",
                        systemImage: "viewfinder",
                        description: Text(scanner.status)
                    )
                    .frame(maxHeight: .infinity)

                    if !scanner.rooms.isEmpty {
                        Text("\(scanner.rooms.count) ruimte(n) klaar")
                            .font(.headline)

                        Button("Scan volgende ruimte") {
                            scanner.startCapture()
                        }
                        .buttonStyle(.bordered)

                        Button(scanner.isBuilding ? "Plattegrond maken…" : "Maak plattegrond") {
                            Task { await scanner.createDrawing() }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(scanner.isBuilding)
                    } else if RoomCaptureSession.isSupported {
                        Button("Start LiDAR-scan") {
                            scanner.startCapture()
                        }
                        .buttonStyle(.borderedProminent)
                    } else {
                        Text("RoomPlan is niet beschikbaar op dit toestel. Gebruik een iPhone Pro met LiDAR.")
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                    }
                }

                if let error = scanner.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                if let exportURL = scanner.exportURL {
                    ShareLink(
                        item: exportURL,
                        preview: SharePreview("Cadle RoomPlan-plattegrond")
                    ) {
                        Label("Bewaar of deel naar Cadle", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding()
            .navigationTitle("Cadle LiDAR")
        }
    }
}
