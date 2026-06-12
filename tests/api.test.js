import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { renderWebhookTemplate } from "../src/templates.ts";
import { makeSendableChannel, makeTestingStore } from "./support/testing-store.js";

process.env.BOT_APP_ID = "test-app-id";
process.env.BOT_APP_PASSWORD = "test-password";
process.env.BOT_TENANT_ID = "test-tenant";
process.env.STORAGE_BACKEND = "dynamodb";
process.env.WEBHOOK_TOKENS = "secret";

let app;
let internalApp;
let setServerRuntimeDeps;
let resetServerRuntimeDeps;

before(async () => {
  const server = await import("../src/server.ts");
  app = server.app;
  internalApp = server.internalApp;
  setServerRuntimeDeps = server.setServerRuntimeDeps;
  resetServerRuntimeDeps = server.resetServerRuntimeDeps;
});

const makeDeps = ({
  store = makeTestingStore(),
  sendFails = false,
  templateRenderer = async (keyword, payload) => ({
    type: "message",
    text: `${keyword}:${payload.text}`,
  }),
} = {}) => {
  const sent = [];
  const rendered = [];
  const metricEvents = [];

  setServerRuntimeDeps({
    storage: store,
    async sendToTeamsChannel(target, activity) {
      sent.push({ target, activity });

      if (sendFails) {
        throw new Error("send failed");
      }

      return { id: "sent-1" };
    },
    async renderWebhookTemplate(keyword, payload) {
      rendered.push({ keyword, payload });
      return templateRenderer(keyword, payload);
    },
    metrics: {
      recordMessageSend(success) {
        metricEvents.push(success);
      },
      renderPrometheus() {
        return "teams_relay_messages_sent_total 0\n";
      },
    },
  });

  return { sent, rendered, metricEvents };
};

beforeEach(() => {
  resetServerRuntimeDeps();
});

test("public root returns service shape", async () => {
  const res = await app.request("/");

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    service: "teams-relay",
  });
});

test("internal health returns API shape", async () => {
  const res = await internalApp.request("/healthz");

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    service: "teams-relay",
    storageBackend: "dynamodb",
    dynamoTable: "teams-relay",
    sqliteFilename: "teams-relay.sqlite",
    webhookTokenCount: 1,
    internalWebhookAuthEnabled: false,
  });
});

test("metrics endpoint returns prometheus text", async () => {
  makeDeps();

  const res = await internalApp.request("/metrics");

  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/plain/);
  assert.match(await res.text(), /teams_relay_messages_sent_total/);
});

