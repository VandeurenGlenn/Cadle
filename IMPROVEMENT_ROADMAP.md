# Cadle: Electrical Schematic Software Improvement Roadmap
## Based on Best Practices from Trikker, Automaticals, KiCAD, Altium, and Industry Leaders

---

## Executive Summary

Research analyzed **Trikker** (electrician-focused, 12K+ users, diagram-first), **Automaticals/Schematicals** (installation-first, PV specialist), **Altium Designer** (enterprise DRC leader), **KiCAD** (open-source best-in-class), **LTspice** (simulation specialist), and **diagram.net** (web-based generalist). Key findings show Cadle has strong fundamentals (Lit + TypeScript, Fabric.js canvas, binding system, one-line generation) but lacks industry-standard features that accelerate professional workflows.

**Recommendation**: Implement a phased rollout across 4 phases (Phases 1–4 span 6–8 weeks at current pace). Focus on **validation + UI responsiveness** first (Phase 1), then **workflow acceleration** (Phase 2), then **collaboration** (Phase 3), then **domain specialization** (Phase 4). By Phase 4, Cadle will be the only fully web-based electrical schematic platform combining diagram-first (Trikker), installation-first (Automaticals), and multi-user collaboration.

---

## Current State vs. Industry Standards

### ✅ Cadle's Strengths
| Feature | Status | Details |
|---------|--------|---------|
| **Situation Plan + One-Line Dual View** | ✅ Core strength | Two-diagram workflow matches Trikker/professional tools; serialization solid |
| **Binding ID System (A1-style)** | ✅ Implemented | Deterministic linking; socket/switch/load role inference; recently enhanced |
| **Web-First Architecture** | ✅ Forward-looking | Lit + TypeScript; browser-native; potential for real-time collab |
| **Validation Framework** | ✅ Foundation in place | Binding validation step added; DRC groundwork ready |
| **Canvas with Fabric.js** | ✅ Robust | Professional drawing layer; grid, snap, measurements all work |

### ❌ Missing Industry-Standard Features
| Feature | Gap | Industry Impact | Priority |
|---------|-----|-----------------|----------|
| **Real-Time Net Highlighting** | Not implemented | Clicking a binding ID should highlight all linked objects | **P1 (Quick Win)** |
| **In-Canvas Inline Editing** | Dialog-only approach | Double-click component → edit value without opening pane | **P1 (Quick Win)** |
| **Contextual Right-Click Menu** | Minimal context menu | Right-click object → rotate/copy/delete/properties options | **P1 (Quick Win)** |
| **Smart Component Library Search** | No library | Typing "switch" or "light" should show matching symbols | **P2 (Medium Effort)** |
| **BOM/Circuit Summary Export** | Partial (validation step exists) | Generate structured parts list + circuit table for ordering/docs | **P2 (Medium Effort)** |
| **Pin/Contact Tooltips** | Missing | Hover symbol → show pinout + voltage ratings | **P2 (Medium Effort)** |
| **Undo/Redo with History Panel** | Basic undo exists | Visual history tree (undo multiple steps, branch exploration) | **P3 (Complex)** |
| **Collaborative Editing Awareness** | Not implemented | Show cursor/presence of other users editing same project | **P3 (Future)** |
| **Symbol Import/Export** | Limited | Drag custom SVG → auto-convert to electrical symbol with metadata | **P3 (Future)** |
| **Keyboard Shortcut Customization** | Hardcoded | Let users rebind hotkeys; show shortcut cheatsheet in UI | **P2 (Medium Effort)** |

---

## Prioritized Implementation Roadmap

### Phase 1: Quick Wins (1–2 weeks) — Responsive UI & Immediate Feedback

**Goal**: Make the app feel more professional and responsive to user actions. These are high-visibility, moderate-effort improvements.

#### Task 1.1: Net Highlighting on Binding ID Selection
- **What**: Click a binding ID (e.g., A1) → all objects with that ID light up (glow effect, brighter color)
- **Where to Implement**: 
  - [src/fields/draw.ts](src/fields/draw.ts) → add selection:updated event that checks bindingId
  - [src/elements/panes/object/binding.ts](src/elements/panes/object/binding.ts) → emit event on ID select
- **How**: Add a canvas overlay render loop that highlights matching objects using a higher opacity/stroke color
- **Benefit**: Users immediately see circuit structure; matches Altium/KiCAD UX
- **Estimated Effort**: 3–4 hours
- **Success Criteria**: Select A1 binding ID → A1 switch and A1 load both highlight with yellow/orange outline

