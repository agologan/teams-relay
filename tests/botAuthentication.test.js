import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import https from "node:https";
import { Readable } from "node:stream";

process.env.BOT_APP_ID = "test-app-id";
process.env.BOT_APP_PASSWORD = "test-password";
process.env.BOT_TENANT_ID = "test-tenant";
process.env.STORAGE_BACKEND = "dynamodb";
process.env.WEBHOOK_TOKENS = "secret";

test("SDK signature verification runs before processing", async () => {
  const { adapter } = await import("../src/bot/adapter.ts");
  const { createPublicServer } = await import("../src/server/botEndpoint.ts");
  const { app } = await import("../src/server.ts");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "test-key",
    use: "sig",
    alg: "RS256",
  };
  const serviceUrl = "https://smba.trafficmanager.net/amer/";
  const makeToken = (key) => {
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://api.botframework.com",
        aud: "test-app-id",
        serviceurl: serviceUrl,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");
    const input = `${header}.${payload}`;
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
  };
  const original = {
    request: https.request,
    process: adapter.process,
  };
  let processed = 0;
  https.request = (options, callback) => {
    assert.equal(options.hostname, "login.botframework.com");
    assert.equal(options.path, "/v1/.well-known/keys");
    const request = new EventEmitter();
    request.end = () => {
      const response = Readable.from([JSON.stringify({ keys: [jwk] })]);
      response.statusCode = 200;
      queueMicrotask(() => callback(response));
      return request;
    };
    request.destroy = () => request;
    return request;
  };
  adapter.process = async (req, res) => {
    processed++;
    assert.equal(req.user.iss, "https://api.botframework.com");
    assert.equal(req.body.serviceUrl, serviceUrl);
    res.status(200).end();
  };
  const server = createPublicServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = (jwt) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, connection: "close" },
      body: JSON.stringify({ channelId: "msteams", serviceUrl }),
    });

  try {
    assert.equal((await request(makeToken(privateKey))).status, 200);
    assert.equal((await request(makeToken(otherKey))).status, 401);
    assert.equal(processed, 1);
  } finally {
    https.request = original.request;
    adapter.process = original.process;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
