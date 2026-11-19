# Cadle RoomPlan scanner

This iOS companion app scans rooms with Apple's RoomPlan framework and exports a Cadle drawing JSON file. The file contains editable walls, doors and windows at a 1:100 drawing scale.

## Requirements

- Xcode with the iOS 17 SDK
- A physical iPhone or iPad with LiDAR and RoomPlan support
- iOS 17 or newer for combining multiple room scans

The iOS simulator cannot capture LiDAR scans.

## Build and scan

1. Open `ios/RoomPlanScanner.xcodeproj` in Xcode.
2. Select your iPhone as the run destination and set your development team in Signing & Capabilities.
3. Build and install **CadleRoomPlan**.
4. Scan one room at a time. Keep the phone moving slowly and include each wall.
5. Select **Scan volgende ruimte** for every additional room, then **Maak plattegrond**.
6. Use **Bewaar of deel naar Cadle** to save the JSON file in Files.
7. In Cadle, open **File → Import → Import RoomPlan-scan** and select that file.

The scanner does not upload scans. Cadle opens the exported file locally and imports the resulting drawing into the current page.
