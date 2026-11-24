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

# Claude's config folder must exist and belong to node before the volume is mounted on it
RUN mkdir -p /home/node/.claude \
 && chown -R node:node /home/node/.claude