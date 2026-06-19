import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_APP_ID = "test-app-id";
process.env.BOT_APP_PASSWORD = "test-password";
process.env.BOT_TENANT_ID = "test-tenant";
process.env.STORAGE_BACKEND = "dynamodb";
process.env.TEAMS_SEND_TARGET_RPS = "1000";

const waitUntil = async (predicate, timeoutMs = 1000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.fail("condition not met before timeout");
};

const assertUuid = (value) => {
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
};

let enqueueTeamsChannelSend;
let resetSendQueueForTesting;
let setTeamsChannelSenderForTesting;

beforeEach(async () => {
  const sendQueue = await import("../src/bot/sendQueue.ts");

  enqueueTeamsChannelSend = sendQueue.enqueueTeamsChannelSend;
  resetSendQueueForTesting = sendQueue.resetSendQueueForTesting;
  setTeamsChannelSenderForTesting = sendQueue.setTeamsChannelSenderForTesting;
  resetSendQueueForTesting();
});

test("enqueueTeamsChannelSend eventually delivers queued message", async () => {
  const delivered = [];
  const target = {
    teamId: "team",
    channelId: "channel",
    serviceUrl: "https://service.example",
  };
  const activity = { type: "message", text: "hello" };

  setTeamsChannelSenderForTesting(async (sentTarget, sentActivity) => {
    delivered.push({ target: sentTarget, activity: sentActivity });
    return { id: "sent-1" };
  });

  const queued = enqueueTeamsChannelSend(target, activity);

  assertUuid(queued.id);

  await waitUntil(() => delivered.length === 1);

  assert.deepEqual(delivered, [{ target, activity }]);
});

test("enqueueTeamsChannelSend delivers messages for two channels with per-channel FIFO order", async () => {
  const delivered = [];
  const channelOne = {
    teamId: "team",
    channelId: "channel-one",
    serviceUrl: "https://service.example",
  };
  const channelTwo = {
    teamId: "team",
    channelId: "channel-two",
    serviceUrl: "https://service.example",
  };
  const channelOneFirst = { type: "message", text: "channel-one-first" };
  const channelTwoFirst = { type: "message", text: "channel-two-first" };
  const channelOneSecond = { type: "message", text: "channel-one-second" };
  const channelTwoSecond = { type: "message", text: "channel-two-second" };

  setTeamsChannelSenderForTesting(async (target, activity) => {
    delivered.push({ target, activity });
    return { id: `sent-${delivered.length}` };
  });

  const queued = [
    enqueueTeamsChannelSend(channelOne, channelOneFirst),
    enqueueTeamsChannelSend(channelTwo, channelTwoFirst),
    enqueueTeamsChannelSend(channelOne, channelOneSecond),
    enqueueTeamsChannelSend(channelTwo, channelTwoSecond),
  ];

  for (const item of queued) {
    assertUuid(item.id);
  }
  assert.equal(new Set(queued.map((item) => item.id)).size, 4);

  await waitUntil(() => delivered.length === 4);

  const deliveredToChannelOne = delivered.filter(
    (item) => item.target.channelId === channelOne.channelId,
  );
  const deliveredToChannelTwo = delivered.filter(
    (item) => item.target.channelId === channelTwo.channelId,
  );

  assert.deepEqual(deliveredToChannelOne, [
    { target: channelOne, activity: channelOneFirst },
    { target: channelOne, activity: channelOneSecond },
  ]);
  assert.deepEqual(deliveredToChannelTwo, [
    { target: channelTwo, activity: channelTwoFirst },
    { target: channelTwo, activity: channelTwoSecond },
  ]);
});
