#!/usr/bin/env bash
# Writes the deploy key and pinned host keys from environment secrets and defines the
# `pyai-prod` SSH alias. Never prints key material. Inputs (env): SSH_KEY, KNOWN_HOSTS,
# HOST, PORT, USER_NAME.
set -euo pipefail
: "${SSH_KEY:?}" "${KNOWN_HOSTS:?}" "${HOST:?}" "${USER_NAME:?}"
PORT="${PORT:-22}"

umask 077
mkdir -p ~/.ssh
printf '%s\n' "$SSH_KEY" | tr -d '\r' >~/.ssh/pyai_deploy_key
printf '%s\n' "$KNOWN_HOSTS" | tr -d '\r' >~/.ssh/pyai_known_hosts
cat >>~/.ssh/config <<EOF
Host pyai-prod
  HostName $HOST
  Port $PORT
  User $USER_NAME
  IdentityFile ~/.ssh/pyai_deploy_key
  IdentitiesOnly yes
  UserKnownHostsFile ~/.ssh/pyai_known_hosts
  StrictHostKeyChecking yes
  BatchMode yes
  LogLevel ERROR
  ConnectTimeout 20
  ServerAliveInterval 15
  ServerAliveCountMax 4
EOF
chmod 600 ~/.ssh/config

# Fail early (without echoing anything sensitive) if the key or host pin is wrong.
ssh pyai-prod 'echo "ssh ok: $(whoami)@$(hostname -s)"'
