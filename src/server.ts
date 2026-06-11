import { Hono, type Context } from "hono";
import { getRequestListener } from "@hono/node-server";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { adapter } from "./bot/adapter";
import { buildActivityFromWebhookPayload, sendToTeamsChannel } from "./bot/send";
import { bot } from "./bot/teamsBot";
import { config } from "./config";
import { metrics } from "./metrics";
import { storage } from "./storage";
import { renderWebhookTemplate } from "./templates";

const readJsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();

  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody) as Record<string, unknown>;
};

const createBotResponse = (res: ServerResponse) => ({
  socket: res.socket,
  end: (...args: unknown[]) => res.end(...(args as [])),
  header: (name: string, value: unknown) => {
    res.setHeader(name, value as string);
    return res;
  },
  send: (body?: unknown) => {
    if (body === undefined) {
      return res;
    }

    if (typeof body === "string") {
      if (!res.hasHeader("content-type")) {
        res.setHeader("content-type", "text/plain; charset=utf-8");
      }

      res.write(body);
      return res;
    }

    if (!res.hasHeader("content-type")) {
      res.setHeader("content-type", "application/json; charset=utf-8");
    }

    res.write(JSON.stringify(body));
    return res;
  },
  status: (code: number) => {
    res.statusCode = code;
    return res;
  },
});

const app = new Hono();

app.get("/", (c) => c.json({ ok: true, service: "teams-relay" }));

const internalApp = new Hono();

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
  return c.text(metrics.renderPrometheus());
});

const encodeWebhookPathPart = (value: string) => encodeURIComponent(value);

const makeTokenQuery = (token: string) => `?token=${encodeURIComponent(token)}`;

const getBearerToken = (c: Context) => {
  const authHeader = c.req.header("authorization")?.trim();

  if (!authHeader) {
    return undefined;
  }

  const [scheme, ...tokenParts] = authHeader.split(/\s+/);

  if (scheme.toLowerCase() !== "bearer" || tokenParts.length !== 1) {
    return undefined;
  }

  return tokenParts[0]?.trim() || undefined;
};

const getWebhookToken = (c: Context) => c.req.query("token")?.trim() || getBearerToken(c);

const hasValidWebhookToken = (c: Context) => {
  const token = getWebhookToken(c);

  return Boolean(token && config.webhooks.tokens.includes(token));
};

const requireWebhookToken = (c: Context) => {
  if (hasValidWebhookToken(c)) {
    return null;
  }

  return c.json({ error: "invalid or missing webhook token" }, 401);
};

const webhookAuthRequired = (publicEndpoint: boolean) =>
  publicEndpoint || config.webhooks.internalAuthEnabled;

const buildWebhooksResponse = async (c: Context, publicEndpoint: boolean) => {
  const origin = new URL(c.req.url).origin;
  const knownTeams = await storage.knownTeams.list();
  const token = getWebhookToken(c);
  const tokenSuffix = webhookAuthRequired(publicEndpoint) && token ? makeTokenQuery(token) : "";

  return c.json({
    teams: knownTeams.teams.map((team) => ({
      tenantId: team.tenantId,
      teamId: team.teamId,
      teamName: team.teamName,
      channels: team.channels.map((channel) => {
        const teamPath = encodeWebhookPathPart(team.teamId);
        const channelPath = encodeWebhookPathPart(channel.channelId);

        return {
          channelId: channel.channelId,
          channelName: channel.channelName,
          status: channel.status,
          updatedAt: channel.updatedAt,
          webhookUrl: `${origin}/webhook/raw/${teamPath}/${channelPath}${tokenSuffix}`,
          templatedWebhookUrl: `${origin}/webhook/{keyword}/${teamPath}/${channelPath}${tokenSuffix}`,
        };
      }),
    })),
  });
};

internalApp.get("/webhooks", async (c) => {
  if (config.webhooks.internalAuthEnabled) {
    const authError = requireWebhookToken(c);

    if (authError) {
      return authError;
    }
  }

  return buildWebhooksResponse(c, false);
});

const forwardWebhook = async (
  teamId: string,
  channelId: string,
  payload: Record<string, unknown>,
  templateKeyword?: string,
) => {
  const channel = await storage.knownTeams.getChannel(teamId, channelId);

  if (!channel) {
    return {
      status: 404,
      body: { error: "channel not found", teamId, channelId },
    };
  }

  try {
    const renderedPayload = templateKeyword
      ? await renderWebhookTemplate(templateKeyword, payload)
      : payload;
    const activity = buildActivityFromWebhookPayload(renderedPayload);
    const sent = await sendToTeamsChannel(
      {
        channelId: channel.channelId,
        serviceUrl: channel.serviceUrl,
      },
      activity,
    );

    metrics.recordMessageSend(true);

    return {
      status: 200,
      body: {
        ok: true,
        teamId,
        channelId,
        channelName: channel.channelName,
        template: templateKeyword ?? null,
        ...sent,
      },
    };
  } catch (error) {
    metrics.recordMessageSend(false);
    console.error("[internal] webhook forward failed", {
      teamId,
      channelId,
      templateKeyword,
      error,
    });
    return {
      status: 500,
      body: { error: "message send failed" },
    };
  }
};

const registerWebhookRoutes = (targetApp: Hono, publicEndpoint: boolean) => {
  targetApp.post("/webhook/raw/:team/:channel", async (c) => {
    if (webhookAuthRequired(publicEndpoint)) {
      const authError = requireWebhookToken(c);

      if (authError) {
        return authError;
      }
    }

    const payload = await c.req.json<Record<string, unknown>>();
    const result = await forwardWebhook(
      decodeURIComponent(c.req.param("team")),
      decodeURIComponent(c.req.param("channel")),
      payload,
    );

    c.status(result.status as 200 | 404 | 500);
    return c.json(result.body);
  });

  targetApp.post("/webhook/:keyword/:team/:channel", async (c) => {
    if (webhookAuthRequired(publicEndpoint)) {
      const authError = requireWebhookToken(c);

      if (authError) {
        return authError;
      }
    }

    const keyword = c.req.param("keyword");
    const payload = await c.req.json<Record<string, unknown>>();
    const result = await forwardWebhook(
      decodeURIComponent(c.req.param("team")),
      decodeURIComponent(c.req.param("channel")),
      payload,
      keyword,
    );

    c.status(result.status as 200 | 404 | 500);
    return c.json(result.body);
  });
};

registerWebhookRoutes(app, true);
registerWebhookRoutes(internalApp, false);

const honoListener = getRequestListener(app.fetch);
const internalHonoListener = getRequestListener(internalApp.fetch);

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/api/messages")) {
    try {
      const body = await readJsonBody(req);
      const botReq = {
        method: req.method,
        headers: req.headers,
        body,
      };
      const botRes = createBotResponse(res);

      await adapter.process(botReq, botRes, async (context) => bot.run(context));
    } catch (error) {
      console.error("[server] bot endpoint failed", error);

      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    }

    return;
  }

  await honoListener(req, res);
});

const internalServer = createServer(async (req, res) => {
  await internalHonoListener(req, res);
});

server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(`[server] bot endpoint http://localhost:${config.port}/api/messages`);
  console.log(
    `[server] public webhook endpoint http://localhost:${config.port}/webhook/raw/{team}/{channel}?token={token}`,
  );
  console.log(
    `[server] public templated webhook endpoint http://localhost:${config.port}/webhook/{keyword}/{team}/{channel}?token={token}`,
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
    `[internal] templated webhook endpoint http://localhost:${config.internalPort}/webhook/{keyword}/{team}/{channel}`,
  );
});
