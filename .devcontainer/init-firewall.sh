#!/bin/bash
set -euo pipefail
IFS=$'\n\t'       # Stricter word splitting

# FAIL CLOSED: outbound traffic is dropped from the first rule change onwards, and
# any error (set -e, explicit exit 1, failed verification) ends in lockdown() —
# loopback only. A half-run script must never leave the container wide open.
lockdown() {
    echo "FIREWALL: setup failed — locking down (loopback only, no network)" >&2
    iptables -P INPUT DROP;  iptables -P FORWARD DROP;  iptables -P OUTPUT DROP
    iptables -F || true
    iptables -A INPUT -i lo -j ACCEPT
    iptables -A OUTPUT -o lo -j ACCEPT
}
trap 'rc=$?; if [ "$rc" -ne 0 ]; then lockdown; fi' EXIT

# Settings come from devcontainer.json "containerEnv". They are read from PID 1's
# environment, not from this process: sudo resets the environment, and reading them
# here means nothing running inside the container can change them.
container_env() {
    tr '\0' '\n' < /proc/1/environ | sed -n "s/^$1=//p" | head -n 1
}
ALLOW_GITHUB=$(container_env FIREWALL_ALLOW_GITHUB)
ALLOW_GITHUB=${ALLOW_GITHUB:-0}                       # 1 = allow GitHub (HTTPS and SSH)
EXTRA_DOMAINS=$(container_env FIREWALL_EXTRA_DOMAINS)  # space- or comma-separated
echo "ALLOW_GITHUB=$ALLOW_GITHUB EXTRA_DOMAINS=${EXTRA_DOMAINS:-none}"

# Project domains: one per line in .devcontainer/allowed-domains.txt, copied into the
# image at build time (root-owned). Blank lines and # comments are ignored.
DOMAINS_FILE=/opt/firewall/allowed-domains.txt
FILE_DOMAINS=""
if [ -f "$DOMAINS_FILE" ]; then
    while read -r line; do
        line=$(echo "$line" | sed -e 's/#.*//' -e 's/[[:space:]]//g')
        [ -z "$line" ] && continue
        if [[ "$line" =~ ^[A-Za-z0-9.-]+$ ]]; then
            FILE_DOMAINS+="$line"$'\n'
        else
            echo "WARNING: ignoring invalid line in $DOMAINS_FILE: $line"
        fi
    done < "$DOMAINS_FILE"
    echo "Project domains from $DOMAINS_FILE: $(printf '%s' "$FILE_DOMAINS" | grep -c . || true)"
else
    echo "No $DOMAINS_FILE, no project domains"
fi

# Block FIRST. Policies go to DROP before any rule is flushed, so re-running the
# script in a live container never passes through an open state.
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# IPv6: this script only maintains an IPv4 allowlist, so IPv6 is closed entirely
# (the container has no IPv6 today; this keeps a future Docker setting from opening it).
if command -v ip6tables >/dev/null; then
    ip6tables -P INPUT DROP   2>/dev/null || true
    ip6tables -P FORWARD DROP 2>/dev/null || true
    ip6tables -P OUTPUT DROP  2>/dev/null || true
    ip6tables -F              2>/dev/null || true
    ip6tables -A INPUT -i lo -j ACCEPT  2>/dev/null || true
    ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
fi

# 1. Extract Docker DNS info BEFORE any flushing
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# Flush existing rules and delete existing ipsets (policies stay DROP)
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# 2. Selectively restore ONLY internal Docker DNS resolution
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
    echo "No Docker DNS rules to restore"
fi

# DNS and localhost
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Replies to approved traffic, and the allowlist itself. Added BEFORE the set is
# filled so an address becomes reachable the moment it is added (the GitHub meta
# fetch below depends on this).
ipset create allowed-domains hash:net
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# Resolve a domain into the set. Returns 1 (does not exit) when it has no A record.
add_domain() {
    local domain=$1 ips ip
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        return 1
    fi
    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "ERROR: Invalid IP from DNS for $domain: $ip"
            exit 1
        fi
        echo "Adding $ip for $domain"
        ipset add -exist allowed-domains "$ip"
    done < <(echo "$ips")
}

if [ "$ALLOW_GITHUB" = 1 ]; then
    # api.github.com must be reachable to fetch the ranges (outbound is already DROP)
    add_domain api.github.com || { echo "ERROR: Failed to resolve api.github.com"; exit 1; }
    echo "Fetching GitHub IP ranges..."
    gh_ranges=$(curl -s https://api.github.com/meta)
    if [ -z "$gh_ranges" ]; then
        echo "ERROR: Failed to fetch GitHub IP ranges"
        exit 1
    fi

    if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null; then
        echo "ERROR: GitHub API response missing required fields"
        exit 1
    fi

    echo "Processing GitHub IPs..."
    while read -r cidr; do
        if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
            echo "ERROR: Invalid CIDR range from GitHub meta: $cidr"
            exit 1
        fi
        echo "Adding GitHub range $cidr"
        ipset add -exist allowed-domains "$cidr"
    done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)
fi

# Resolve and add other allowed domains. A domain that does not resolve (e.g. a
# VPN-only host while off the VPN) is skipped with a warning: it stays blocked,
# everything else keeps working.
SKIPPED=""
for domain in \
    "registry.npmjs.org" \
    "api.anthropic.com" \
    "marketplace.visualstudio.com" \
    "vscode.blob.core.windows.net" \
    "update.code.visualstudio.com" \
    $FILE_DOMAINS \
    $(echo "$EXTRA_DOMAINS" | tr ', ' '\n\n' | grep -E '^[A-Za-z0-9.-]+$' || true); do
    echo "Resolving $domain..."
    if ! add_domain "$domain"; then
        echo "WARNING: Failed to resolve $domain — skipped (stays blocked)"
        SKIPPED+="$domain "
    fi
done

# Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi

HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"

iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Explicitly REJECT all other outbound traffic for immediate feedback
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Firewall configuration complete"
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
else
    echo "Firewall verification passed - unable to reach https://example.com as expected"
fi

if [ "$ALLOW_GITHUB" = 1 ]; then
    # Verify GitHub API access
    if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
        echo "ERROR: Firewall verification failed - unable to reach https://api.github.com"
        exit 1
    else
        echo "Firewall verification passed - able to reach https://api.github.com as expected"
    fi
else
    # Verify Anthropic API access
    if ! curl --connect-timeout 5 https://api.anthropic.com >/dev/null 2>&1; then
        echo "ERROR: Firewall verification failed - unable to reach https://api.anthropic.com"
        exit 1
    else
        echo "Firewall verification passed - able to reach https://api.anthropic.com as expected"
    fi
fi

if [ -n "$SKIPPED" ]; then
    echo "WARNING: these domains did not resolve and are blocked: $SKIPPED"
fi
