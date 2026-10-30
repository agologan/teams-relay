# Changelog

## Unreleased

### Changed

- Migrated from the archived `botbuilder` (Bot Framework SDK) to the Microsoft 365 Agents SDK (`@microsoft/agents-hosting`, `@microsoft/agents-activity`, `@microsoft/agents-hosting-extensions-msteams`).
- `/api/messages` now authorizes the JWT before reading the request body. Body size is capped at 1 MiB (`413`); malformed JSON returns `400`.

### Removed

- **Breaking:** `BOT_APP_TYPE` env var. Auth is always client secret (`BOT_APP_ID`, `BOT_APP_PASSWORD`, `BOT_TENANT_ID`). Multi-tenant bots are no longer supported. `UserAssignedMSI` was already unusable because `BOT_APP_PASSWORD` was required.

### Fixed

- Outbound sends pass the Bot Framework token scope (`https://api.botframework.com`) when creating conversations, as the Agents SDK requires.
- Restored Teams channel and exact service URL checks. Inbound auth supports the public Bot Framework cloud only (`https://api.botframework.com`); US Government clouds are not supported. Outbound service URLs require HTTPS and an allowed host; additional hosts can be configured with `BOT_SERVICE_URL_HOSTS`.
- Retry delays now honor headers on SDK HTTP errors, and Teams API URLs no longer contain duplicate slashes.