#### Task 1.2: In-Canvas Inline Editing for Binding ID & Metadata
- **What**: Double-click binding ID in pane → input field appears inline; press Enter to save
- **Where to Implement**:
  - [src/elements/panes/object/binding.ts](src/elements/panes/object/binding.ts) → add edit mode toggle
  - [src/fields/draw.ts](src/fields/draw.ts) → listen for bindingId changes and update binding lookup
- **How**: Replace dialog-based input with an inline `<input>` in the binding ID field; auto-focus on double-click
- **Benefit**: Faster edits; reduce context switching (no dialogs)
- **Estimated Effort**: 2–3 hours
- **Success Criteria**: Double-click A1 field → becomes editable textbox; type A2, press Enter → binding updates

#### Task 1.3: Context Menu (Right-Click Actions)
- **What**: Right-click any object on canvas → menu with: Rotate/Flip, Copy, Delete, Edit Properties, Go to Binding
- **Where to Implement**:
  - [src/contextmenu.ts](src/contextmenu.ts) → expand actions
  - [src/fields/draw.ts](src/fields/draw.ts) → wire canvas right-click to menu
- **How**: Add switch/case for each action (copy uses clipboard, delete calls canvas.remove, etc.)
- **Benefit**: Expert users work faster; discoverability for novices
- **Estimated Effort**: 4–5 hours
- **Success Criteria**: Right-click symbol → 6-item menu appears; click "Delete" → symbol removed

#### Task 1.4: Binding Status Tooltip on Object Hover
- **What**: Hover over any symbol → small tooltip appears showing: binding ID, role (switch/load), linked count
- **Where to Implement**:
  - [src/fields/draw.ts](src/fields/draw.ts) → add mouse:move listener for object hover
- **How**: Create floating tooltip element (positioned absolute/fixed); update on hover with binding info
- **Benefit**: Users see circuit connectivity without selecting; speeds up validation
- **Estimated Effort**: 2–3 hours
- **Success Criteria**: Hover light symbol → tooltip shows "A1 (LOAD) - 1 switch linked"

**Phase 1 Total Estimated Effort**: 11–15 hours (~2–3 days with breaks)

---

### Phase 2: Workflow Acceleration (2–3 weeks) — Search, Export, & Validation UI

**Goal**: Reduce friction in finding components, documenting circuits, and verifying designs.

#### Task 2.1: Smart Symbol Search Bar in Catalog
- **What**: Add search input at top of left catalog pane; typing "switch" filters to matching symbols
- **Where to Implement**:
  - [src/elements/catalog/catalog.ts](src/elements/catalog/catalog.ts) → add search input
  - [src/context/catalog.ts](src/context/catalog.ts) → add filter logic
- **How**: 
  - Filter symbols by name/path substring match
  - Case-insensitive; real-time (filter on each keystroke)
  - Show match count ("12 switches found")
  - Preserve previous selection on clear
- **Benefit**: Users find correct component in <2 seconds vs. scrolling through 50+ categories
- **Estimated Effort**: 4–5 hours
- **Success Criteria**: Type "socket" → only socket outlet symbols visible; 12 results shown

#### Task 2.2: BOM (Bill of Materials) Export
- **What**: File → Generate BOM → outputs CSV/JSON with: Binding ID, Component Type, Count, Role
- **Where to Implement**:
  - [src/shell.ts](src/shell.ts) → add generateBOM() method
  - [src/elements/actions/project-actions.ts](src/elements/actions/project-actions.ts) → add "Export BOM" action
- **How**:
  - Group objects by bindingId
  - Summarize counts per ID (e.g., "A1: 1 switch, 1 light")
  - Export as CSV (importable to Excel/Google Sheets) and JSON
  - Include timestamp, project name
- **Benefit**: Electricians can order parts directly from BOM; critical for procurement
- **Estimated Effort**: 5–6 hours
- **Success Criteria**: File → Export BOM → downloads CSV with 5 binding groups, accurate counts

#### Task 2.3: Enhanced Validation Report UI (Dialog)
- **What**: File → Validate Bindings → detailed modal showing: total circuits, ready vs. incomplete, error list with click-to-focus
- **Where to Implement**:
  - [src/shell.ts](src/shell.ts) → enhance validateBindingsForOneWire() to show rich modal instead of alert()
  - Create [src/elements/modals/validation-report.ts](src/elements/modals/validation-report.ts) new component
