import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type EncryptedTokenPayload = {
  alg: "aes-256-gcm";
  ciphertext: string;
  iv: string;
  tag: string;
};

function getEncryptionKey() {
  const secret = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim();

  if (!secret) {
    return null;
  }

  return createHash("sha256").update(secret).digest();
}

export function hasIntegrationTokenEncryptionKey() {
  return Boolean(getEncryptionKey());
}

export function encryptIntegrationTokenSet(value: Record<string, unknown>): EncryptedTokenPayload {
  const key = getEncryptionKey();

  if (!key) {
    throw new Error("Missing INTEGRATION_TOKEN_ENCRYPTION_KEY.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(value);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    alg: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url")
  };
}

export function decryptIntegrationTokenSet<T = Record<string, unknown>>(
  value: EncryptedTokenPayload
): T {
  const key = getEncryptionKey();

  if (!key) {
    throw new Error("Missing INTEGRATION_TOKEN_ENCRYPTION_KEY.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");

  return JSON.parse(plaintext) as T;
}
