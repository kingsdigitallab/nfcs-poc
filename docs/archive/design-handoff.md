# Design handoff — visual makeover of the NFCS workflow editor

Audience: a design-focused agent/developer restyling this app. Screenshots show *what* it looks like;
this doc explains *where the pixels come from* and which ones you must not move.

---

## 1. What you're looking at

A node-based visual workflow editor (React 19 + TypeScript + Vite) built on **@xyflow/react v12**
(React Flow). Users drag nodes from a left sidebar onto an infinite canvas, wire them together, and run
data through them. Screens: top toolbar → (sidebar | canvas | optional right chat panel) → collapsible
dark debug bar. Dev server: `npm run dev` → http://localhost:5174.

## 2. How styling works today — read this first

**There is no CSS framework.** No Tailwind, no CSS modules, no styled-components, no SCSS. There are
almost **no classes or IDs to target with selectors**. A restyle here means editing TypeScript style
objects, not writing stylesheets.

The full styling surface, in order of size:

| Layer | Where | What it controls |
|-------|-------|------------------|
| **Inline `React.CSSProperties` objects** | A `const styles = { card: {...}, header: {...}, ... }` block at the **bottom of ~38 node files** in `src/nodes/*.tsx`, plus ad-hoc `style={{...}}` props | ~95% of everything: node cards, headers, inputs, buttons, tables, popovers |
| **Shell style constants** | `src/styles/appStyles.ts` | Top bar, sidebar container/items, Run All button, debug bar, attribution chip |
| **Component-inline styles** | `src/components/TopBar.tsx`, `Sidebar.tsx`, `ChatSidebar.tsx`, etc. (dozens of `style={{...}}` each) | Toolbar buttons, sidebar groups, modals |
| **Global CSS** | `src/index.css` (36 lines — the only project stylesheet) | Reset, `html/body` font stack (`-apple-system, …, 'Segoe UI'`, 13px) and canvas-page background `#f0f2f5`, `.json-*` syntax-highlight colours, `.node-spinner` keyframes |
| **React Flow stock stylesheet** | `import '@xyflow/react/dist/style.css'` in `App.tsx` | Edges, handles base look, minimap, zoom controls, selection box — themeable via `.react-flow__*` classes (the one place classic CSS works) or RF component props |

The only meaningful class names in the app:
- **`nodrag`** — functional, not visual: it stops React Flow from dragging the node when you interact
  with an input/button. **Never remove it**; add it to any new interactive element inside a node.
- `.json-key/.json-string/...` and `.node-spinner` (index.css).
- React Flow's own `.react-flow__node`, `.react-flow__edge`, `.react-flow__minimap`,
  `.react-flow__controls`, `.react-flow__handle` — fair game for CSS theming.

## 3. The colour system (semantic — redesign it *systematically*)

- Every node has a **`HEADER_COLOR`** constant near the top or bottom of its file (e.g.
  `SparqlSearchNode.tsx` → `#4c1d95`, `GeocodingNode` → `#065f46`). Colours are node *identity*,
  loosely grouped by function (searches blue-ish, LLM nodes violet/indigo, outputs teal/amber…).
  Values are hand-picked Tailwind-palette hexes.
- The **same hex is duplicated** in `src/config/sidebarItems.ts` (`color` field) for the sidebar dot —
  header and dot must stay in lockstep if you re-palette.
- Node border colour = **status**: each node has a `STATUS_BORDER` map
  (`idle #d1d5db / loading #3b82f6 / success #22c55e / error #ef4444 / cached #22c55e`) and a matching
  lighter `STATUS_BADGE` text colour in the header. This convention repeats per file; the shared search
  shell centralises one copy (see §5).
- Common accent trio inside nodes: `ACCENT_BG` (e.g. `#f5f3ff`), `ACCENT_BORDER` (`#ddd6fe`) derived
  from the header colour, used for tabs/sections/buttons.
- Neutral greys throughout are Tailwind stone/gray hexes: `#d1d5db` borders, `#6b7280`/`#9ca3af` muted
  text, `#374151`/`#111827` body text, `#fff` cards.

## 4. Anatomy of a node (the repeating unit)

