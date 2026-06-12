import { Hono, type Context } from "hono";

import { buildActivityFromWebhookPayload } from "../bot/send";
import { config } from "../config";
import { getServerRuntimeDeps } from "./runtime";

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
  const knownTeams = await getServerRuntimeDeps().storage.listKnownTeams();
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
          templatedWebhookUrl: `${origin}/webhook/{template}/${teamPath}/${channelPath}${tokenSuffix}`,
        };
      }),
    })),
  });
};

const forwardWebhook = async (
  teamId: string,
  channelId: string,
  payload: Record<string, unknown>,
  templateName?: string,
) => {
  const deps = getServerRuntimeDeps();
  const channel = await deps.storage.getChannel(teamId, channelId);

  if (!channel) {
    return {
      status: 404,
      body: { error: "channel not found", teamId, channelId },
    };
  }

  try {
    const renderedPayload = templateName
      ? await deps.renderWebhookTemplate(templateName, payload)
      : payload;
    const activity = buildActivityFromWebhookPayload(renderedPayload);
    const sent = await deps.sendToTeamsChannel(
      {
        channelId: channel.channelId,
        serviceUrl: channel.serviceUrl,
      },
      activity,
    );

    deps.metrics.recordMessageSend(true);

    return {
      status: 200,
      body: {
        ok: true,
        teamId,
        channelId,
        channelName: channel.channelName,
        template: templateName ?? null,
        ...sent,
      },
    };
  } catch (error) {
    deps.metrics.recordMessageSend(false);
    console.error("[internal] webhook forward failed", {
      teamId,
      channelId,
      templateName,
      error,
    });
    return {
      status: 500,
      body: { error: "message send failed" },
    };
  }
};

const requireWebhookAuthWhenNeeded = (c: Context, publicEndpoint: boolean) => {
  if (!webhookAuthRequired(publicEndpoint)) {
    return null;
  }

  return requireWebhookToken(c);
};

export const registerWebhooksIndexRoute = (targetApp: Hono) => {
  targetApp.get("/webhooks", async (c) => {
    if (config.webhooks.internalAuthEnabled) {
      const authError = requireWebhookToken(c);

      if (authError) {
        return authError;
      }
    }

    return buildWebhooksResponse(c, false);
  });
};

export const registerWebhookRoutes = (targetApp: Hono, publicEndpoint: boolean) => {
  targetApp.post("/webhook/raw/:team/:channel", async (c) => {
    const authError = requireWebhookAuthWhenNeeded(c, publicEndpoint);

    if (authError) {
      return authError;
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

  targetApp.post("/webhook/:templateName/:team/:channel", async (c) => {
    const authError = requireWebhookAuthWhenNeeded(c, publicEndpoint);

    if (authError) {
      return authError;
    }

    const templateName = c.req.param("templateName");
    const payload = await c.req.json<Record<string, unknown>>();
    const result = await forwardWebhook(
      decodeURIComponent(c.req.param("team")),
      decodeURIComponent(c.req.param("channel")),
      payload,
      templateName,
    );

    c.status(result.status as 200 | 404 | 500);
    return c.json(result.body);
  });
};