- **How**:
  - Use md-dialog to show structured report
  - Each error is clickable → zoom/pan canvas to object
  - Show counts: X circuits ready, Y incomplete, Z warnings
  - Include "Generate One-Wire" CTA button if valid
- **Benefit**: Professional validation workflow; matches industry tools (Altium DRC panel)
- **Estimated Effort**: 6–7 hours
- **Success Criteria**: Validation modal shows 3 binding groups, 2 ready, 1 incomplete; click error → canvas pans to object

#### Task 2.4: Quick Reference Cheatsheet (Keyboard Shortcuts)
- **What**: Help → Keyboard Shortcuts → modal listing all bindings (e.g., "E = Add Wire", "R = Rotate", "M = Measurements")
- **Where to Implement**:
  - [src/screens/keyboard-shortcuts.ts](src/screens/keyboard-shortcuts.ts) → already exists, expand it
  - [src/elements/actions/project-actions.ts](src/elements/actions/project-actions.ts) → link from Help menu
- **How**:
  - Extract hotkey list from [src/controllers/keyboard.ts](src/controllers/keyboard.ts)
  - Organize by category (Canvas, Drawing, Selection, View)
  - Display in responsive grid layout
- **Benefit**: Discoverability; helps users learn shortcuts naturally
- **Estimated Effort**: 2–3 hours
- **Success Criteria**: Help → Keyboard Shortcuts → grid shows 12+ shortcuts; organized by category

**Phase 2 Total Estimated Effort**: 17–21 hours (~4–5 days)

---

### Phase 3: Collaboration & Robustness (3–4 weeks) — History, Symbols, Multi-User

**Goal**: Enable team workflows and reduce errors in long editing sessions.

#### Task 3.1: Visual Undo/Redo History Panel
- **What**: View → History Panel (right-side collapsible) showing timeline of changes; click to jump to state
- **Where to Implement**:
  - [src/utils.ts](src/utils.ts) → enhance HistoryAction tracking (add timestamps, labels)
  - Create [src/elements/panels/history-panel.ts](src/elements/panels/history-panel.ts) new component
- **How**:
  - Track each add/remove/modify action with timestamp
  - Render as vertical timeline with icons (add=+, delete=X, modify=⚙)
  - Click any state → replay all actions up to that point
  - Show "Modified 5 objects" for each state
- **Benefit**: Non-destructive editing; explore design alternatives
- **Estimated Effort**: 8–10 hours
- **Success Criteria**: Make 5 edits → history shows 5 states; click state 2 → canvas reverts to that point

#### Task 3.2: Custom Symbol Import (Drag & Drop SVG)
- **What**: Drag SVG file → Cadle auto-converts to symbol (extracts metadata: name, category, electrical properties)
- **Where to Implement**:
  - [src/fields/draw.ts](src/fields/draw.ts) → add drag-drop listener for SVG files
  - Create [src/symbols/svg-importer.ts](src/symbols/svg-importer.ts) conversion logic
- **How**:
  - On drop, parse SVG → extract `<title>`, `<desc>`, dimensions
  - Ask user for: symbol name, category (Switches, Loads, Protection), binding role
  - Store in local catalog (IndexedDB)
  - Add to left sidebar under "My Symbols" category
- **Benefit**: Electricians use custom/proprietary symbols; reduces need to draw from scratch
- **Estimated Effort**: 10–12 hours
- **Success Criteria**: Drag custom_relay.svg → dialog asks for metadata; symbol available in My Symbols

#### Task 3.3: Presence Awareness (Multiuser Preview)
- **What**: When 2+ users edit same project, show cursor position + name label of other users
- **Where to Implement**:
  - [src/shell.ts](src/shell.ts) → add presence sync via WebSocket/polling
  - [src/fields/draw.ts](src/fields/draw.ts) → render remote cursors as overlay
- **How**:
  - Use SharedDB (or Firebase/Supabase) for presence channel
  - Emit mouse position + user name every 200ms
  - Render remote cursor as colored dot + label (e.g., "Glenn")
  - Hide cursor if user idle >10s
- **Benefit**: Teams coordinate; see who's editing what in real-time
- **Estimated Effort**: 12–15 hours (backend dependency)
- **Success Criteria**: Open project in 2 browser tabs → both cursors visible; names shown

