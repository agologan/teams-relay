#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
TEAM_ID="${1:?usage: BASE_URL=http://localhost:3001 $0 <team-id> <channel-id>}"
CHANNEL_ID="${2:?usage: BASE_URL=http://localhost:3001 $0 <team-id> <channel-id>}"

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

TEAM_ENC="$(urlencode "$TEAM_ID")"
CHANNEL_ENC="$(urlencode "$CHANNEL_ID")"

curl -fsS \
  -X POST "${BASE_URL}/webhook/fwd/${TEAM_ENC}/${CHANNEL_ENC}" \
  -H 'Content-Type: application/json' \
  -d @- <<'JSON'
{
  "text": "Hello from Teams Relay webhook text example."
}
JSON

echo
