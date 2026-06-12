import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "node:http";

import { config } from "./config";
import { createPublicServer } from "./server/botEndpoint";
import { getServerRuntimeDeps } from "./server/runtime";
import { registerWebhookRoutes, registerWebhooksIndexRoute } from "./server/webhooks";

export {
  resetServerRuntimeDeps,
  setServerRuntimeDeps,
  type ServerRuntimeDeps,
} from "./server/runtime";

export const app = new Hono();
export const internalApp = new Hono();

app.get("/", (c) => c.json({ ok: true, service: "teams-relay" }));

internalApp.get("/healthz", (c) =>
  c.json({
    ok: true,
    service: "teams-relay",
    storageBackend: config.storageBackend,
    dynamoEndpoint: config.dynamo.endpoint,
    dynamoTable: config.dynamo.tableName,
    sqliteFilename: config.sqlite.filename,
    webhookTokenCount: config.webhooks.tokens.length,
    internalWebhookAuthEnabled: config.webhooks.internalAuthEnabled,
  }),
);

internalApp.get("/metrics", (c) => {
  c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return c.text(getServerRuntimeDeps().metrics.renderPrometheus());
});

registerWebhooksIndexRoute(internalApp);
registerWebhookRoutes(app, true);
registerWebhookRoutes(internalApp, false);

const server = createPublicServer(app);
const internalServer = createServer(getRequestListener(internalApp.fetch));

export const startServers = () => {
  server.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    console.log(`[server] bot endpoint http://localhost:${config.port}/api/messages`);
    console.log(
      `[server] public webhook endpoint http://localhost:${config.port}/webhook/raw/{team}/{channel}?token={token}`,
    );
    console.log(
      `[server] public templated webhook endpoint http://localhost:${config.port}/webhook/{template}/{team}/{channel}?token={token}`,
    );
  });

  internalServer.listen(config.internalPort, () => {
    console.log(`[internal] listening on http://localhost:${config.internalPort}`);
    console.log(`[internal] health endpoint http://localhost:${config.internalPort}/healthz`);
    console.log(`[internal] metrics endpoint http://localhost:${config.internalPort}/metrics`);
    console.log(`[internal] webhooks index http://localhost:${config.internalPort}/webhooks`);
    console.log(
      `[internal] webhook endpoint http://localhost:${config.internalPort}/webhook/raw/{team}/{channel}`,
    );
    console.log(
      `[internal] templated webhook endpoint http://localhost:${config.internalPort}/webhook/{template}/{team}/{channel}`,
    );
  });
};

if (require.main === module) {
  startServers();
}
