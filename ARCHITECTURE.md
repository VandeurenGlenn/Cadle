# Cadle architecture

Cadle is organized around a thin UI layer and framework-independent drawing logic. New behavior should move toward the
domain modules below instead of increasing the responsibilities of `editor/cadle-app.ts` or `shell/app-shell.ts`.

## Runtime boundaries

- `src/editor/cadle-app.ts` — `<cadle-app>` composition root for the SVG editor. It connects controllers to rendering,
  persistence, and browser events; its public custom-element API must remain stable.
- `src/shell/app-shell.ts` — application shell composition root and project/page orchestration.
- `src/editor/model/` — canonical shape types, document-state validation, geometry, normalization, and legacy migration.
  Modules here must not depend on UI components or persistence.
- `src/editor/controllers/` — stateful editor controllers for history, tools, the viewport, and ordered persistence.
- Ordered persistence reports saving/saved/error from actual writes. A failed operation and all successors remain queued
  until an explicit retry; the status bar offers retry and an in-memory project download without requiring a successful save.
- `src/data/project-recovery.ts` — bounded, non-recursive full-project recovery points stored atomically with the project.
  The History panel restores all pages and circuit metadata, retains the pre-restore state, and keeps the last ten points.
  A restored source fingerprint preserves the chosen state across reopening; subsequent source changes resume synchronization.
  Ordinary opening and PDF export preserve saved page geometry, including older layouts. Layout migration is explicit
  through drawing import or one-wire regeneration, both protected by a recovery point.
  Source synchronization updates affected linked circuits without globally repacking rails or redistributing pages.
  Known generated legacy contacts are repaired against actual symbol ports without moving devices; orphaned
  automatic rail feeders are removed. These load-time repairs share the synchronization recovery point.
  Circuit packing never treats an upstream differential as an outgoing breaker or owns its supply branch.
  Stationary rail taps remain covered when the outgoing circuits are packed; the rail keeps its own center.
  Overflow pagination belongs to explicit import/generation, never generic history recording or a single-rail insertion.
- `src/editor/cable-estimate.ts` estimates cable route metres per circuit, board and cable designation for the circuit overview.
  It uses a rectilinear minimum spanning tree of labelled floor-plan devices and the selected board symbol at the page scale.
  Board locations are stable page/shape references, so moving a symbol or reassigning a circuit recalculates the estimate.
  Schematic geometry, heating-plan copies and arbitrary inter-page offsets never contribute physical metres.
  Missing positions/scales and unmeasured pages are explicit; partial totals exclude unknown lengths.
  The estimate excludes vertical runs, wall-routing detours, spare cable and inter-board feeds; VOB totals are route metres, not conductor metres.
- The circuit overview combines configured and schematic-only differentials, shows main/row protection chains and
  their supplied circuits, and flags missing or ambiguous assignments. Manual differentials follow actual conductor
  contacts to their outgoing rails, scoped to each schematic page; bare crossings never establish an assignment.
  Its cabinet planner reuses the saved module order, 18/24-module width and reserved gaps. Pole-count widths are
  indicative, and changing the physical module arrangement does not change electrical connections or schematic geometry.
  Toggling a connection caption updates visibility only, without invoking circuit presentation spacing or rail packing.
- `src/editor/keyboard/` — editor hotkey definitions, resolution, and command descriptors.
- `src/editor/interaction/` — keyboard, pointer, selection, and shape-transform use cases.
- Stairs are editable rectangle shapes (`stairs-straight`, `stairs-quarter-turn`, `stairs-spiral`), not fixed-size
  catalog placements. Dragging defines their width and length with a live preview; Shift constrains the footprint
  to a square. `src/editor/model/stair-geometry.ts` supplies the shared tread, outline, and direction paths for the
  editor and SVG export. Existing catalog stair symbols remain supported.
- `src/editor/layout/` — catalog, symbol, title-block, and one-wire layout generation.
- The access-point and heat-pump drawing actions place catalog SVGs from `www/symbols/General/` and
  `www/symbols/Consumption appliances/`. The shared SVG loader defaults all symbol ink to black, independent
  of source colors and UI text color, while retaining transparent parts, white cutouts, and explicit object color overrides.