test("public raw webhook rejects missing or invalid token", async () => {
  makeDeps();

  const missing = await app.request("/webhook/raw/team/channel", {
    method: "POST",
    body: JSON.stringify({ text: "hello" }),
    headers: { "content-type": "application/json" },
  });
  const invalid = await app.request("/webhook/raw/team/channel?token=wrong", {
    method: "POST",
    body: JSON.stringify({ text: "hello" }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: "invalid or missing webhook token" });
  assert.equal(invalid.status, 401);
});

test("public raw webhook accepts bearer token", async () => {
  const sendableChannels = new Map([["team:channel", makeSendableChannel()]]);
  const deps = makeDeps({ store: makeTestingStore({ sendableChannels }) });

  const res = await app.request("/webhook/raw/team/channel", {
    method: "POST",
    body: JSON.stringify({ text: "hello" }),
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    teamId: "team",
    channelId: "channel",
    channelName: "Alerts",
    template: null,
    id: "sent-1",
  });
  assert.equal(deps.sent.length, 1);
  assert.deepEqual(deps.metricEvents, [true]);
});

test("public templated webhook renders named template through API", async () => {
  const sendableChannels = new Map([["team:channel", makeSendableChannel()]]);
  const deps = makeDeps({
    store: makeTestingStore({ sendableChannels }),
    templateRenderer: renderWebhookTemplate,
  });

  const res = await app.request("/webhook/alert/team/channel?token=secret", {
    method: "POST",
    body: JSON.stringify({
      title: "CPU high",
      text: "CPU above 90%",
      severity: "critical",
      service: "api",
      environment: "prod",
    }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.status, 200);
  assert.equal((await res.json()).template, "alert");
  assert.deepEqual(deps.rendered, [
    {
      keyword: "alert",
      payload: {
        title: "CPU high",
        text: "CPU above 90%",
        severity: "critical",
        service: "api",
        environment: "prod",
      },
    },
  ]);
  assert.equal(deps.sent[0].activity.attachments[0].content.body[0].text, "CPU high");
  assert.equal(deps.sent[0].activity.attachments[0].content.body[1].text, "CPU above 90%");
  assert.deepEqual(deps.sent[0].activity.attachments[0].content.body[2].facts, [
    { title: "Severity", value: "critical" },
    { title: "Service", value: "api" },
    { title: "Environment", value: "prod" },
  ]);
});

test("public templated webhook falls back to default template through API", async () => {
  const sendableChannels = new Map([["team:channel", makeSendableChannel()]]);
  const deps = makeDeps({
    store: makeTestingStore({ sendableChannels }),
    templateRenderer: renderWebhookTemplate,
  });

  const res = await app.request("/webhook/missing-template/team/channel?token=secret", {
    method: "POST",
    body: JSON.stringify({ title: "Custom title", count: 3 }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.status, 200);
  assert.equal((await res.json()).template, "missing-template");
  assert.equal(deps.sent[0].activity.attachments[0].content.body[0].text, "Custom title");
  assert.deepEqual(deps.sent[0].activity.attachments[0].content.body[1].facts, [
    { title: "title", value: "Custom title" },
    { title: "count", value: "3" },
  ]);
});

test("webhook unknown channel returns 404", async () => {
  makeDeps();

  const res = await app.request("/webhook/raw/team/missing?token=secret", {
    method: "POST",
    body: JSON.stringify({ text: "hello" }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), {
    error: "channel not found",
    teamId: "team",
    channelId: "missing",
  });
});

test("webhook send failure returns 500 and records failed metric", async () => {
  const sendableChannels = new Map([["team:channel", makeSendableChannel()]]);
  const deps = makeDeps({ store: makeTestingStore({ sendableChannels }), sendFails: true });

  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const res = await app.request("/webhook/raw/team/channel?token=secret", {
      method: "POST",
      body: JSON.stringify({ text: "hello" }),
      headers: { "content-type": "application/json" },
    });

    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "message send failed" });
    assert.deepEqual(deps.metricEvents, [false]);
  } finally {
    console.error = originalConsoleError;
  }
});

test("internal webhooks index returns teams, channel status, and encoded urls", async () => {
  makeDeps({
    store: makeTestingStore({
      teams: [
        {
          tenantId: "tenant",
          teamId: "team/id",
          teamName: "Team",
          channels: [
            {
              channelId: "channel id",
              channelName: "Alerts",
              status: "archived",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    }),
  });

  const res = await internalApp.request("http://relay.example/webhooks?token=secret");

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    teams: [
      {
        tenantId: "tenant",
        teamId: "team/id",
        teamName: "Team",
        channels: [
          {
            channelId: "channel id",
            channelName: "Alerts",
            status: "archived",
            updatedAt: "2026-01-01T00:00:00.000Z",
            webhookUrl: "http://relay.example/webhook/raw/team%2Fid/channel%20id",
            templatedWebhookUrl: "http://relay.example/webhook/{template}/team%2Fid/channel%20id",
          },
        ],
      },
    ],
  });
});

test("internal webhook works without token when internal auth disabled", async () => {
  const sendableChannels = new Map([["team:channel", makeSendableChannel()]]);
  makeDeps({ store: makeTestingStore({ sendableChannels }) });

  const res = await internalApp.request("/webhook/raw/team/channel", {
    method: "POST",
    body: JSON.stringify({ text: "hello" }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.status, 200);
});
