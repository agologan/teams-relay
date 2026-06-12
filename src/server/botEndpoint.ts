import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { adapter } from "../bot/adapter";
import { bot } from "../bot/teamsBot";

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

export const createPublicServer = (app: Hono) => {
  const honoListener = getRequestListener(app.fetch);

  return createServer(async (req, res) => {
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
};
