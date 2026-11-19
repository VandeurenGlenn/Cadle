# Cadle architecture

Cadle is organized around a thin UI layer and framework-independent drawing logic. New behavior should move toward the
domain modules below instead of increasing the responsibilities of `editor/cadle-app.ts` or `shell/app-shell.ts`.

## Runtime boundaries

- `src/editor/cadle-app.ts` — `<cadle-app>` composition root for the SVG editor. It connects controllers to rendering,
  persistence, and browser events; its public custom-element API must remain stable.
  Committed SVG content and wall masks are revision-guarded: pointer previews, panning, zooming and panel resizing
  update the viewport/overlay without repeating document layout or symbol parsing. Document/selection changes and
  completed SVG loads invalidate the scene. Both outer drawing entries and group members are keyed by stable identity
  so insertion, deletion and undo retain unrelated SVG nodes instead of replacing their contents.
  Keyed lists use `repeat` from `@vandeurenglenn/lite`; callbacks return `html`/`svg` templates even for nested
  lists or hidden shapes, so Lite retains keyed rendering rather than falling back to plain value mapping.
- `src/shell/app-shell.ts` — application shell composition root and project/page orchestration.
  Only the active application route is mounted; the editor does not instantiate hidden settings/project-list routes.
  Linked-page context is derived once per shell render. Visited sidebar views remain mounted and hidden rather than
  re-created when switching tabs, preserving search, scroll and category state without repeating initialization.
- `src/sw.ts` — network-first SVG/OCR asset caching with offline fallback. A deterministic app-bundle fingerprint
  added by `rollup/service-worker-version.js` makes app releases detectable without changing the asset cache name.
  The shell checks on startup/focus and shows a persistent, route-independent reload notice when an existing
  controller is replaced (not on first installation). Reloading is explicit and flushes circuit updates and saves;
  failed persistence keeps the current document open and displays an error. App and Drive notices share a responsive stack.
- `src/elements/catalog/symbol-list.ts` — shared LiteElement for category, recent and picker symbol lists, keyed by
  section and symbol identity. Catalog filtering, overrides and counts are derived once per catalog render.
  Catalog SVG previews share in-flight loading and a bounded cache of raw markup and measured full/compact previews.
  Cards do not start a second image request while SVG markup is loading; failed loads are not cached and can be retried.
  The catalog management form is only constructed while open.
  Applying catalog overrides preserves unchanged section and symbol identities, so editing one entry does not
  redraw unrelated cards.
- `src/editor/symbol-svg-cache.ts` — bounded shared symbol markup and text-override results for editor and export.
  Text variants include the override values and validate the original SVG content before reuse. Editable-field
  descriptions are weakly cached per sanitized SVG, with fresh copies returned to consumers.
- `src/editor/model/` — canonical shape types, document-state validation, geometry, normalization, and legacy migration.
  Modules here must not depend on UI components or persistence.
- Binding-ID edits remain local while typing and commit once on Enter or leaving the field, before pointer selection changes.
  Bulk numbering counts grouped assemblies as one point and orders points by distance from the assigned cabinet on the same
  floor plan. Without a unique cabinet position it retains the existing order. Selected lights keep their shared point ID.
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
  Automatic generation uses the full printable width at the existing symbol scale. Regeneration reconciles source
  identities and connection-label overrides across its numbered sheets before removing redundant continuations.
  Sheet planning measures generated circuit ink and uses the same overlap-aware family packing as the final drawing,
  rather than reserving estimated column widths. Circuit busbars sit as low as the printable area and their labels allow;
  automatic layout centers horizontally, never vertically. Generated sheet-reference captions are omitted.
  Cleanup requires every generated object to be represented on a used sheet; manual, locked or unrecognized
  content is retained. Cabinet destinations remain separate, and generation creates a recovery point first.
  When no complete main differential is configured, automatic generation first opens the topology review instead
  of silently generating only outgoing circuits. The description is an editable local draft: a clearly marked
  example for a new installation, or saved text/settings for an existing one. Closing discards draft changes;
  applying requires the main differential's A/mA ratings, saves the confirmed topology, and then generates the
  supply sheet. Reopening retains accepted JSON corrections until the description is changed.
  An explicit re-analysis action refreshes an older interpretation without requiring a text edit; it replaces local JSON corrections.
  Singular downstream differentials are recognized without an explicit count, with A/mA ratings in either order.
  The limited rail is explicitly labelled for consumers; downstream differentials branch from that rail after the remautomaat.
  The incoming EXVB cable and its caption belong to the grid feeder before the main breaker, not the
  meter-to-main-differential link. Loading an older supply drawing moves the cable metadata and caption
  without moving its devices or changing their identities; wrapped captions extend only the incoming feeder.
  Recovery creation drains pending editor writes and adopts the shell's current project metadata before capturing
  the active drawing, so settings just saved by the shell cannot be overwritten by the editor's older project copy.
