import { test, expect } from "vitest";
import { parseRuntimeConfig } from "../src/config";
import { verifyIdentity } from "../src/auth/oidc";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
const origin = "https://localhost:15443";
const config = {
  issuer: origin + "/api/mud/auth",
  clientId: "sage",
  redirectUri: origin + "/auth/callback",
  apiBaseUrl: origin,
  version: "0.1.0",
} as const;
// TC-SAGE-001
test("公共配置拒绝跨源、缺字段与秘密字段", () => {
  expect(parseRuntimeConfig(config, origin)).toEqual(config);
  for (const bad of [
    { ...config, issuer: "https://evil.test" },
    { ...config, version: undefined },
    { ...config, password: "secret" },
  ])
    expect(() => parseRuntimeConfig(bad, origin)).toThrow();
});
// TC-SAGE-001
test("实际JWS验签并拒绝错误nonce/issuer/audience/过期/缺sid/篡改", async () => {
  const key = await generateKeyPair("RS256");
  const jwk = await exportJWK(key.publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "one" }] });
  const claims = { sub: "2", sid: "session", nonce: "nonce" };
  const mint = (
    values: Record<string, unknown>,
    iss = config.issuer,
    aud = "sage",
    exp = Math.floor(Date.now() / 1000) + 60,
  ) =>
    new SignJWT(values)
      .setProtectedHeader({ alg: "RS256", kid: "one" })
      .setIssuer(iss)
      .setAudience(aud)
      .setExpirationTime(exp)
      .sign(key.privateKey);
  const good = await mint(claims);
  expect(await verifyIdentity(good, config, "nonce", keys)).toBe("2");
  for (const bad of [
    await mint({ ...claims, nonce: "wrong" }),
    await mint(claims, "evil"),
    await mint(claims, config.issuer, "other"),
    await mint(claims, config.issuer, "sage", 1),
    await mint({ sub: "2", nonce: "nonce" }),
    good.slice(0, -12) + "AAAAAAAAAAAA",
  ])
    await expect(verifyIdentity(bad, config, "nonce", keys)).rejects.toThrow();
});
