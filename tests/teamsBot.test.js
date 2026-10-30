import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Activity } from "@microsoft/agents-activity";
import { ConnectorClient, TurnContext } from "@microsoft/agents-hosting";

process.env.BOT_APP_ID = "test-app-id";
process.env.BOT_APP_PASSWORD = "test-password";
process.env.BOT_TENANT_ID = "test-tenant";
process.env.STORAGE_BACKEND = "dynamodb";

test("install sync uses normalized Teams API URLs and stores channels", async () => {
  const { adapter } = await import("../src/bot/adapter.ts");
  const { agent } = await import("../src/bot/teamsBot.ts");
  const { storage } = await import("../src/storage/adapter.ts");
  const original = {
    upsertInstallation: storage.upsertInstallation,
    upsertChannel: storage.upsertChannel,
  };
  const installations = [];
  const channels = [];
  const paths = [];
  storage.upsertInstallation = async (record) => installations.push(record);
  storage.upsertChannel = async (record) => channels.push(record);

  const teamId = "19:team@thread.tacv2";
  const server = createServer((req, res) => {
    paths.push(req.url);
    res.setHeader("content-type", "application/json");
    if (req.url === `/amer/v3/teams/${teamId}`) {
      res.end(JSON.stringify({ id: teamId, name: "Team" }));
    } else if (req.url === `/amer/v3/teams/${teamId}/conversations`) {
      res.end(JSON.stringify({ conversations: [{ id: teamId, name: "General" }] }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const serviceUrl = `http://127.0.0.1:${server.address().port}/amer/`;
    const activity = Activity.fromObject({
      type: "conversationUpdate",
      id: "activity",
      channelId: "msteams",
      serviceUrl,
      conversation: { id: teamId, tenantId: "tenant" },
      channelData: { team: { id: teamId } },
      from: { id: "user" },
      recipient: { id: "bot" },
      membersAdded: [{ id: "bot" }],
    });
    const context = new TurnContext(adapter, activity, { aud: "test-app-id" });
    context.turnState.set(
      adapter.ConnectorClientKey,
      ConnectorClient.createClientWithToken(serviceUrl, "token"),
    );

    await agent.run(context);

    assert.deepEqual(paths, [`/amer/v3/teams/${teamId}`, `/amer/v3/teams/${teamId}/conversations`]);
    assert.equal(installations[0].serviceUrl, serviceUrl.slice(0, -1));
    assert.equal(installations[0].teamName, "Team");
    assert.equal(channels[0].channelId, teamId);
    assert.equal(channels[0].status, "active");
  } finally {
    storage.upsertInstallation = original.upsertInstallation;
    storage.upsertChannel = original.upsertChannel;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