- `src/editor/cable-estimate.ts` estimates cable route metres per circuit, board and cable designation for the circuit overview.
  It uses a rectilinear minimum spanning tree of labelled floor-plan devices and the selected board symbol at the page scale.
  Board locations are stable page/shape references, so moving a symbol or reassigning a circuit recalculates the estimate.
  Schematic geometry, heating-plan copies and arbitrary inter-page offsets never contribute physical metres.
  Missing positions/scales and unmeasured pages are explicit; partial totals exclude unknown lengths.
  The estimate excludes vertical runs, wall-routing detours, spare cable and inter-board feeds; VOB totals are route metres, not conductor metres.
- The circuit overview combines configured and schematic-only differentials, shows main/row protection chains and
  their supplied circuits, and flags missing or ambiguous assignments. Manual differentials follow actual conductor
  contacts to their outgoing rails, scoped to each schematic page; bare crossings never establish an assignment.
  Schematic copies share a stable source identity across topology geometry versions. Known cabinet assignments take
  precedence over unassigned copies, and supplied circuits are combined across continuation sheets. Conflicting
  schematic-only destinations and distinct devices with identical ratings remain separate; reconciliation never edits drawings.
  Configured and source-tagged schematic residual breakers appear separately as `REM`/`Remautomaat`, with their
  current rating, curve and pole-count module width in the overview, cabinet planner and PDF/SVG schedule.
  They are feeding protections, not differentials or extra circuits, and their inclusion never regenerates wiring.
  Each cabinet exposes its own saved 18/24-module row width, falling back to the existing global width.
  Cabinet headers can add configured differentials; new devices remain separate from existing topology/schematic
  devices with identical ratings (`matchExistingSources: false`). Existing differentials can be assigned to a cabinet
  and electrical rail, updating their profile/topology and all saved schematic copies without moving geometry.
  Cabinet-dependent planner IDs are remapped so existing order and reserved gaps survive reassignment.
  Adding a configured protection does not draw wiring. The cabinet planner reuses these widths, module order and reserved gaps. Pole-count widths are
  indicative, and changing the physical module arrangement does not change electrical connections or schematic geometry.
  Physical cabinet rows are numbered bottom-up: row 1 is the lowest row, without reversing saved module order within rows.
  Toggling a connection caption updates visibility only, without invoking circuit presentation spacing or rail packing.
  Empty circuits retain a real outgoing cable section sized for the complete cable caption, with clearance at both ends.
  Missing empty-circuit sections are repaired locally on opening without moving breakers, rails or populated circuits.
  Inspector cable edits never repack rails; circuit annotation spacing is restricted to the edited circuit.
  Manual breaker insertion keeps alphabetical order on its own rail. Earlier circuits and unrelated rails stay fixed;
  following circuits move right only as needed for clearance. The rail extends outward without shrinking or recentering.
  Global packing belongs to explicit layout generation, never ordinary property edits.
  Generated multiplicity counts sit above their own symbol, clear of conductors. Saved count labels are repaired locally
  without moving devices; compact vertical stacks reserve room for those annotations.
  One-wire catalog and compose tools can insert a symbol into a conductor at the clicked position. Actual electrical
  contacts determine alignment and local wire cuts. When inserting vertically, connected rows above the clicked
  point move upward only as far as required to clear the symbol by 3 mm, including their labels and routed bends.
  Breakers, rails, lower rows and other circuits stay fixed; the intervening conductor extends to keep contacts intact.
  Inline-edited circuits retain their manual geometry during property updates. Locked wires/rows, occupied junctions
  and insufficient conductor space produce an explicit message instead of repacking surrounding equipment.
  Circuit source synchronization restores inline clearance and re-cuts regenerated conductors around existing devices,
  retaining continuation-wire identities instead of leaving a bypass through the symbol.
