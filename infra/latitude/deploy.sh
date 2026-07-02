#!/usr/bin/env bash
#
# deploy.sh — build & (re)deploy boringd onto the Latitude.sh bare-metal box.
#
# Run this from the OPERATOR LAPTOP. It will:
#   1. rsync the boringd Go source to the box   -> /opt/boring/src/
#   2. ssh in and `go build` a static boringd    -> /usr/local/bin/boringd
#   3. install the systemd unit + env file
#   4. daemon-reload, enable --now, and curl /healthz to confirm it's live
#
# Config is read from ~/.config/latitude/server.env, which must define:
#   SERVER_IP   the public IPv4 of the Latitude box
#   SSH_KEY     path to the private SSH key that can root@ the box
#   BORING_TOKEN  (optional) bearer token to require on /v1/* routes
#
# Usage:
#   infra/latitude/deploy.sh
#
set -euo pipefail

# ---- locate repo root (this script lives in infra/latitude/) -----------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ---- config ------------------------------------------------------------------
ENV_FILE="${HOME}/.config/latitude/server.env"

usage() {
  cat <<'EOF'
Usage: infra/latitude/deploy.sh

Builds boringd from ./boringd and deploys it to the Latitude bare-metal box
over SSH, installing it as a systemd service (boringd.service).

Requires ~/.config/latitude/server.env with:
  SERVER_IP=<box public IPv4>
  SSH_KEY=<path to private key>
  BORING_TOKEN=<optional bearer token>

No arguments. Reads all config from server.env.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "error: ${ENV_FILE} not found. Create it with SERVER_IP, SSH_KEY (and optional BORING_TOKEN)." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

: "${SERVER_IP:?SERVER_IP must be set in ${ENV_FILE}}"
: "${SSH_KEY:?SSH_KEY must be set in ${ENV_FILE}}"
BORING_TOKEN="${BORING_TOKEN:-}"

if [[ ! -f "${SSH_KEY}" ]]; then
  echo "error: SSH_KEY '${SSH_KEY}' does not exist." >&2
  exit 1
fi

if [[ ! -d "${REPO_ROOT}/boringd" ]]; then
  echo "error: ${REPO_ROOT}/boringd not found — nothing to deploy." >&2
  exit 1
fi

SSH_OPTS=(-i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
REMOTE="root@${SERVER_IP}"

echo "==> Deploying boringd to ${REMOTE}"

# ---- 1. rsync source ---------------------------------------------------------
echo "==> [1/5] rsync boringd/ -> ${REMOTE}:/opt/boring/src/"
ssh "${SSH_OPTS[@]}" "${REMOTE}" "mkdir -p /opt/boring/src"
rsync -az --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  "${REPO_ROOT}/boringd/" \
  "${REMOTE}:/opt/boring/src/"

# ---- 2. build ----------------------------------------------------------------
echo "==> [2/5] building boringd on the box"
ssh "${SSH_OPTS[@]}" "${REMOTE}" bash -euo pipefail <<'REMOTE_BUILD'
cd /opt/boring/src
if [ -x /usr/local/go/bin/go ]; then
  GO=/usr/local/go/bin/go
elif command -v go >/dev/null 2>&1; then
  GO=$(command -v go)
else
  echo "error: go toolchain not found on box (expected /usr/local/go/bin/go). Run bootstrap.sh first." >&2
  exit 1
fi
echo "    using $($GO version)"
CGO_ENABLED=0 "$GO" build -o /usr/local/bin/boringd ./... \
  || CGO_ENABLED=0 "$GO" build -o /usr/local/bin/boringd .
echo "    built /usr/local/bin/boringd"
REMOTE_BUILD

# ---- 3. install systemd unit + env ------------------------------------------
echo "==> [3/5] installing systemd unit + env file"
scp "${SSH_OPTS[@]}" "${SCRIPT_DIR}/boringd.service" "${REMOTE}:/etc/systemd/system/boringd.service"

# Write /etc/boring/boringd.env. Only set BORING_TOKEN if provided; never echo it.
if [[ -n "${BORING_TOKEN}" ]]; then
  echo "    writing /etc/boring/boringd.env WITH a BORING_TOKEN (auth required)"
  ssh "${SSH_OPTS[@]}" "${REMOTE}" "install -d -m 0755 /etc/boring && umask 077 && cat > /etc/boring/boringd.env" <<EOF
BORING_TOKEN=${BORING_TOKEN}
BORING_MAX=20
EOF
else
  echo "    writing /etc/boring/boringd.env WITHOUT a token (open — keep behind the SSH tunnel!)"
  ssh "${SSH_OPTS[@]}" "${REMOTE}" "install -d -m 0755 /etc/boring && umask 077 && cat > /etc/boring/boringd.env" <<EOF
BORING_MAX=20
EOF
fi

# ---- 4. (re)start service ----------------------------------------------------
echo "==> [4/5] daemon-reload + enable --now boringd"
ssh "${SSH_OPTS[@]}" "${REMOTE}" bash -euo pipefail <<'REMOTE_START'
systemctl daemon-reload
systemctl enable --now boringd
systemctl restart boringd
sleep 1
systemctl --no-pager --lines=10 status boringd || true
REMOTE_START

# ---- 5. health check ---------------------------------------------------------
echo "==> [5/5] health check: curl localhost:8080/healthz (on the box)"
if ssh "${SSH_OPTS[@]}" "${REMOTE}" 'curl -fsS --max-time 5 localhost:8080/healthz'; then
  echo
  echo "==> OK — boringd is live on ${SERVER_IP}:8080"
  echo "    Next: infra/latitude/tunnel.sh   (then run the demo against http://localhost:8080)"
else
  echo
  echo "error: /healthz did not return OK. Check: ssh -i ${SSH_KEY} ${REMOTE} journalctl -u boringd -e" >&2
  exit 1
fi