#### Task 3.4: Circuit Template Library
- **What**: File → New from Template → choose from: "Simple Switch Load", "Motor Starter", "3-Phase Distribution", etc.
- **Where to Implement**:
  - Create [src/templates/circuit-templates.ts](src/templates/circuit-templates.ts) with preset schemas
  - [src/shell.ts](src/shell.ts) → add loadTemplate() method
  - Update File menu in [src/elements/actions/project-actions.ts](src/elements/actions/project-actions.ts)
- **How**:
  - Define 5–10 common templates as Fabric.js JSON schemas
  - Pre-configure binding IDs, roles, and layout
  - User selects → creates new page with template
  - Can customize after creation
- **Benefit**: Reduce setup time; enforce best practices (e.g., "always use switch+load pair")
- **Estimated Effort**: 6–8 hours
- **Success Criteria**: File → New from Template → load "Switch Load" → pre-configured circuit appears

**Phase 3 Total Estimated Effort**: 36–45 hours (~1 week)

---

## Implementation Sequence & Dependencies

```
Phase 1 (Sequential, no blocking deps):
  1.1 Net Highlighting → 1.2 Inline Editing → 1.3 Context Menu → 1.4 Hover Tooltip
  
Phase 2 (Can overlap; minimal deps):
  2.1 Symbol Search (independent)
  2.2 BOM Export (needs validation; can use existing)
  2.3 Validation UI (builds on Task 1 net highlight)
  2.4 Keyboard Shortcuts (independent)
  
Phase 3 (Heavier, can run 2 in parallel):
  3.1 History Panel (independent)
  3.2 Symbol Import (independent)
  3.3 Presence (backend needed)
  3.4 Templates (independent)
```

---

## Comparison: Cadle vs. Trikker vs. Altium

| Feature | Cadle Now | Trikker | Altium | Priority for Cadle |
|---------|-----------|---------|--------|-------------------|
| Situation Plan | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Core |
| One-Line Diagram | ✅ Yes (auto-generated) | ✅ Yes | ✅ Yes (layout-focused) | ✅ Core |
| Real-Time Net Highlight | ❌ No | ✅ Yes | ✅ Yes | **P1** |
| Inline Property Edit | ❌ No (dialog) | ✅ Yes | ✅ Yes | **P1** |
| Context Menu | ⚠️ Minimal | ✅ Full | ✅ Full | **P1** |
| BOM Export | ❌ No | ✅ Yes | ✅ Yes | **P2** |
| DRC/Validation | ⚠️ Basic (binding validation only) | ✅ Full ERC | ✅ Full ERC+DRC | **P2** |
| Symbol Library | ⚠️ Flat catalog | ✅ Categorized + search | ✅ 1M+ parts + distributor API | **P2** |
| Undo/Redo | ⚠️ Basic (no history view) | ✅ Full history | ✅ Full history tree | **P3** |
| Keyboard Shortcuts | ⚠️ Hardcoded | ✅ Customizable | ✅ Customizable | **P2** |
| Multi-User Collaboration | ❌ No | ❌ No (desktop-only) | ✅ Yes (Altium 365) | **P3** |

---

### Phase 4: Domain-Specific Specializations (4–6 weeks) — PV, Panels, Installation-First

**Goal**: Differentiate Cadle by adding Automaticals-inspired features that specialists need (solar installers, panel designers, domotics integrators).

#### Task 4.1: PV (Solar) Installation Templates & Auto-Generation
- **What**: File → New from Template → "Solar Installation" → pre-configured one-line with inverter, panels, battery, breakers
- **Where to Implement**:
  - Extend [src/templates/circuit-templates.ts](src/templates/circuit-templates.ts) with PV schema
  - Add PV-specific symbols to catalog: Inverter, Battery Bank, Panel Array, DC Combiner, Disconnect
- **How**:
  - Template includes standard PV topology (DC side + AC side)
  - User inputs: # panels, inverter kW, battery capacity
  - Auto-calculate wire gauges, breaker ratings based on inputs
  - Generate circuit table with DC/AC protection requirements
- **Benefit**: Solar electricians save 2+ hours per design; Trikker/Altium have no PV support
- **Estimated Effort**: 8–10 hours
- **Success Criteria**: File → PV Template → enter 12 panels + 5kW inverter → auto-generates compliant one-line with labeled currents

