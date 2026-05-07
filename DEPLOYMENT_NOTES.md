# Deployment Gotchas & Notes

Hard-won lessons from deploying on WSL2 (Ubuntu 22.04, NVIDIA RTX 4080).
Kept on the `deploy/express-server` branch only — not part of the main codebase.

---

## Node.js Version

**Problem:** WSL2 had Node 16 installed. The project requires Node ≥ 18 (Puppeteer dependency).

**Fix:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

---

## TypeScript Errors Block Production Build

**Problem:** `npm run build` runs `tsc -b` first, which surfaces pre-existing TypeScript
errors in the codebase and aborts the build. These errors don't affect runtime behaviour.

**Fix:** Use `npm run build:deploy` instead, which runs `vite build` directly (esbuild
transpilation only, no type checking). The standard `npm run build` is kept intact for
local development.

---

## Docker Buildx Missing / Wrong Path

**Problem:** Docker was installed but `docker compose up --build` failed with:
```
fork/exec /usr/local/lib/docker/cli-plugins/docker-buildx: no such file or directory
```
The existing symlink at `/usr/local/lib/docker/cli-plugins/docker-buildx` pointed to a
stale Docker Desktop path (`/mnt/wsl/docker-desktop/...`) that no longer existed.

**Fix:**
```bash
sudo apt-get install -y docker-buildx-plugin
sudo rm /usr/local/lib/docker/cli-plugins/docker-buildx
sudo ln -s /usr/libexec/docker/cli-plugins/docker-buildx /usr/local/lib/docker/cli-plugins/docker-buildx
```

---

## Native Ollama Conflicts with Docker Ollama on Port 11434

**Problem:** The Ollama install script starts Ollama as a systemd service automatically.
When Docker tries to bind port 11434 for the Ollama container, it fails with:
```
failed to bind host port for 0.0.0.0:11434: address already in use
```

