# Cadle SVG symbol standard

Cadle-native symbols are small, predictable SVG assets. They are marked with
`data-cadle-symbol="1"` on the root element.

## Stroke width

The default visual stroke width is **0.65 canvas units** for ordinary symbols.
It is normalized against the rendered size and the larger `viewBox` dimension,
so symbols with different source viewBoxes retain the same visible line weight.
The symbol-stroke preference changes this normalized visual width consistently.

Generated one-wire circuit symbols use a separate **2 canvas unit** stroke
standard so their conductors and symbols remain legible at print scale. Their
stored SVG stroke widths are adjusted for each symbol's rendered scale.

## Required

- A numeric `viewBox` beginning at `0 0`.
- No fixed `width` or `height`; Cadle controls rendered size.
- Visible geometry aligned around the intended optical/connection axis.
- Literal fallback colors and stroke widths. Cadle's SVG loader exposes these
  through `--symbol-stroke`, `--symbol-fill` and `--symbol-stroke-width`.
- Only the geometry required to draw the symbol.
- Local `<defs>` and `<use href="#...">` references are allowed when needed for
  the symbol; external references are not.

## Forbidden

- Visio namespaces, metadata and page-sized invisible rectangles.
- Embedded `<style>`, `<text>`, `<desc>`, scripts or external references.
- Global CSS classes. Use explicit presentation attributes instead.
- Hard-coded dimensions on the root SVG.

Standard SVG group transforms are allowed; Visio-specific markup is not.

Different aspect ratios are allowed where they express the symbol naturally.
For example, wire-placement marks use `0 0 24 54`, with their conductor axis
at `x=12`.

Run `npm run symbols:convert` to migrate the remaining self-contained Visio
exports, then `npm run symbols:validate` to check the full native-symbol set.
Use `npm run symbols:audit` to list any remaining legacy exports.

The current catalog still contains Visio-export SVGs. A symbol is not converted
until its artwork has been made Cadle-native and passes the required asset
checks; removing Visio metadata alone does not count as conversion.
