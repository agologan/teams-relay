import type { Request, WebResponse } from "@microsoft/agents-hosting";
import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { adapter, serviceUrlPolicy } from "../bot/adapter";
import { agent } from "../bot/teamsBot";

const MAX_BODY_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {}

const readJsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;

    if (size > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError("Request body too large");
    }

    chunks.push(buffer);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();

  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody) as Record<string, unknown>;
};

const createBotResponse = (res: ServerResponse): WebResponse => ({
  get headersSent() {
    return res.headersSent;
  },
  get writableEnded() {
    return res.writableEnded;
  },
  end() {
    res.end();
    return this;
  },
  setHeader(name, value) {
    res.setHeader(name, value);
    return this;
  },
  send(body) {
    if (body === undefined) {
      return this;
    }

    if (typeof body === "string") {
      if (!res.hasHeader("content-type")) {
        res.setHeader("content-type", "text/plain; charset=utf-8");
      }
      res.end(body);
      return this;
    }

    if (!res.hasHeader("content-type")) {
      res.setHeader("content-type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(body));
    return this;
  },
  status(code) {
    res.statusCode = code;
    return this;
  },
});

export const createPublicServer = (app: Hono) => {
  const honoListener = getRequestListener(app.fetch);

  return createServer(async (req, res) => {
    if (req.method === "POST" && req.url?.startsWith("/api/messages")) {
      try {
        // Authorize first so unauthenticated callers cannot make us buffer bodies.
        const botReq: Request = {
          method: req.method,
          headers: req.headers,
        };
        const botRes = createBotResponse(res);
        let processing: Promise<void> | undefined;

        await adapter.authorizeRequest(botReq, botRes, () => {
          processing = (async () => {
            botReq.body = await readJsonBody(req);
            const serviceUrl = botReq.body?.serviceUrl;
            // SDK only compares URL hosts, and accepts a missing serviceurl claim.
            if (
              botReq.body?.channelId !== "msteams" ||
              typeof serviceUrl !== "string" ||
              botReq.user?.serviceurl !== serviceUrl ||
              !serviceUrlPolicy.isAllowed(serviceUrl)
            ) {
              res.statusCode = 401;
              res.end();
              return;
            }
            await adapter.process(botReq, botRes, (context) => agent.run(context));
          })();
        });
        await processing;
      } catch (error) {
        const status =
          error instanceof PayloadTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 500;

        if (status === 500) {
          console.error("[server] bot endpoint failed", error);
        }

        if (!res.headersSent) {
          res.statusCode = status;
          res.end();
        }
      }

      return;
    }

    await honoListener(req, res);
  });
};
