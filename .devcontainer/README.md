# Dev container

Node 24 with Claude Code and opencode, behind an outbound firewall.

## What it does

- **Claude login, settings and chats are kept across rebuilds** in a Docker volume named
  `claude-code-config-<id>`, one per project folder. They are lost if the volume is deleted,
  the project folder is moved or renamed, or Colima is deleted.
- **Outbound network access is limited to an allowlist**: npm, the Anthropic API
  and VS Code's marketplace. Outbound SSH is blocked. The firewall is set by
  `init-firewall.sh`, adapted from Anthropic's reference
  (https://github.com/anthropics/claude-code/tree/main/.devcontainer).
- **`sudo` only runs the firewall script.** Nothing in the container can change the firewall.
- **`.devcontainer/` is read-only inside the container.** Edit it from your Mac, then rebuild.

## Per-person settings

Set these on your Mac, for example in `~/.zshrc`, then quit VS Code fully and run
**Dev Containers: Rebuild Container**:

```bash
export FIREWALL_ALLOW_GITHUB=1                         # allow GitHub (HTTPS and SSH), e.g. to push
export FIREWALL_EXTRA_DOMAINS="gitlab.com api.openai.com"  # extra domains, space- or comma-separated
```

The firewall prints the settings it picked up when the container starts. If it shows
`ALLOW_GITHUB=0` when you set 1, open VS Code from a terminal with `code .`.

Domains the whole project needs, such as opencode's model provider, belong in the
domain list in `init-firewall.sh`.

## Checks

Inside the container:

```bash
sudo -l                          # only /opt/firewall/init-firewall.sh
curl -m 5 https://example.com    # should fail
```

If npm or Claude starts failing in a long session, the services' addresses may have changed:
run `sudo /opt/firewall/init-firewall.sh` to refresh them.