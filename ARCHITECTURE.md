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
- `src/editor/keyboard/` — editor hotkey definitions, resolution, and command descriptors.
- `src/editor/interaction/` — keyboard, pointer, selection, and shape-transform use cases.
- `src/editor/layout/` — catalog, symbol, title-block, and one-wire layout generation.
- `src/editor/layout/onewire-circuit-presentation.ts` — pure resolution of circuit inspector values and generated
  one-wire labels/symbol presentation. It receives shapes and project-domain inputs and returns transformed shapes;
  it does not render, mutate editor state, or persist data.
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
