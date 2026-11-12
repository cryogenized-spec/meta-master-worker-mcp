import { describe, expect, it } from "vitest";
import { encryptMetaToken, decryptMetaToken, type TokenContext } from "../src/storage/token-crypto";

const owner: TokenContext = {
  operatorId: "operator-fixture",
  connectionId: "connection-fixture",
  platform: "facebook",
};

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("encrypted Meta token vault", () => {
  it("round trips with random IVs and hides the raw token", async () => {
    const secret = newKey();
    const raw = "test-token-NOT-A-REAL-CREDENTIAL";
    const first = await encryptMetaToken(raw, secret, owner);
    const second = await encryptMetaToken(raw, secret, owner);
    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(raw);
    expect(await decryptMetaToken(first, secret, owner)).toBe(raw);
  });

  it("cannot copy encrypted credentials between operators or connections", async () => {
    const key = newKey();
    const envelope = await encryptMetaToken("dummy-credential", key, owner);
    await expect(decryptMetaToken(envelope, key, { ...owner, operatorId: "different" }))
      .rejects.toThrow("token_decryption_failed");
    await expect(decryptMetaToken(envelope, key, { ...owner, connectionId: "different" }))
      .rejects.toThrow("token_decryption_failed");
    await expect(decryptMetaToken(envelope, newKey(), owner))
      .rejects.toThrow("token_decryption_failed");
  });

  it("rejects missing keys, malformed ciphertext, and tampering", async () => {
    const key = newKey();
    await expect(encryptMetaToken("dummy", "", owner)).rejects.toThrow("missing_encryption_key");
    await expect(encryptMetaToken("", key, owner)).rejects.toThrow("empty_token");
    await expect(decryptMetaToken("v1.bad", key, owner)).rejects.toThrow("invalid_token_envelope");
    const encrypted = await encryptMetaToken("dummy", key, owner);
    const pieces = encrypted.split(".");
    pieces[2] = pieces[2].slice(0, -1) + (pieces[2].endsWith("a") ? "b" : "a");
    await expect(decryptMetaToken(pieces.join("."), key, owner))
      .rejects.toThrow("token_decryption_failed");
  });
});
