# Cadle architecture

Cadle is organized around a thin UI layer and framework-independent drawing logic. New behavior should move toward the
domain modules below instead of increasing the responsibilities of `app.ts` or `shell.ts`.

## Runtime boundaries

- `src/app.ts` — `<cadle-app>` composition root for the SVG editor. It connects controllers to rendering, persistence,
  and browser events; its public custom-element API must remain stable.
- `src/shell.ts` — application shell and project/page orchestration.
- `src/native-draw/` — canonical shape types, document-state validation, geometry, normalization, and legacy migration.
  Modules here must not depend on UI components or persistence.
- `src/native-app/controllers/` — stateful editor controllers for history, tools, and the viewport.
- `src/native-app/interaction/` — keyboard, pointer, selection, and shape-transform use cases.
- `src/native-app/layout/` — catalog, symbol, title-block, and one-wire layout generation.
- `src/native-app/export/` — SVG/PDF/download concerns. Shared editor policies remain directly in `src/native-app/`.
- `src/api/` — persistence gateways for projects and catalogs.
- `src/elements/`, `src/fields/` — custom elements grouped by UI role. Complex panes keep models and configuration in
  a same-named subfolder (for example, `elements/panes/object-pane/`).
- `src/shell/` — routing, presence, catalog state, page operations, exports, and other shell services.
- `test/` — Node tests for pure domain modules and controllers.

## Dependency direction

```text
UI elements / app / shell
          ↓
controllers and use cases (`native-app`)
          ↓
shape and electrical domain (`native-draw`)
          ↓
           types
```

Persistence is invoked by the composition roots after a controller changes state. Pure controllers should not import
custom elements, browser storage, or rendering code.

## Change guidelines

1. Extract one responsibility at a time from `app.ts` or `shell.ts` behind a small typed API.
2. Add unit tests for the extracted behavior before moving the next responsibility.
3. Keep state cloning and invariants at controller boundaries so callers cannot mutate stored state accidentally.
4. Keep generated files in `www/` out of source refactors; `npm run build` recreates them.
5. Run `npm run check` before submitting a change.

The next planned editor boundaries are `OneWireController` and `CatalogController`; see `IMPROVEMENT_ROADMAP.md` for
the product sequence.
