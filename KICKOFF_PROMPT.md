# Kickoff Prompt for Claude Code

Paste this into Claude Code. Make sure CLAUDE.md is in the repo root first.

---

Read CLAUDE.md for project context.

We are building incrementally. **Complete only Increment 1 now.** After each increment I will test it in my browser before telling you to proceed.

## Increment 1 — Minimal canvas with a parameter node

Set up the project: Vite + React + TypeScript + `@xyflow/react`. No Docker, no service workers, no backend. Just `npm run dev`.

Create a React Flow canvas that fills the viewport. Add a left sidebar with one draggable node type: **ParamNode**. The user can drag it onto the canvas. ParamNode has:
- A dropdown to select param type: "Text" or "Integer"
- A text input field for the value
- A text input for a label (defaults to "Parameter")
- One output handle on the right

The node should look clean — rounded corners, a small header with the label, the type selector and value input below it. The output handle should be colour-coded (e.g. blue).

When the user types a value, it should be stored in the node's data. We'll verify this works by checking React Flow's internal state (add a small debug panel at the bottom that shows the JSON of all nodes and their data — we can remove this later).

**Test criteria:** I can drag a ParamNode onto the canvas, set it to "Text", type "Quercus robur", and see that value reflected in the debug panel.

---

## Increment 2 — GBIF search node (wired to params, live API call)

DO NOT START THIS UNTIL I CONFIRM INCREMENT 1 WORKS.

Add a second node type to the sidebar: **GBIFSearchNode**. It has:
- Multiple input handles on the left, labelled: `q` (free text), `scientificName`, `country`, `year`, `limit`
- Each input handle accepts a connection from a ParamNode
- For any input NOT connected to a ParamNode, show an inline text field on the node so the user can type a value directly
- A "Run" button on the node
- One output handle on the right (will carry the API response)
- A small status indicator: idle / loading / success (with count) / error

When "Run" is clicked:
1. Collect values from connected ParamNodes AND inline fields.
2. Build the GBIF URL: `https://api.gbif.org/v1/occurrence/search?` with the non-empty params.
3. `fetch()` the URL from the browser.
4. Store the response JSON in the node's data under `response`.
5. Show status: "Loading..." → "✓ 54,321 results" or "✗ Error: ...".

Also log the full request URL and response to the browser console so I can inspect it in DevTools.

**Test criteria:**
- I can drag a ParamNode (Text, "Quercus robur") and connect it to the `scientificName` handle of a GBIFSearchNode.
- I can also type "GB" directly into the `country` inline field on the GBIF node.
- I click "Run" and see "Loading..." then a success count.
- In DevTools Network tab, I can see the GET request to api.gbif.org and inspect the JSON response.
- The debug panel shows the response stored in the GBIF node's data.

---

## Increment 3 — Output nodes (Table and JSON)

DO NOT START THIS UNTIL I CONFIRM INCREMENT 2 WORKS.

Add two output node types to the sidebar:

**TableOutputNode**:
- One input handle (accepts connection from GBIFSearchNode output)
- When it receives data (via connection from an executed GBIF node), renders a paginated table
- Columns auto-detected from the first result record. Show at most 8 columns initially: `scientificName`, `country`, `eventDate`, `decimalLatitude`, `decimalLongitude`, `basisOfRecord`, `institutionCode`, `datasetName`. Add a "show all columns" toggle.
- Pagination: 25 rows per page, prev/next buttons.
- The table renders directly inside the node if small, or in the right-side output panel if the user double-clicks the node.

**JSONOutputNode**:
- One input handle
- Renders the raw JSON response in a scrollable, syntax-highlighted `<pre>` block (use a simple CSS approach, no heavy dependency needed)
- Collapsible/expandable object keys would be nice but not essential

Data flow: when the GBIF node completes execution, output nodes connected to it should automatically receive and render the data. Use React Flow's edge connections to propagate — when a source node's `response` data changes, connected output nodes should react.

**Test criteria:**
- ParamNode("Quercus robur") → GBIFSearchNode → TableOutputNode shows a table of results.
- Same chain but with JSONOutputNode instead shows formatted JSON.
- Changing the param and re-running updates the outputs.

---

## Increment 4 — Download buttons

DO NOT START THIS UNTIL I CONFIRM INCREMENT 3 WORKS.

Add download capability to the output nodes:

- **TableOutputNode**: add a "Download CSV" button that converts the current results to CSV and triggers a browser download.
- **JSONOutputNode**: add a "Download JSON" button that triggers download of the raw JSON response.
- Both buttons should generate a filename like `gbif-results-2026-04-10.csv` or `.json`.

Also add a **format selector** to the GBIFSearchNode: a dropdown with "JSON (default)" and "Darwin Core Archive (URL only)". When DwC-A is selected, the node should display a note explaining that DwC-A is only available via the async download API and showing the URL the user would need to use (don't actually call it — just display the endpoint). This teaches the user about GBIF's data format options.

**Test criteria:**
- I can click "Download CSV" on the table node and get a valid CSV file.
- I can click "Download JSON" on the JSON node and get the API response as a file.
- Switching the GBIF node to "DwC-A" mode shows an informational message instead of running a query.
