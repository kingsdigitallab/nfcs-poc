# Dev container

Node 24 with Claude Code and opencode, behind an outbound firewall.

## What it does

- **Claude and opencode logins, settings and chats are kept across rebuilds** in Docker
  volumes, one set per project folder: `claude-code-config-<id>`, `opencode-data-<id>`
  (conversations and credentials) and `opencode-config-<id>` (settings and plugins). They
  are lost if a volume is deleted, or the project folder is moved or renamed.
- **Outbound network access is limited** by `init-firewall.sh`, adapted from Anthropic's
  reference (https://github.com/anthropics/claude-code/tree/main/.devcontainer). Two modes,
  as below. In both, SSH and every non-web port are blocked, DNS goes only to the container's
  resolver, IPv6 is closed, and the Docker host is unreachable.
- **The firewall fails closed.** If setup fails, the container is left with no network at all.
- **`sudo` only runs the firewall script.** Nothing in the container can change the firewall.
- **Claude Code's claude.ai connectors are off** (Google Drive, Gmail, Calendar, Claude Docs).
  They run on Anthropic's servers, so the firewall cannot stop them creating or sharing
  documents. The policy is `managed-settings.json`, installed root-owned at
  `/etc/claude-code/` — the highest-precedence settings, which no user or project setting
  (and no agent) can override. It applies in this container only: to remove the connectors
  everywhere, disconnect them in your claude.ai account settings.
- **`.devcontainer/` is read-only inside the container.** Edit it from the host, then rebuild.

## Firewall modes

### Locked down (default)

Web ports (80/443) only, and only to the hosts in `allowed-domains.txt` plus npm, the
Anthropic API and VS Code's marketplace. Use this for a first audit of code you do not
yet trust.

What agents can **not** do in this mode:

- **Read web pages.** Claude Code's web *search* still works because it runs on Anthropic's
  servers and search summaries give some information. But fetching a page — documentation, 
  changelogs, GitHub issues, package READMEs and so on will not work.
- **Install packages from anywhere but npm**, or reach APIs not on the list.
- **Use URL Fetch on arbitrary links** in the app (only allowlisted hosts work).

### Relaxed: `DEVCONTAINER_FIREWALL_OPEN_WEB=1`

Web ports to **any public address**. Agents can read documentation and fetch pages.
Still blocked: SSH and other ports, DNS bypass, IPv6, and web ports to private and local
networks (Docker host, your router, VPN-internal hosts) unless they are allowlisted.

Risks you accept in this mode:

- **Data can leave over HTTPS.** Anything an agent can read in the container — the
  project, a `.env` with live keys, Claude's login — can be sent to any website, for
  example hidden in a URL. The firewall no longer limits *where*.
- **Untrusted code can download more code** from anywhere.
- Use it only once you trust the code in the workspace, and keep live secrets out of the
  checkout.

## Per-user settings

Pass them on the command line when you open VS Code, so they apply to that launch only
and never sit in your shell. Quit VS Code fully first then run **Dev Containers: Rebuild Container**:

```bash
DEVCONTAINER_FIREWALL_OPEN_WEB=1 code .                  # relaxed mode (see above)
DEVCONTAINER_FIREWALL_ALLOW_GITHUB=1 code .              # allow GitHub (HTTPS and SSH), e.g. to push
DEVCONTAINER_FIREWALL_EXTRA_DOMAINS="gitlab.com api.openai.com" code .  # extra domains, space- or comma-separated
```

On Windows PowerShell: `$env:DEVCONTAINER_FIREWALL_OPEN_WEB=1; code .` (applies to that
terminal session).

Domains the whole project needs belong in `allowed-domains.txt` (rebuild after editing).

## Pushing to GitHub: `DEVCONTAINER_FIREWALL_ALLOW_GITHUB=1`

This opens every port to GitHub, including SSH. The container has no GitHub credentials
of its own; whatever you give it, code in the container can use. Options, safest first:

1. **Fine-grained token for this repo only** (GitHub → Settings → Developer settings →
   Fine-grained tokens): one repository, *Contents: read and write*, short expiry. Enter it
   as the password when `git push` asks. To avoid retyping, keep it in memory only:
   `git config --global credential.helper 'cache --timeout=3600'` — never `store`, which
   writes it to disk in plain text.
2. **SSH deploy key for this repo** (repo → Settings → Deploy keys, write access), loaded
   into your SSH agent with `ssh-add -c` so each use asks for approval. Needs an SSH remote
   (`git@github.com:<owner>/<repo>.git`). Avoid your personal key: it usually opens every
   repository you can access.
3. **Not recommended:** VS Code's git credential forwarding hands the container your full
   GitHub login.

Whichever you use, protect `main` on GitHub (require pull requests, block force-pushes),
so a misused credential can only push branches.

## opencode

The project's `opencode.json` (repo root) sets up the provider, its models and the default
model, with no key in it. Each person only adds their own key: run `opencode auth login`,
choose **Other**, enter the provider ID used in `opencode.json` (`arcai`), and paste the
key. opencode stores it in plain text in
`~/.local/share/opencode/auth.json`, on the `opencode-data-<id>` volume: it survives
rebuilds, is never in the project folder (so cannot be committed), and is removed with the
volume (`docker volume rm opencode-data-<id>`).

Anything running in the container can read it, agents included. Prefer a key you can
budget-cap and revoke. Personal opencode settings go in `~/.config/opencode/opencode.jsonc`
on the config volume; they are merged with the project's `opencode.json`.

## SSH agent

VS Code always forwards the host's SSH agent into the container; there is no setting to
turn it off (https://github.com/microsoft/vscode-remote-release/issues/11413). The firewall
stops a loaded key being used to log in anywhere, but code in the container can still use
it to *sign* things, such as git commits. Keep your agent empty while the container is
open (`ssh-add -l` should say it has no identities), or add keys with `ssh-add -c` so
every use needs your approval.

## VPN and DNS

With some Docker setups the container's DNS follows the host's network as it was when
Docker started. Connecting or disconnecting a VPN while Docker is running can then break
DNS in the container: reconnect, or restart your Docker engine. VPN-only hosts 
(e.g. KCL's inference API) are skipped with a warning if
they do not resolve when the container starts.

## Checks

Inside the container:

```bash
sudo -l                          # only /opt/firewall/init-firewall.sh
curl -m 5 https://example.com    # fails when locked down, works with OPEN_WEB=1
```

If npm or Claude starts failing in a long session, the service address may have changed:
run `sudo /opt/firewall/init-firewall.sh` to refresh them.
