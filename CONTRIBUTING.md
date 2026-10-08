# Contributing

This is a React 19 + TypeScript single-page app (Vite) with a thin Node proxy layer
(`server/`). Read `docs/engineer-quickstart.md` (five minutes) and then `docs/architecture.md`:
they explain how the system fits together, with diagrams. Read `CLAUDE.md` for the node registries and the list of
deliberate-but-surprising decisions ("Architectural Gotchas"). Read
`docs/engineering-review.md` for the current state of the codebase and the backlog.

## Setup

```bash
npm ci
npm run dev          # http://localhost:5174
```

Node 20+. Copy `.env.example` to `.env` if you need a KCL or Europeana key locally.

## The four gates

Every pull request must pass all four. CI (`.github/workflows/ci.yml`) runs them on
Node 20 and additionally scans for committed secrets.

```bash
npm run lint         # ESLint — 0 errors (warnings are the tracked backlog)
npm run typecheck    # tsc -b
npx vitest run       # unit tests, jsdom
npx vite build
```

Run them locally before pushing; a red gate on `main` blocks everyone.

## Branches and commits

- Branch from `main`; open a PR back to `main`. `main` is what Docker deploys.
- One logical change per commit, conventional-commit style
  (`feat(scope): …`, `fix(scope): …`, `refactor: …`, `docs: …`, `chore: …`).
- Tests go in `src/__tests__/`. A bug fix comes with the test that reproduces it.

## Rules that are not negotiable

1. **Never rename a node `type` string** (`'gbifSearch'`, `'kclNode'`, …), a node
   data key, or a handle id. They are serialised into every saved workflow
   file. Retire a node by removing it (unknown types are dropped on load with a
   warning); never rename one.
2. **Never put record arrays in node data.** Records live in `src/store/resultsStore.ts`;
   node data carries only `resultsVersion`. See "Results Store — CRITICAL" in `CLAUDE.md`.
3. **Runners never throw** and always leave `status` in a terminal state. See the
   `NodeRunner` contract in `CLAUDE.md` and `src/__tests__/runnerContract.test.ts`.
4. **Never commit a credential.** `apiKey` is stripped on save; CI fails on an `sk-…`
   value in `public/` or `src/`. If a key leaks, rotate it — history is public.
5. **Handle geometry is a contract.** The shared search shell's handle offsets are
   pinned by `backboneHandles.test.ts`; do not move them while restyling.

## Adding a node

Follow the "Registration Checklist" in `CLAUDE.md`. `NodeTypeId` is derived from the
component registry (`src/nodes/index.ts`), so register the component first and let
the compiler tell you which other registries still need an entry.

## Adding a proxied data source

Add an entry to `PROXY_TABLE` in `server/proxies.mjs`. That one file serves both the
Vite dev server and the Express production server. Custom middleware is exported from
the same file and wired into both `vite.config.ts` and `server/index.mjs`.