- `src/editor/keyboard/` — editor hotkey definitions, resolution, and command descriptors.
- `src/editor/interaction/` — keyboard, pointer, selection, and shape-transform use cases.
- Stairs are editable rectangle shapes (`stairs-straight`, `stairs-quarter-turn`, `stairs-double-quarter-turn`,
  `stairs-spiral`, `stairs-route`), not fixed-size
  catalog placements. For preset stairs, dragging defines width and length with a live preview; Shift constrains the footprint
  to a square. `src/editor/model/stair-geometry.ts` supplies the shared tread, outline, and direction paths for the
  editor and SVG export. Double-quarter-turn stairs have three flights, two winding corners and a narrow open centre
  (at most 1 mm on paper when the footprint allows it), without squeezing extra treads between adjacent corners.
  Existing catalog stair symbols remain supported.
  The "Traptraject tekenen" tool accepts successive orthogonal centreline clicks, starting at the lowest tread.
  Stair width is set in centimetres while drawing; Enter, double-click or "Trap bewaren" commits the complete route,
  Backspace removes the last point and Escape cancels. Normalized route points and width scale with the rectangle.
  `src/editor/model/stair-route.ts` generates flights, winding treads and the direction arrow. Both editor and export
  stop visible geometry at the near face of the first crossed visible wall, retaining the complete route in storage.
  This also applies to the existing straight and quarter-turn rectangle stairs; spiral and catalog symbols are unchanged.
  "Trapweergave" in Object properties can show the complete stair instead. Adjacent walls, hidden walls and endpoint
  touches do not cut stairs. Moving a wall or stair recalculates visibility without deleting or splitting the saved route.
- `src/editor/layout/` — catalog, symbol, title-block, and one-wire layout generation.
- The one-wire “Omvormer / PV” action adds or edits an inverter, panel array, or complete connected PV branch
  through a reviewable equipment form. Each component has its own manufacturer, model, datasheet image/text
  import and variant selection; importing one component never replaces the other component's specifications.
  `src/editor/solar-installation.ts` parses aligned STC datasheet columns without mixing in BNPI/NOCT values;
  the inverter parser reads nominal AC output, never recommended PV input or maximum/apparent output.
  Ambiguous or incomplete columns remain explicit for correction. Image recognition reuses the local OCR worker,
  normalizes light-on-grey table headers and leaves recognized text editable; ambiguous O/0 model suffixes are
  flagged instead of silently corrected. Multiple variants require an explicit choice.
  Panel quantity, equal-string configuration and inverter/protection ratings are entered separately, never inferred
  from a panel datasheet. Reviewed specifications live in electrical metadata and ordinary schema text, preserving
  them across history, reopening and SVG/PDF export. Legacy complete installations remain editable. Inverters
  connect through their breaker to the selected AC kamrail; standalone panels have no automatic AC connection
  and can be linked to an inverter's DC terminal using the connection tool. Placement uses actual terminals and free space without moving
  existing circuits; insufficient space is reported rather than silently placing equipment outside the print area.
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
