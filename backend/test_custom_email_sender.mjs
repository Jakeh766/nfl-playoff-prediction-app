import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMessage,
  createHandler,
} from "./custom-email-sender/index.mjs";

test("builds confirmation and password reset messages", () => {
  const confirmation = buildMessage("CustomEmailSender_SignUp", "123456");
  const reset = buildMessage("CustomEmailSender_ForgotPassword", "654321");

  assert.match(confirmation.subject, /Confirm/);
  assert.match(confirmation.text, /123456/);
  assert.match(reset.subject, /Reset/);
  assert.match(reset.text, /654321/);
});

test("escapes a temporary password in HTML", () => {
  const message = buildMessage(
    "CustomEmailSender_AdminCreateUser",
    "Temp<pass>&word",
  );

  assert.match(message.html, /Temp&lt;pass&gt;&amp;word/);
  assert.doesNotMatch(message.html, /Temp<pass>/);
  assert.match(message.text, /Temp<pass>&word/);
});

test("delivers a decrypted Cognito code through Resend", async () => {
  const deliveries = [];
  const handler = createHandler({
    decrypt: async () => "123456",
    loadApiKey: async () => "re_test",
    deliver: async (delivery) => {
      deliveries.push(delivery);
      return "email-id";
    },
    from: "Predict Playoffs <no-reply@predictplayoffs.com>",
  });

  await handler({
    triggerSource: "CustomEmailSender_SignUp",
    request: {
      type: "customEmailSenderRequestV1",
      code: "encrypted-value",
      userAttributes: { email: "player@example.com" },
    },
  });

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to, "player@example.com");
  assert.equal(deliveries[0].apiKey, "re_test");
  assert.match(deliveries[0].message.text, /123456/);
  assert.match(deliveries[0].idempotencyKey, /^cognito-[a-f0-9]{40}$/);
});

test("rejects unknown event versions before delivery", async () => {
  const handler = createHandler({ from: "no-reply@predictplayoffs.com" });

  await assert.rejects(
    handler({ request: { type: "futureVersion" } }),
    /Unsupported Cognito custom email sender request version/,
  );
});