```
┌─ card ────────────────────────────────┐  border: 2px solid <STATUS_BORDER>, radius 8,
│ ┌─ header (32px, HEADER_COLOR) ─────┐ │  minWidth 260–400 per node, white bg,
│ │ ⚗ Title            ✓ 20 results  │ │  boxShadow 0 1px 4px rgba(0,0,0,0.08)
│ └───────────────────────────────────┘ │
│  body: rows of                        │  row height 27px (ROW_H), fontSize 11,
│  [paramLabel][inlineInput........]    │  monospace 11px param labels, inputs 22px tall
│  tabs / sections / preview            │
│  footer: [📦 fixture] [▶ Run]        │
└───────────────────────────────────────┘
○ input handles (left edge, absolute)      ● output handle (right edge)
```

Expanded views (TableOutput/JSONOutput double-click) render a full-screen overlay panel; popovers
(reconciliation picker, entity autocomplete, report alternates) render via `createPortal` to
`document.body` with **backdrop zIndex 9998 / popover 9999** — keep that convention.

## 5. Hard constraints — things a restyle must not break

1. **Handle geometry is a serialised contract.** Input-handle vertical positions are computed from
   layout constants (`HEADER_H = 32`, `BODY_PAD = 8`, `ROW_H = 27`) and are **pinned by tests**:
   `backboneHandles.test.ts` asserts `query` top = 51 and `limit` top = 78 on the shared search shell.
   Saved workflows (`.nfcs.json`) anchor edges to these handle ids/positions. Other frozen layouts:
   `LocalFolderSourceNode` typed handles at top 70/94/118/142/166, `EuropeanaSearchNode` 93/120,
   GBIF's five wirable rows, SparqlSearch 51/78. **You may restyle colours, fonts, borders and
   spacing *inside* rows freely, but header height, body padding, and row pitch on nodes with wirable
   handles must keep these pixel offsets** (or you're changing a data contract, not a skin).
2. **`npx vitest run` and `npm run build` (tsc + vite) must both stay green.** Styles are TypeScript —
   typos are compile errors, which works in your favour.
3. **`className="nodrag"`** on interactive elements inside nodes is functional — keep it.
4. Node **`type` strings, data keys, and handle ids are serialised** — never rename while restyling.
5. `CommentNode` sizing lives in the node object's `style: {width, height}`, not data; groups
   auto-resize around children — test group collapse/expand after any card-size change.
6. The **status-colour semantics** (blue running / green success / red error / grey idle) are relied on
   in docs and user habit — re-hue if you like, but keep four distinguishable states + the header badge.

## 6. Where the leverage is

| Target | File(s) | Payoff |
|--------|---------|--------|
| **Shared search-node shell** | `src/nodes/BackboneSearchNode.tsx` (its `styles` + `STATUS_BORDER`) | Restyles ARIADNE, HSDS, Bodleian, SMG, V&A, LLDS, MDS search nodes in one place |
| **App shell** | `src/styles/appStyles.ts`, `src/components/TopBar.tsx`, `Sidebar.tsx` | Toolbar, sidebar, debug bar |
| **Global** | `src/index.css` | Font stack/size, page background, spinner, JSON colours; good home for `:root` CSS custom properties and `.react-flow__*` theming |
| **Canvas furniture** | React Flow props in `App.tsx` (`<Background>`, `<MiniMap>`, `<Controls>`) + `.react-flow__*` CSS | Dots grid, minimap, zoom controls, edge strokes |
| **Everything else** | Per-node `styles` blocks in `src/nodes/*.tsx` (~38 files), `src/components/*.tsx` | Long tail — mechanical but wide |

**Recommended approach:** introduce a design-token module (e.g. `src/styles/theme.ts` exporting
colours/spacing/radii/type-scale, or CSS custom properties in `index.css` referenced as `var(...)`
strings inside the style objects). Migrate the shell + BackboneSearchNode first for visible impact,
then sweep the per-node blocks. Update `sidebarItems.ts` colours in lockstep with `HEADER_COLOR`s.
A find-target: the codebase's hexes are consistent enough that `grep -rn "#0f4c81\|#4c1d95" src/`
style sweeps are practical.

## 7. Verifying your changes

1. `npm run dev` → http://localhost:5174 (hot reload).
2. `npx vitest run` and `npm run build` — both must pass.
3. Visual spot-checks: drag a search node + TableOutput onto the canvas and Run (all four status
   colours); double-click TableOutput (full-screen overlay); open a SPARQL node's entity autocomplete
   (portal dropdown above canvas); collapse a node group; toggle Simple/Advanced; open the debug bar
   (dark theme island); check the sidebar's amber-bordered ⚗ Experimental group.
4. Load a saved example workflow (Examples menu) and confirm edges still meet their handles — the
   canary for constraint §5.1.
