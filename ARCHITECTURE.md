# Cadle architecture

Cadle is organized around a thin UI layer and framework-independent drawing logic. New behavior should move toward the
domain modules below instead of increasing the responsibilities of `app.ts` or `shell.ts`.

## Runtime boundaries

- `src/app.ts` — `<cadle-app>` composition root for the SVG editor. It connects controllers to rendering, persistence,
  and browser events; its public custom-element API must remain stable.
- `src/shell.ts` — application shell and project/page orchestration.
- `src/native-draw/` — canonical shape types, document-state validation, geometry, normalization, and legacy migration.
  Modules here must not depend on UI components or persistence.
- `src/native-app/` — focused editor use cases and controllers, including history, pointer behavior, circuit analysis,
  one-wire generation, and export.
- `src/api/` — persistence gateways for projects and catalogs.
- `src/elements/`, `src/fields/`, `src/screens/` — custom elements grouped by UI role.
- `src/shell/` — services used by the application shell, such as routing, presence, catalog state, and styles.
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
