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
  -X POST "${BASE_URL}/webhook/raw/${TEAM_ENC}/${CHANNEL_ENC}" \
  -H 'Content-Type: application/json' \
  -d @- <<'JSON'
{
  "@type": "MessageCard",
  "@context": "https://schema.org/extensions",
  "summary": "MessageCard example",
  "themeColor": "0078D4",
  "title": "MessageCard example",
  "text": "Sent through Teams Relay webhook forwarding.",
  "sections": [
    {
      "activityTitle": "Webhook migration test",
      "activitySubtitle": "Office 365 connector card payload",
      "facts": [
        { "name": "Service", "value": "teams-relay" },
        { "name": "Transport", "value": "Bot Framework" },
        { "name": "Payload", "value": "MessageCard" }
      ],
      "markdown": true
    }
  ],
  "potentialAction": [
    {
      "@type": "OpenUri",
      "name": "Open Teams",
      "targets": [
        { "os": "default", "uri": "https://teams.microsoft.com" }
      ]
    }
  ]
}
JSON

echo
