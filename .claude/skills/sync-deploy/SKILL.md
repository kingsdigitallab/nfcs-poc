# /sync-deploy

Keep `main` and `deploy/express-server` fully in sync. This means merging code changes **and** auditing that every proxy defined in `vite.config.ts` has a matching route in `server/index.mjs`, and that every node is fully registered on both branches.

## Steps

### 1. Establish baseline

Run these in parallel:
- `git branch --show-current` — confirm working branch
- `git log --oneline main..deploy/express-server` — commits only on deploy
- `git log --oneline deploy/express-server..main` — commits only on main (what needs merging)

### 2. Audit proxy coverage

**Extract Vite proxy prefixes** from `vite.config.ts`:
```
grep -oP "'/[^']+(?=':)" vite.config.ts
```
These are the authoritative proxy paths (e.g. `/smg-proxy`, `/vam-proxy`).

Also note the two custom Vite middlewares registered via `configureServer` in `vite.config.ts`:
- `/ads-library-search`
- `/ads-catalogue-search`
- `/url-proxy`

**Extract Express routes** from `server/index.mjs` on deploy branch:
```
git show deploy/express-server:server/index.mjs | grep "app.use("
```

Compare the two lists. For every Vite proxy prefix that has no matching `app.use('/prefix'` in the Express server, flag it as **MISSING**.

The custom middleware paths (`/ads-library-search`, `/ads-catalogue-search`, `/url-proxy`) are handled by named middleware functions in the Express server — confirm they appear as `app.use(adsLibrarySearchMiddleware)` etc. rather than path-prefixed routes.

### 3. Add any missing Express proxy routes

For each missing proxy prefix, add a corresponding `app.use(...)` block to `server/index.mjs` on the deploy branch. Follow the pattern already used in that file:

```js
app.use('/new-proxy', createProxyMiddleware({
  target: 'https://upstream.example.com',
  changeOrigin: true,
  pathRewrite: { '^/new-proxy': '' },
  on: { proxyReq: stripEncoding },
}))
```

If the Vite rule sets custom headers (User-Agent, Referer), replicate them in the `on.proxyReq` handler using `proxyReq.setHeader(...)`.

Place the new route **before** the `app.use(adsLibrarySearchMiddleware)` block, alongside the other `createProxyMiddleware` routes.

### 4. Audit node registration completeness

Check these four files for consistency — every node type should appear in all of them:

| File | What to check |
|------|--------------|
| `src/nodes/index.ts` | `import` + `withDuplicate(...)` entry in `nodeTypes` |
| `src/utils/nodeRunners.ts` | Entry in the runners registry (display-only nodes that have no runner are exempt) |
| `src/App.tsx` — `NODE_DEFAULTS` | Factory function for the node type |
| `src/App.tsx` — `SIDEBAR_ITEMS` | Sidebar entry (hidden nodes may exist but should still be present) |
| `src/App.tsx` — `AppNode` union | `Node<NodeData>` type added to the union |

Run: `grep -oP "(?<=  )\w+(?=:.*withDuplicate)" src/nodes/index.ts` to get the registered type keys, then verify each against the other files.

Also check `KCL_API_KEY_NODES` in `App.tsx` — any node with an `apiKey` field in its data should be in this set so new instances are pre-populated.

### 5. Merge main → deploy

If main has commits that aren't on deploy:

```
git checkout deploy/express-server
git merge main --no-edit
```

Resolve any conflicts (most likely in `server/index.mjs` if both branches touched it).

### 6. Run TypeScript check on deploy branch

```
npx tsc --noEmit 2>&1 | head -30
```

Fix any errors before pushing.

### 7. Push both branches

```
git push origin deploy/express-server
git checkout main
git push origin main
```

### 8. Report

Summarise what was found and what was changed:
- Proxy routes added to `server/index.mjs`: list them
- Node registrations that were incomplete: list them
- Commits merged from main → deploy: count
- TypeScript result: clean / errors fixed
