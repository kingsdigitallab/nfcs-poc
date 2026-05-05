# Workshop Deployment Plan

## Goal

Deploy the iDAH Federation Workflow PoC for up to 20 concurrent workshop participants,
with access to all search nodes, CORS proxies, file system save/load, and Ollama.

---

## Chosen Architecture

**Single host machine (internal infrastructure) + Cloudflare Tunnel**

```
Workshop participants (browser, HTTPS)
  └─ Cloudflare edge (free named tunnel)
       └─ cloudflared daemon (outbound only, no inbound ports)
            └─ Docker Compose on host machine
                 ├─ app container  (Express server :3001)
                 │    ├─ serves dist/ (production build of React app)
                 │    ├─ /llds-proxy, /ads-proxy, /mds-proxy, /reconcile-proxy
                 │    │    └─ http-proxy-middleware
                 │    ├─ /ollama  →  ollama container :11434
                 │    ├─ /url-proxy  (Node fetch + Puppeteer singleton)
                 │    ├─ /ads-library-search  (JSF two-step middleware)
                 │    └─ /ads-catalogue-search  (Puppeteer Cloudflare bypass)
                 ├─ cloudflared container  (official cloudflare/cloudflared image)
                 └─ ollama container  (GPU passthrough — see open questions)
```

HTTPS is terminated by Cloudflare automatically — no nginx, no Let's Encrypt needed.

---

## Why This Approach

| Concern | How it's addressed |
|---------|-------------------|
| CORS proxies | Express server mirrors all Vite proxy routes |
| File System Access API (save/load) | Requires secure context — Cloudflare provides HTTPS |
| Puppeteer (url-proxy, ADS catalogue) | Runs inside app container on the host |
| Ollama | Dedicated container with GPU passthrough |
| No VPS admin / nginx expertise needed | Cloudflare Tunnel + Docker handle it |
| Consistent public URL for participants | Named tunnel (free Cloudflare account) |
| Internal infrastructure | Host machine stays on-prem; only outbound tunnel needed |

---

## What Needs to Be Built

### 1. Feature branch: `deploy/express-server`

Extract all proxy/middleware logic from `vite.config.ts` into a standalone Express server.
`vite.config.ts` stays unchanged — local dev workflow is unaffected.

**New files:**
- `server/index.mjs` — Express app with:
  - `express.static('../dist')` for the built frontend
  - `http-proxy-middleware` for the five simple proxy rewrites
  - Copy of `urlProxyMiddleware`, `adsLibrarySearchMiddleware`,
    `adsCatalogueSearchMiddleware` from `vite.config.ts`
- `Dockerfile` — Node + Chrome/Puppeteer deps (use a Puppeteer-ready base image)
- `docker-compose.yml` — three services: app, cloudflared, ollama
- `.dockerignore`

**Updated files:**
- `package.json` — add `express` and `http-proxy-middleware` as production deps;
  add `"start": "node server/index.mjs"` script

### 2. Local validation (before any cloud setup)

Run `npm run build` then `node server/index.mjs` and verify every node type works
on `localhost:3001`. HTTPS not testable locally, so File System Access nodes
(`localFolderSource`, `localFileSource`) can only be fully validated once the
Cloudflare tunnel is live.

### 3. Cloudflare setup (one-time, done by user)

- Create free account at cloudflare.com
- Create a named tunnel via the Cloudflare Zero Trust dashboard
- Download the tunnel credentials file (`<tunnel-id>.json`)
- Mount credentials into the `cloudflared` container via `docker-compose.yml`

### 4. Ollama container (GPU passthrough config TBD — see open questions)

---

## Open Questions (needed before coding the Compose file)

| Question | Why it matters |
|----------|---------------|
| **GPU vendor on host machine** (NVIDIA / AMD) | CUDA vs ROCm; different base image and runtime flags in Compose |
| **OS on host machine** (Linux / Windows / Mac) | Windows needs WSL2 + nvidia-container-toolkit for GPU passthrough; Linux is straightforward |
| **Docker already installed?** | If not, installation steps needed |
| **Outbound internet access from host?** | Required for Cloudflare Tunnel and for proxying external APIs |

---

## Known Constraints

- **ADS hard-cap**: 50 results per request (server-side limit, by design)
- **MDS cap**: 200 results (by design)
- **Ollama concurrency**: All 20 users share one Ollama instance; CPU inference is slow
  (30–90s per request). With a good GPU this is not an issue.
- **Puppeteer singleton**: Shared across all users — concurrent Puppeteer requests
  queue on the single browser instance. Acceptable for workshop scale.
- **File System Access API**: Chrome/Edge only (not Firefox). Participants should
  use a Chromium-based browser.

---

## Deferred / Out of Scope for Now

- Making the Ollama endpoint configurable per-user in the UI (would allow
  participants to point at their own local Ollama instead of the shared one)
- Any authentication / access control on the public tunnel URL