- `src/editor/layout/onewire-circuit-presentation.ts` — pure resolution of circuit inspector values and generated
  one-wire labels/symbol presentation. It receives shapes and project-domain inputs and returns transformed shapes;
  it does not render, mutate editor state, or persist data.
- Breaker ratings share `breakerCurrentLabel` for curve/current text (for example `C20A`), including manual devices,
  generated labels, and annotation bounds. Curve-only edits retain the existing current; RCD ratings have no curve.
- Generated circuit headings move beside a continuous vertical feed instead of printing across it. The existing
  label-position controls also place these headings; explicit offsets survive regeneration, and duplicate automatic
  binding labels for the same circuit heading are suppressed.
- One-wire rail packing orders manual and generated circuit protections together using their actual terminal contacts.
  Unlabelled protections retain their relative order after named circuits; each rail keeps its own center, and manual
  circuit groups and attached conductors follow their protection without moving independent rail-to-rail feeders.
  Ungrouped devices and wires connected to exactly one circuit move rigidly with that branch. Ownership follows actual
  terminal contacts and wire junctions, never crossings, proximity, or continuity through a busbar or a shared circuit.
- The automatic heating planner reserves a complete, disjoint supply/return approach bundle before packing leg fields.
  Measured feeder detours contribute to circuit length budgets. Additional fields trigger renewed pair reservations;
  final rounded routes still require geometry and continuity checks before any result replaces the existing plan.
  Door leaves and swing arcs are above-floor geometry, never pipe obstacles, including legacy obstacle flags on doors.
  The actual threshold defines the room boundary and passage; walls, jambs and fixed furnishings still constrain routes.
  New automatic loops return to the same entry area: their ends face the same approach and are at most two laying
  intervals apart, plus one raster cell. Field merging must preserve this before the physical connections are routed.
  Inaccessible rectangular field entries can change axes rather than only mirror, including previously door-aligned fields.
  Interior-mounted sources may route directly through recognised internal partitions from the initial feeder reservation,
  including the source-room wall and partitions whose sides connect elsewhere. Facades, shafts, furnishings and door jambs remain unavailable for new passages.
  Open tails then stay near the source rather than being forced toward its door. All used wall crossings, including
  joined loops and retained circuits, are marked from the rendered curves and require construction/protection review.
  `test/fixtures/heating-cadle-project.json` preserves the supplied complete version-2 Cadle export, separately from
  the older `heating-floor-12.json` shape fixture. Its regressions use normal shape sanitization without altering the input.
- `src/editor/export/` — SVG/PDF/download concerns and export commands. Shared editor policies remain directly in
  `src/editor/`.
- `src/api/` — persistence gateways for projects and catalogs.
- `src/data/` — project document persistence, page schema transformations, and persisted page operations.
- `src/catalog/` — custom catalog structure, symbols, and per-symbol defaults.
- `src/sharing/` — project sharing, presence, and multi-user transports.
- `src/ui/` — application-wide presentation primitives such as icon registration and context menus.
- `src/preferences/` — validated application preferences and their storage adapters.
- `src/elements/`, `src/fields/` — custom elements grouped by UI role. Complex panes keep models and configuration in
  a same-named subfolder (for example, `elements/panes/object-pane/`).
- `src/shell/` — the application shell component, its styles, and routing.
- `test/` — Node tests for pure domain modules and controllers.

## Dependency direction

```text
UI elements / editor app / shell
          ↓
controllers and use cases (`editor`)
          ↓
shape and electrical domain (`editor/model`)
          ↓
           types
```

Persistence is invoked by the composition roots after a controller changes state. Pure controllers should not import
custom elements, browser storage, or rendering code.

## Change guidelines

1. Extract one responsibility at a time from `editor/cadle-app.ts` or `shell/app-shell.ts` behind a small typed API.
2. Add unit tests for the extracted behavior before moving the next responsibility.
3. Keep state cloning and invariants at controller boundaries so callers cannot mutate stored state accidentally.
4. Keep generated files in `www/` out of source refactors; `npm run build` recreates them.
5. Run `npm run check` before submitting a change.

`CadleApp` may coordinate a domain transformation with history, rendering, and persistence, but it must not duplicate
the transformation itself. The next useful boundaries are pointer-session orchestration, project persistence queues,
and export-session state; see `IMPROVEMENT_ROADMAP.md` for the product sequence.
