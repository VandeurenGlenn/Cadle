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

## Household appliance connection dots

Washing machines, dryers and electric ovens connect at the filled black dot in
their artwork, including the SVG group translations. The dryer and oven dots
are below the viewBox center. Their wires must end on these dots rather than
the center of the cabinet or its bounding box. Existing generated circuits
are rebuilt on load when these connection coordinates change.

## Heat pump equipment symbols

The consumption-appliance catalog includes the existing outdoor-unit pictogram
(`Heat pump`), two indoor units (`Heat pump indoor unit air-air` and
`Heat pump indoor unit air-water`), and `Heat pump water-water`. These equipment
pictograms distinguish the thermal configurations; they are not additional
normative AREI symbols.

On floor plans, heat pumps use a 7.5 mm paper box, or 9 mm for the wide air-air
indoor unit. Existing floor-plan symbols at the former default scales of 1 or
1.15 are upgraded when loaded, while custom sizes and one-wire sizes are kept.
On one-wire diagrams, all four use a 9 mm paper box. Their connection ports
touch the cabinet outline, without a conductor through the interior drawing.
A lone unit connects at its bottom edge; numbered rows connect at the side.
Existing generated circuits are rebuilt on load to update their geometry.

## Jacuzzi equipment symbol

The consumption-appliance catalog includes `Jacuzzi`, a top-view equipment
pictogram with water jets and waves, not an additional normative AREI symbol.
It uses a 7.5 mm paper box on floor plans and a 9 mm paper box on one-wire
diagrams, with connection ports on the outer tub outline. A lone jacuzzi
connects at its bottom edge; numbered rows connect at the side.
