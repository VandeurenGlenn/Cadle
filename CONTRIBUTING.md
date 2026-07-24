# Contributing to Cadle

## Getting started

Cadle requires a current Node.js release and npm.

```sh
npm ci
npm run check
```

Use `npm run dev` for a watched browser build. Use `npm run standalone` for the production-style local server or
`npm run standalone:desktop` for Electron.

## Before opening a pull request

Run the single quality gate:

```sh
npm run check
```

It runs the Node test suite, TypeScript without emitting files, and the production Rollup build. Do not commit build
output created only while validating a source change.

## Where code belongs

- Put shape types, sanitization, and pure geometry in `src/native-draw/`.
- Put editor controllers and use cases in `src/native-app/`.
- Keep persistence behind `src/api/` and `src/native-project-data.ts`.
- Keep custom elements focused on translating events and state into controller calls and rendered templates.
- Add Node tests for pure logic under `test/`, named after the module they exercise.

Read `ARCHITECTURE.md` before changing `src/app.ts` or `src/shell.ts`. Those files are composition roots; prefer a
small tested extraction when new behavior would make either one larger.

## Change style

- Keep changes narrow enough to review independently.
- Preserve the `<cadle-app>` public API unless the change explicitly includes a migration.
- Keep controller inputs and outputs typed and framework-independent.
- Clone mutable document state at controller boundaries.
- Avoid top-level storage or DOM work in domain modules; it makes imports unsafe in tests and tooling.
- Add or update tests for bug fixes and state transitions.

## Pull-request notes

Explain the user-visible effect, the architectural boundary affected, and the validation performed. Call out schema or
persistence changes explicitly, including compatibility with existing projects.
