import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from "@/lib/crypto";

describe("token encryption at rest", () => {
  it("round-trips secrets", () => {
    const secret = "spotify-refresh-token-abc123";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces distinct ciphertexts per encryption (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered payloads", () => {
    const encrypted = encryptSecret("secret");
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("hashes and verifies passwords without storing them", () => {
    const hash = hashPassword("correct horse battery");
    expect(hash).not.toContain("correct horse battery");
    expect(verifyPassword("correct horse battery", hash)).toBe(true);
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });
});
