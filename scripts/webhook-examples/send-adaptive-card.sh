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
  "type": "AdaptiveCard",
  "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
  "version": "1.5",
  "summary": "AdaptiveCard example",
  "body": [
    {
      "type": "TextBlock",
      "text": "Adaptive Card example",
      "weight": "Bolder",
      "size": "Medium"
    },
    {
      "type": "TextBlock",
      "text": "Sent through Teams Relay webhook forwarding.",
      "wrap": true
    },
    {
      "type": "FactSet",
      "facts": [
        { "title": "Service", "value": "teams-relay" },
        { "title": "Transport", "value": "Bot Framework" },
        { "title": "Payload", "value": "AdaptiveCard" }
      ]
    }
  ],
  "actions": [
    {
      "type": "Action.OpenUrl",
      "title": "Open Teams",
      "url": "https://teams.microsoft.com"
    }
  ]
}
JSON

echo
