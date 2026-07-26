# Cadle product and architecture roadmap

## Product goal

Cadle should let an electrician draw a floor plan quickly, assign devices to circuits, and produce a clear,
editable one-wire diagram, validation report, bill of materials, and print-ready project without repeating data.

The floor plan is the installation view. Circuit metadata is the source of electrical truth. The one-wire diagram is
a generated but editable projection of that data.

## Current architecture

- `src/shell.ts` owns projects, pages, menus, dialogs, export entry points, and navigation.
- `src/app.ts` is the native SVG editor and currently owns most drawing and interaction behavior.
- `src/editor/model/` contains the canonical shape model, sanitization, geometry, and transforms.
- `src/editor/` contains focused canvas helpers, export, one-wire layout, and circuit analysis.
- Projects are persisted through `src/native-project-data.ts` using the canonical native shape types.
- The symbol catalog supplies placement metadata; placed symbols retain normalized electrical metadata.

Cadle no longer uses Fabric.js. References to a Fabric canvas or `src/fields/draw.ts` describe an obsolete version of
the application.

## Completed foundation

- Native SVG floor-plan and one-wire editing
- Project/page persistence and legacy migration
- Walls, openings, symbols, snapping, grouping, transforms, history, PDF import, SVG/PNG/PDF export
- Binding IDs connecting floor-plan devices into circuit groups
- Explicit electrical symbol metadata with backward-compatible inference
- Circuit validation and BOM generation from one shared analysis model
- Automatic creation/update of a one-wire page from bound floor-plan symbols
- Initial automated tests for circuit grouping, validation, specifications, and CSV export

## Priority 1 — trustworthy electrical data

1. Add circuit properties UI for breaker current, cable section, poles, phase configuration, RCD, curve, and notes.
2. Add a project electrical profile: country/standard, supply voltage, phases, earthing system, and default rules.
3. Replace suggested values with rules supplied by the selected profile; always distinguish user-entered values from
   suggestions.
4. Store catalog roles for every built-in symbol during manifest generation so filename inference becomes migration-only.
5. Validate malformed binding IDs, duplicate circuit definitions, mixed incompatible loads, missing protection, and
   incomplete switch/load relationships.

Success means the generated one-wire diagram never silently invents a regulatory fact.

## Priority 2 — one-wire layout and round-trip editing

1. Extract one-wire layout from `src/app.ts` into a pure layout engine with fixture-based tests.
2. Give generated objects stable source references instead of relying only on `groupId` and `bindingId`.
3. Regenerate incrementally: preserve manual placement while updating changed circuit contents.
4. Support distribution boards, RCD hierarchy, multi-pole breakers, multiple rails, three-phase circuits, and subpanels.
5. Detect collisions and paginate diagrams automatically.

Success means changing a floor-plan circuit updates the corresponding one-wire branch without destroying manual polish.

## Priority 3 — simplify the editor architecture

`src/app.ts` is still too large. Extract behavior without changing the custom-element public API:

1. `CanvasDocumentController` — shapes, selection, history, persistence
2. `ViewportController` — zoom, pan, coordinate transforms, fit-to-page
3. `ToolController` — pointer lifecycle and active tool state
4. `OneWireController` — compose and generation commands
5. `CatalogController` — placement, defaults, and custom-symbol workflows

Each extraction must add tests before moving the next responsibility. Avoid a large rewrite.

## Priority 4 — professional workflow

- Circuit manager/table with bulk editing and drag-to-reassign
- Live highlighting of every device in the selected circuit
- Searchable catalog with electrical filters
- Structured BOM with manufacturer/order fields
- Clear validation panel with focus/fix actions
- Reusable project and board templates
- Custom SVG symbol editor with electrical metadata fields
- Autosave status, recovery, and conflict-safe collaboration
- Accessible keyboard workflow and user-configurable shortcuts

## Quality gates

Every change should pass:

```sh
npm test
npx tsc --noEmit
npm run build
```

New domain and layout logic must be implemented as pure modules with unit tests. UI code should orchestrate those
modules rather than duplicate electrical decisions.

## Near-term release sequence

1. Circuit properties editor and project electrical profile
2. Manifest metadata migration for all built-in symbols
3. Pure, tested one-wire layout engine with stable source links
4. Incremental regeneration and collision-aware pagination
5. Board/RCD hierarchy and three-phase support
6. End-to-end browser tests for create project → draw → bind → validate → generate → export