#### Task 4.2: Distribution Panel Design & Label Generation
- **What**: Tools → Panel Designer → visual cabinet layout tool; drag/place breakers, terminals, bus bars; auto-generate label sheet
- **Where to Implement**:
  - Create [src/tools/panel-designer.ts](src/tools/panel-designer.ts) new component
  - [src/fields/draw.ts](src/fields/draw.ts) → add panel layout mode (canvas with pre-sized cabinet outline)
- **How**:
  - Drag breaker symbols into cabinet grid (standard IEC/NEMA spacing)
  - Input circuit assignments (A1 → Breaker #3, A2 → Breaker #5, etc.)
  - Export as: SVG (printable label sheet), Excel (for label printer), PDF
- **Benefit**: Eliminates manual labeling; matches Automaticals' cabinet design feature
- **Estimated Effort**: 10–12 hours
- **Success Criteria**: Panel Designer → arrange 10 breakers → export label PDF → print-ready

#### Task 4.3: Installation-First Workflow Option (Design Mode)
- **What**: Optional workflow toggle: "Installation-First" mode starts with floor plan → assign devices to circuits → auto-gen one-line
- **Where to Implement**:
  - [src/shell.ts](src/shell.ts) → add workflow mode selector
  - Create [src/workflows/installation-first.ts](src/workflows/installation-first.ts) mode logic
- **How**:
  - On new project, ask: "Start with diagram (Trikker-style) or installation (Automaticals-style)?"
  - Installation-First: floor plan → place outlets/switches/lights → assign to circuits → generates one-line
  - Same underlying binding system, but different UI flow
  - Users can switch modes anytime
- **Benefit**: Caters to both diagram-first and installation-first electricians; broadens appeal
- **Estimated Effort**: 12–14 hours (refactor binding lookup to support reverse flow)
- **Success Criteria**: Start project with Installation-First → place 3 outlets + 1 switch on floor plan → assign to circuit A1 → one-line auto-generates

#### Task 4.4: Cable Routing & Environmental Factors Tables
- **What**: Tools → Cable Route → draw cable paths on floor plan with length auto-calc; Tools → Compliance Table → auto-fill external influence factors
- **Where to Implement**:
  - [src/fields/draw.ts](src/fields/draw.ts) → add cable route mode (polyline tool with length measurement)
  - Create [src/elements/forms/compliance-table.ts](src/elements/forms/compliance-table.ts) new form component
- **How**:
  - Cable route: polyline tool → snaps to walls → displays total cable length; exports to CSV (for cabling budget)
  - Compliance table: dropdown selectors for: Temperature, Humidity, Altitude, Surrounding Elements, Presence of Water
  - Auto-format as Excel/PDF export for regulatory submission
- **Benefit**: Mandatory documentation for electrical audits; Automaticals excels here; Cadle currently missing
- **Estimated Effort**: 8–10 hours
- **Success Criteria**: Draw cable route from panel to light → length calculated; compliance table with 6 factors auto-exported to PDF

#### Task 4.5: Domotics/SELV Control Circuit Auto-Generation
- **What**: When domotics/home automation module detected in binding, auto-generate control wiring diagram (SELV schema)
- **Where to Implement**:
  - [src/fields/draw.ts](src/fields/draw.ts) → extend binding validation to detect domotics modules
  - Create [src/generators/domotics-schema.ts](src/generators/domotics-schema.ts) auto-gen logic
- **How**:
  - User assigns pushbutton (switch) to automation module in binding UI
  - System detects: "This is low-voltage control for domotics"
  - Auto-generates separate one-line showing module connections, relay logic, wiring assignments
  - Label each wire clearly (e.g., "IN1-Livingroom Light", "OUT3-Dimmer")
- **Benefit**: Domotics integrators currently require 3+ tools; Cadle could do this in-tool
- **Estimated Effort**: 10–12 hours
- **Success Criteria**: Assign pushbutton to domotics relay in binding → auto-generates control schema with labeled connections

**Phase 4 Total Estimated Effort**: 48–58 hours (~2 weeks intensive)

---

## Success Metrics

After full Phase 1–4 implementation, Cadle will match or exceed all three competitors (Trikker, Automaticals, Altium) in these areas:
- **UX Responsiveness**: <100ms feedback on any action (net highlight, edit, hover)
- **Professional Workflow**: Support 98% of electrician use cases (binding, validation, export, PV, domotics)
- **Domain Specialization**: Only tool combining diagram-first (Trikker) + installation-first (Automaticals) + web collaboration (Altium 365)
- **Scalability**: Handle 200+ components per page without slowdown
- **Accessibility**: Keyboard-only workflow possible; all features reachable without mouse
- **Export Quality**: PDF + CSV + Excel exports match and exceed industry standards
- **Regulatory Compliance**: Auto-generate compliance tables, terminal lists, environmental factors (Automaticals parity)

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking existing workflows during UI refactor | Write tests; feature-flag new UI (old available until P1 complete) |
| Performance issues with net highlighting on 100+ objects | Use requestAnimationFrame; batch highlight updates; profile with DevTools |
| Custom symbol import complexity | Start with simple SVG → JSON conversion; add AI/heuristics later |
| Multiuser backend overhead | Prototype with polling first; migrate to WebSocket only if needed |
| Users overwhelmed by new features | Provide in-app onboarding; highlight new features in update notes |

---

## Recommended Implementation Sequence

1. **Week 1**: Implement Phase 1, Tasks 1.1 & 1.2 (net highlighting + inline edit)
   - Highest ROI (visible, professional, quick)
   - Unblock Tasks 2.3 and 3.1 later
   
2. **Week 2**: Complete Phase 1, start Phase 2 Tasks 2.1 & 2.2 (search + BOM)
   - Accelerates user workflows
   - Builds electrician use-case confidence
   
3. **Weeks 3–4**: Phase 2 & 3 in parallel
   - UI polish (2.3, 2.4)
   - Advanced features (3.1–3.4)
   
4. **Weeks 5–6**: Phase 4 (domain specialization)
   - PV templates (4.1)
   - Panel design (4.2)
   - Installation-first workflow (4.3) — highest complexity
   - Domotics integration (4.5)
   - Cable routing (4.4)

---

## Competitive Positioning

| Dimension | Trikker | Automaticals | Altium | Cadle (After Phase 4) |
|-----------|---------|--------------|--------|----------------------|
| **Platform** | Windows desktop | Windows desktop | Web (Altium 365) + Desktop | **Web** ✅ |
| **Electrician Focus** | ✅ Yes | ✅ Yes | ❌ Circuit designer focused | **✅ Yes** |
| **Diagram-First** | ✅ Yes | ❌ No | ❌ No | **✅ Yes** |
| **Installation-First** | ❌ No | ✅ Yes | ❌ No | **✅ Yes (NEW)** |
| **PV Support** | ❌ No | ✅ Yes | ❌ No | **✅ Yes (NEW)** |
| **Panel Design** | ❌ No | ✅ Yes | ❌ No | **✅ Yes (NEW)** |
| **Real-Time Collab** | ❌ No | ❌ No | ✅ Yes | **✅ Yes (NEW)** |
| **Domotics/SELV** | ⚠️ Limited | ✅ Full | ❌ No | **✅ Full (NEW)** |
| **DRC/Validation** | ✅ Good | ✅ Good | ✅ Excellent | **✅ Good (Enhanced)** |
| **Community** | ✅ 12K+ users | ⚠️ Smaller | ✅ Large | **TBD** |

**Cadle's Unique Position Post-Phase 4**: Only tool that combines all four workflow styles (diagram-first, installation-first, hierarchical, simulation-ready) + web collaboration + open roadmap.

---

## Total Development Investment

| Phase | Hours | Focus | Timeline |
|-------|-------|-------|----------|
| Phase 1 | 11–15 | UI responsiveness | Week 1 |
| Phase 2 | 17–21 | Workflow acceleration | Weeks 2–3 |
| Phase 3 | 36–45 | Collaboration + history | Weeks 3–4 |
| Phase 4 | 48–58 | Domain specialization | Weeks 5–6 |
| **TOTAL** | **112–139** | **6 weeks intensive** | |

**Effort Estimate**: 3–4 months at 20 hrs/week, or 6–8 weeks at 40 hrs/week.

---

**This roadmap represents the evolution of Cadle from a "good" electrician tool (Trikker parity) to a world-class platform that combines the best of Trikker (diagram-first), Automaticals (installation-first + domain specialization), Altium (collaboration), and KiCAD (accessibility). By Phase 4 completion, Cadle will be the only fully web-based electrical schematic platform with multi-mode workflows and deep electrician domain expertise.**
