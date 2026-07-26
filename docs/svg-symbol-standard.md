# Cadle SVG symbol standard

Cadle-native symbols are small, predictable SVG assets. They are marked with
`data-cadle-symbol="1"` on the root element.

## Required

- A numeric `viewBox` beginning at `0 0`.
- No fixed `width` or `height`; Cadle controls rendered size.
- Visible geometry aligned around the intended optical/connection axis.
- Literal fallback colors and stroke widths. Cadle's SVG loader exposes these
  through `--symbol-stroke`, `--symbol-fill` and `--symbol-stroke-width`.
- Only the geometry required to draw the symbol.

## Forbidden

- Visio namespaces, metadata and page-sized invisible rectangles.
- Embedded `<style>`, `<defs>`, `<text>`, scripts or external references.
- Element-level transforms; paths must be flattened before committing.
- Hard-coded dimensions on the root SVG.

Different aspect ratios are allowed where they express the symbol naturally.
For example, wire-placement marks use `0 0 24 54`, with their conductor axis
at `x=12`.

Run `npm run symbols:validate` before committing migrated symbols. Use
`npm run symbols:audit` to list remaining legacy exports.
