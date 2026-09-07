import { createHash } from "node:crypto";
import {
  buildClient,
  CommitmentPolicy,
  KmsKeyringNode,
} from "@aws-crypto/client-node";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const resendApiKeySecretArn = process.env.RESEND_API_KEY_SECRET_ARN;
const kmsKeyId = process.env.KMS_KEY_ID;
const kmsKeyArn = process.env.KMS_KEY_ARN;

const encryptionClient = buildClient(
  CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT,
);
const keyring =
  kmsKeyId && kmsKeyArn
    ? new KmsKeyringNode({ generatorKeyId: kmsKeyId, keyIds: [kmsKeyArn] })
    : null;
const secretsManager = new SecretsManagerClient({});

let cachedApiKey;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function unescapeCognitoSecret(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

function maskEmail(email) {
  const [localPart, domain = ""] = String(email).split("@", 2);
  const visible = localPart.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(3, localPart.length - 1))}@${domain}`;
}

function codeMessage(subject, intro, code, label = "Verification code") {
  if (!code) throw new Error("Cognito did not provide an encrypted email code");
  const safeCode = escapeHtml(code);

  return {
    subject,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f3f4f6;color:#172033;font-family:Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:40px 20px">
      <div style="background:#ffffff;border:1px solid #dfe3ea;border-radius:16px;padding:32px">
        <p style="margin:0 0 8px;color:#2457c5;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Predict Playoffs</p>
        <h1 style="margin:0 0 16px;font-size:25px;line-height:1.25">${escapeHtml(subject)}</h1>
        <p style="margin:0 0 24px;line-height:1.6">${escapeHtml(intro)}</p>
        <p style="margin:0 0 8px;color:#5f6878;font-size:13px;font-weight:700;text-transform:uppercase">${escapeHtml(label)}</p>
        <p style="margin:0 0 24px;font-family:Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:.12em">${safeCode}</p>
        <p style="margin:0;color:#5f6878;font-size:13px;line-height:1.5">If you did not request this message, you can safely ignore it.</p>
      </div>
    </div>
  </body>
</html>`,
    text: `Predict Playoffs\n\n${subject}\n\n${intro}\n\n${label}: ${code}\n\nIf you did not request this message, you can safely ignore it.`,
  };
}

export function buildMessage(triggerSource, code) {
  switch (triggerSource) {
    case "CustomEmailSender_SignUp":
    case "CustomEmailSender_ResendCode":
      return codeMessage(
        "Confirm your account",
        "Enter this code in Predict Playoffs to confirm your email address.",
        code,
      );
    case "CustomEmailSender_ForgotPassword":
      return codeMessage(
        "Reset your password",
        "Enter this code in Predict Playoffs to choose a new password.",
        code,
        "Password reset code",
      );
    case "CustomEmailSender_UpdateUserAttribute":
    case "CustomEmailSender_VerifyUserAttribute":
      return codeMessage(
        "Verify your email address",
        "Enter this code in Predict Playoffs to verify your email address.",
        code,
      );
    case "CustomEmailSender_Authentication":
      return codeMessage(
        "Your sign-in code",
        "Enter this one-time code in Predict Playoffs to finish signing in.",
        code,
        "Sign-in code",
      );
    case "CustomEmailSender_AdminCreateUser":
      return codeMessage(
        "Your temporary password",
        "Use this temporary password to sign in to Predict Playoffs, then choose a new password.",
        code,
        "Temporary password",
      );
    case "CustomEmailSender_AccountTakeOverNotification":
      return {
        subject: "Security alert for your account",
        html: `<!doctype html><html lang="en"><body><h1>Predict Playoffs security alert</h1><p>Amazon Cognito detected suspicious sign-in activity on your account.</p><p>If this was not you, reset your password immediately.</p></body></html>`,
        text: "Predict Playoffs security alert\n\nAmazon Cognito detected suspicious sign-in activity on your account. If this was not you, reset your password immediately.",
      };
    default:
      throw new Error(`Unsupported Cognito trigger source: ${triggerSource}`);
  }
}

async function decryptCode(encryptedCode) {
  if (!encryptedCode) return undefined;
  if (!keyring) throw new Error("KMS key configuration is missing");

  const { plaintext } = await encryptionClient.decrypt(
    keyring,
    Buffer.from(encryptedCode, "base64"),
  );
  return unescapeCognitoSecret(Buffer.from(plaintext).toString("utf8"));
}

async function getResendApiKey() {
  if (cachedApiKey) return cachedApiKey;
  if (!resendApiKeySecretArn) {
    throw new Error("Resend API key secret configuration is missing");
  }

  const response = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: resendApiKeySecretArn }),
  );
  if (!response.SecretString) {
    throw new Error("The Resend API key secret has no string value");
  }

  let apiKey = response.SecretString;
  if (apiKey.trim().startsWith("{")) {
    const parsed = JSON.parse(apiKey);
    apiKey = parsed.apiKey;
  }
  if (typeof apiKey !== "string" || !apiKey.startsWith("re_")) {
    throw new Error("The Resend API key secret is invalid");
  }

  cachedApiKey = apiKey;
  return cachedApiKey;
}

async function sendResendEmail({ apiKey, from, to, message, idempotencyKey }) {
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "User-Agent": "predict-playoffs-cognito-sender/1.0",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the email with HTTP ${response.status}`);
  }

  const body = await response.json();
  if (!body.id) throw new Error("Resend accepted the request without a message ID");
  return body.id;
}

export function createHandler({
  decrypt = decryptCode,
  loadApiKey = getResendApiKey,
  deliver = sendResendEmail,
  from = process.env.EMAIL_FROM,
} = {}) {
  return async function customEmailSender(event) {
    if (event?.request?.type !== "customEmailSenderRequestV1") {
      throw new Error("Unsupported Cognito custom email sender request version");
    }

    const email = event.request.userAttributes?.email;
    if (!email || !from) throw new Error("Email sender or recipient is missing");

    const code = await decrypt(event.request.code);
    const message = buildMessage(event.triggerSource, code);
    const apiKey = await loadApiKey();
    const requestFingerprint = createHash("sha256")
      .update(`${event.triggerSource}:${email}:${event.request.code ?? "notification"}`)
      .digest("hex")
      .slice(0, 40);

    const messageId = await deliver({
      apiKey,
      from,
      to: email,
      message,
      idempotencyKey: `cognito-${requestFingerprint}`,
    });
    console.log(
      JSON.stringify({
        type: "cognito_email",
        triggerSource: event.triggerSource,
        recipient: maskEmail(email),
        messageId,
      }),
    );
  };
}

export const handler = createHandler();
