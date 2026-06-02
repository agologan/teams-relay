# Teams Relay

Teams Relay replaces legacy Microsoft Teams incoming webhooks with a bot-backed relay service.

Incoming webhook payloads hit Teams Relay. Teams Relay sends messages into Teams channels through Microsoft Bot Framework.

## How it works

1. You create a Microsoft Bot/App Registration.
2. You edit `manifest/manifest.json` with your bot id, app id, domains, and developer info.
3. You deploy the Teams Relay Docker container.
4. You expose `POST /api/messages` publicly over HTTPS.
5. You install the Teams app into a team.
6. Teams Relay stores team/channel context.
7. You send webhook payloads to public or internal relay endpoints.

## Requirements

- Node for local development
- Docker for container deployment
- Microsoft Teams tenant where custom apps can be installed
- Azure Bot/App Registration credentials
- HTTPS public URL for Bot Framework callbacks

## Create Microsoft bot credentials

Create an Azure Bot or App Registration for Teams bot use, then note:

- application/client id
- client secret
- tenant id

Configure bot messaging endpoint to:

```text
https://YOUR_PUBLIC_DOMAIN/api/messages
```

## Configure Teams app manifest

Edit:

```text
manifest/manifest.json
```

Replace placeholders:

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "developer": {
    "name": "Your name or org",
    "websiteUrl": "https://your-domain.example",
    "privacyUrl": "https://your-domain.example/privacy",
    "termsOfUseUrl": "https://your-domain.example/terms"
  },
  "name": {
    "short": "Relay",
    "full": "Teams Relay"
  },
  "bots": [
    {
      "botId": "00000000-0000-0000-0000-000000000000",
      "scopes": ["team"]
    }
  ],
  "validDomains": ["your-public-domain.example"]
}
```

Use same Microsoft application id for:

- top-level `id`
- `bots[0].botId`
- `BOT_APP_ID` / `CLIENT_ID`

Then package manifest:

```sh
pnpm manifest
```

This creates `manifest.zip`. Upload/install it in Teams.

## Runtime configuration

Teams Relay reads process environment. Scripts use Node `--env-file-if-exists=.env`; Docker users can pass environment directly or use `--env-file`.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `BOT_APP_TYPE` | `SingleTenant` | Bot Framework app type: `SingleTenant`, `MultiTenant`, or `UserAssignedMSI`. |
| `BOT_APP_ID` / `CLIENT_ID` | required | Microsoft app/client id. |
| `BOT_APP_PASSWORD` / `CLIENT_SECRET` | required | Microsoft app secret. |
| `BOT_TENANT_ID` / `TENANT_ID` | required | Microsoft tenant id. |
| `PORT` | `3000` | Public HTTP port. Exposes `/api/messages`. |
| `INTERNAL_PORT` | `3001` | Internal HTTP port for health, metrics, and webhook forwarding. Keep private. |
| `STORAGE_BACKEND` | `dynamodb` | `dynamodb` or `sqlite`. |
| `SQLITE_FILENAME` | `teams-relay.sqlite` | SQLite database path when using SQLite. |
| `DYNAMODB_ENDPOINT` | `http://localhost:8000` | DynamoDB endpoint. Use AWS endpoint or DynamoDB Local. |
| `DYNAMODB_REGION` | `us-east-1` | DynamoDB region. |
| `DYNAMODB_TABLE` | `teams-relay` | DynamoDB table name. |
| `WEBHOOK_TOKENS` | empty | Comma-separated valid tokens for public webhook URLs. Public webhook endpoints require `?token=...`. |
| `INTERNAL_WEBHOOK_AUTH_ENABLED` | `false` | Require same token auth on internal webhook endpoints. |

## Run with Docker

SQLite is simplest for self-hosting:

```sh
docker build -t teams-relay .

docker run --rm \
  --env-file .env \
  -p 3000:3000 \
  -p 3001:3001 \
  -v teams-relay-data:/data \
  teams-relay
```

Use `.env` similar to:

```env
BOT_APP_TYPE=SingleTenant
BOT_TENANT_ID=your-tenant-id
BOT_APP_ID=your-app-id
BOT_APP_PASSWORD=your-client-secret
STORAGE_BACKEND=sqlite
SQLITE_FILENAME=/data/teams-relay.sqlite
PORT=3000
INTERNAL_PORT=3001
```

Expose only public port `3000` to internet, and only over HTTPS. Keep internal port `3001` private.

## Install in Teams

1. Upload `manifest.zip` as custom app in Teams.
2. Add app to a team.
3. Teams Relay receives install event on `/api/messages`.
4. Teams Relay stores installation and channels.

Check health:

```sh
curl http://localhost:3001/healthz
```

List known webhooks:

```sh
curl http://localhost:3001/webhooks
```

## Send webhook message

Use URL returned by internal `GET /webhooks`. Public webhook endpoints require `?token=...`.

Forward message:

```sh
curl -X POST \
  -H 'content-type: application/json' \
  -d '{"text":"Hello from Teams Relay"}' \
  'https://YOUR_PUBLIC_DOMAIN/webhook/fwd/{team}/{channel}?token=replace-with-long-random-token'
```

Templated webhook endpoint:

```text
POST /webhook/{keyword}/{team}/{channel}?token=replace-with-long-random-token
```

Templates live in:

```text
templates/
```

## Storage backends

### SQLite

Good for single-container/self-hosted deployments.

```env
STORAGE_BACKEND=sqlite
SQLITE_FILENAME=/data/teams-relay.sqlite
```

Persist `/data` as Docker volume.

### DynamoDB

Good for AWS deployments or local DynamoDB iteration.

```env
STORAGE_BACKEND=dynamodb
DYNAMODB_REGION=us-east-1
DYNAMODB_TABLE=teams-relay
DYNAMODB_ENDPOINT=http://localhost:8000
```

For AWS-hosted DynamoDB, omit local endpoint or set it to your desired endpoint.

## Endpoints

Public server:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Basic service check. |
| `POST` | `/api/messages` | Bot Framework messaging endpoint. |
| `POST` | `/webhook/fwd/{team}/{channel}?token=...` | Forward payload to channel. |
| `POST` | `/webhook/{keyword}/{team}/{channel}?token=...` | Render template, then forward. |

Internal server:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Health/config check. |
| `GET` | `/metrics` | Prometheus-style metrics. |
| `GET` | `/webhooks` | List teams/channels and generated webhook URLs. |
| `POST` | `/webhook/fwd/{team}/{channel}` | Forward payload to channel. |
| `POST` | `/webhook/{keyword}/{team}/{channel}` | Render template, then forward. |

Public webhook endpoints require `?token=...` where token is listed in `WEBHOOK_TOKENS`.

Internal webhook endpoints do not require token by default. Set `INTERNAL_WEBHOOK_AUTH_ENABLED=true` to require same token auth internally.

## Development

```sh
pnpm install
pnpm dev
```

Typecheck/build:

```sh
pnpm typecheck
pnpm build
```

Validate manifest:

```sh
pnpm manifest:validate
```

Package manifest:

```sh
pnpm manifest
```

## License

MIT
