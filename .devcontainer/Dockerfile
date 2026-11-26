FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

# Tools the firewall script needs + Chromium for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
      iptables ipset iproute2 dnsutils aggregate jq chromium \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Firewall script and project domain list in a root-only folder. node may run the
# script with sudo (no arguments), and nothing else: this replaces the image's
# unrestricted sudo rule.
COPY init-firewall.sh allowed-domains.txt /opt/firewall/
RUN chown -R root:root /opt/firewall \
 && chmod 755 /opt/firewall /opt/firewall/init-firewall.sh \
 && chmod 644 /opt/firewall/allowed-domains.txt \
 && echo 'node ALL=(root) NOPASSWD: /opt/firewall/init-firewall.sh ""' > /etc/sudoers.d/node \
 && chmod 0440 /etc/sudoers.d/node

# Folders that get a volume mounted on them must exist and belong to node first, or
# Docker creates them owned by root. Parents (.local, .config) too, for the same reason.
RUN mkdir -p /home/node/.claude \
             /home/node/.local/share/opencode \
             /home/node/.config/opencode \
 && chown -R node:node /home/node/.claude /home/node/.local /home/node/.config