**Fix:** Stop and disable the native Ollama service, and remove the host port binding
from the Ollama container in `docker-compose.yml` (the app reaches Ollama via Docker's
internal network — the port doesn't need to be exposed to the host):
```bash
sudo systemctl stop ollama
sudo systemctl disable ollama
```
Model management is done via `docker compose exec` instead of the host port:
```bash
docker compose exec ollama ollama pull gemma3:1b
```

---

## server/ Directory Excluded from Docker Build Context

**Problem:** `server/` was listed in `.dockerignore`, so the `COPY server/ ./server/`
step in the Dockerfile failed with "not found".

**Fix:** Removed `server/` from `.dockerignore`.

---

## Cloudflare Quick Tunnel WAF Blocks Ollama POST Requests

**Problem:** Using a `trycloudflare.com` quick tunnel, all Ollama node requests returned
403. The quick tunnel's WAF blocks POST requests that resemble AI API calls.

**Fix:** Switch to a named tunnel with a real domain (see Named Tunnel section below).
Quick tunnels are suitable for testing everything except Ollama.

---

## Cloudflare Named Tunnel: "Tunnel not found"

**Problem:** After rotating the tunnel token (required after accidentally sharing it),
the old token in `.env` gave:
```
Unauthorized: Tunnel not found
```

**Fix:** Go to Cloudflare dashboard → Networking → Tunnels → [tunnel name] →
**Rotate token**, copy the new token, and update `.env`:
```bash
echo "CLOUDFLARE_TUNNEL_TOKEN=<new-token>" > .env
docker compose --profile tunnel down
docker compose --profile tunnel up
```

---

## Cloudflare WAF Blocks Ollama Streaming Requests

**Problem:** Even on a named tunnel, Ollama requests returned 403. Cloudflare's managed
WAF rules intercept POST requests to `/ollama/*`.

**Fix:** Add a custom WAF skip rule in Cloudflare:
- Dashboard → field.works → Security → WAF → Custom Rules → Create rule
- Expression: `starts_with(http.request.uri.path, "/ollama")`
- Action: Skip → tick **All remaining custom rules** + **All managed rules**
- Place at: First

---

## Ollama Rejects Requests from Non-Localhost Origins

**Problem:** Even with the Cloudflare WAF bypassed, Ollama returned 403. The Docker logs
showed the GIN framework rejecting the request:
```
403 | 50µs | 83.104.12.87 | POST "/api/chat"
```
Ollama's built-in origin check rejects any request whose `Origin` header is not
`localhost` or `127.0.0.1`. Requests via the Cloudflare tunnel carry the tunnel domain
as the Origin.

**Fix:** Set `OLLAMA_ORIGINS=*` in the Ollama container environment in
`docker-compose.yml`. The container must be restarted to pick up the change:
```bash
docker compose --profile tunnel down
docker compose --profile tunnel up
```

**Security note:** This allows any origin to call Ollama via the tunnel URL. Mitigate by:
1. Shutting down the tunnel immediately after the workshop
2. Adding a Cloudflare rate limiting rule on `/ollama/*`

---

## Moving field.works DNS to Cloudflare

**Required for named tunnels.** Cloudflare tunnels need a domain managed by Cloudflare DNS.

**Steps taken:**
1. Added `field.works` to Cloudflare (imported DNS records automatically)
2. Set GitHub Pages A/AAAA records to **DNS only** (grey cloud) to avoid SSL conflicts
3. Changed nameservers at name.com to Cloudflare's nameservers
4. Ignored the "DNSSEC" warning — it was not enabled at name.com

**Safe:** The GitHub Pages site and Google Workspace email continued working without
interruption. Adding a new subdomain (`nfcs.field.works`) does not affect existing records.

---

## Named Tunnel Route Configuration

In Cloudflare dashboard → Networking → Tunnels → [tunnel] → Routes → Add route:
- **Subdomain:** `nfcs`
- **Domain:** `field.works`
- **Path:** leave empty
- **Service URL:** `http://app:3001`

The service URL uses the Docker Compose service name `app` because `cloudflared` runs
on the same internal Docker network.

---

## Pulling Ollama Models

Models are not baked into the image. Pull after first `docker compose up`:
```bash
docker compose exec ollama ollama pull gemma3:1b
```
Models persist in the `ollama_data` Docker volume across restarts. Do not use
`docker compose down --volumes` or models will be lost and need re-downloading.

---

## CPU-Only Deployment (No GPU)

**Problem:** The `docker-compose.yml` includes a `deploy.resources.reservations` block for NVIDIA GPUs. On a CPU-only machine this causes the Ollama container to fail with a device reservation error.

**Fix:** Remove the `deploy:` block entirely from the `ollama` service in `docker-compose.yml`. The current file on `deploy/express-server` already has this removed — the block is only needed when you have an NVIDIA GPU with `nvidia-container-toolkit` installed.

**Performance note:** Ollama runs on CPU only. Use the smallest viable model to keep response times acceptable:
- `qwen2:0.5b` — ~352 MB (fastest on CPU, good for demos)
- `tinyllama` — ~637 MB
- `gemma3:1b` — ~815 MB (slowest of these three on CPU)

Pull after first `docker compose up`:
```bash
docker compose exec ollama ollama pull qwen2:0.5b
```

---

## Disk Space on Small VMs (10 GB)

A 10 GB root disk fills up quickly. Rough usage:
- Docker base images + build layers: ~2–3 GB
- Ollama image: ~1.5 GB
- `qwen2:0.5b` model: ~352 MB
- System + Docker overhead: ~2 GB
- **Total: ~6–7 GB** — leaves ~3 GB headroom

To check free space at any point:
```bash
df -h /
```

To prune dangling build cache after a successful build:
```bash
docker builder prune -f
```

Avoid `docker compose down --volumes` — this deletes the `ollama_data` volume and you will need to re-pull the model.

---

## GPU Passthrough (NVIDIA)

Requires `nvidia-container-toolkit` on the host:
```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

On the native Ubuntu server this should work cleanly. On WSL2, Docker Desktop's
leftover buildx symlinks may need fixing (see Docker Buildx section above).

---

## Proxy Routes Aborting Through Cloudflare Tunnel (Compression Conflict)

**Problem:** All proxy-backed nodes (MDS, LLDS, ADS, Reconciliation) failed with
"signal is aborted without reason" through the named tunnel, while GBIF and ARIADNE
(direct browser fetches, no proxy) worked fine. CORS was not the cause. The issue was
Cloudflare decompressing and re-compressing gzip responses from upstream services, which
corrupted `content-length` and caused the browser to abort.

**Fix:** Strip `Accept-Encoding` from all outbound proxy requests so upstream services
return uncompressed responses. In `server/index.mjs`:
```js
const stripEncoding = (proxyReq) => proxyReq.removeHeader('accept-encoding')
// Applied via on: { proxyReq: stripEncoding } on every createProxyMiddleware call
```
This is already in place in the current codebase.

---

## package-lock.json Out of Sync in Docker

**Problem:** Adding `express` and `http-proxy-middleware` to `package.json` without
committing the updated `package-lock.json` caused `npm ci` to fail inside the Docker
build:
```
npm error `npm ci` can only install packages when your package.json and package-lock.json
are in sync.
```

**Fix:** Run `npm install` (not `npm ci`) on the host to regenerate `package-lock.json`,
then commit both `package.json` and `package-lock.json`. Docker's `npm ci` requires the
lock file to already match.

---

## .env File with CRLF Line Endings (Windows)

**Problem:** Creating `.env` with `echo` in PowerShell or Windows `Set-Content` adds
CRLF line endings (`\r\n`). Docker Compose reads the trailing `\r` as part of the value,
making `CLOUDFLARE_TUNNEL_TOKEN` invalid.

**Fix:** Use PowerShell `Set-Content` with `-NoNewline` and explicit `\n`:
```powershell
Set-Content -Path .env -Value "CLOUDFLARE_TUNNEL_TOKEN=<your-token>" -NoNewline
```
Or from within WSL:
```bash
printf 'CLOUDFLARE_TUNNEL_TOKEN=<your-token>\n' > .env
```

---

## WSL / Docker DNS Resolver Failures After Restart

**Problem:** After WSL restarts (or overnight), Docker's internal DNS (`127.0.0.11`) and
WSL's `/etc/resolv.conf` become stale. The `cloudflared` container logs show:
```
dial udp: lookup <hostname>: server misbehaving
```

**Fix:** A full system reboot (not just WSL restart) reliably clears this. Longer-term,
add external DNS to `/etc/docker/daemon.json`:
```json
{ "dns": ["1.1.1.1", "8.8.8.8"] }
```
Then `sudo systemctl restart docker`.

---

## Quick Reference: Starting the Full Stack

```bash
# First time only (Ubuntu 24 / cloud VM)
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER
newgrp docker   # or log out and back in

git clone https://github.com/kingsdigitallab/nfcs-poc.git
cd nfcs-poc
git checkout deploy/express-server

# Create .env (Linux — no CRLF issues)
printf 'CLOUDFLARE_TUNNEL_TOKEN=<your-token>\n' > .env

# Start app + Ollama only (local testing, no tunnel)
docker compose up --build -d

# Pull smallest model for CPU-only (CPU-only VM)
docker compose exec ollama ollama pull qwen2:0.5b

# Start with public tunnel
docker compose --profile tunnel up -d

# Shut down tunnel after workshop
docker compose --profile tunnel down

# Check logs
docker compose logs -f app
docker compose logs -f cloudflared
```
