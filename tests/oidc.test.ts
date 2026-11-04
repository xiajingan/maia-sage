import { test, expect, vi } from "vitest";
import { createOidc } from "../src/auth/oidc";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
const issuer = "https://localhost:15443/api/mud/auth";
const config = {
  issuer,
  clientId: "sage",
  redirectUri: "https://localhost:15443/auth/callback",
  apiBaseUrl: "https://localhost:15443",
  version: "1",
} as const;
function storage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}
// TC-SAGE-001
test("真实oidc-client-ts验证state/nonce，离页保留PKCE，回调清理且token不进入storage", async () => {
  const store = storage();
  let authorization = "";
  store.setItem("unrelated", "keep");
  vi.stubGlobal("sessionStorage", store);
  vi.stubGlobal("window", {
    location: {
      assign: (url: string) => {
        authorization = url;
      },
    },
  });
  const key = await generateKeyPair("RS256");
  const publicKey = await exportJWK(key.publicKey);
  let badNonce = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("openid-configuration"))
        return Response.json({
          issuer,
          authorization_endpoint: issuer + "/auth",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
        });
      if (url.endsWith("/jwks"))
        return Response.json({
          keys: [{ ...publicKey, alg: "RS256", kid: "1" }],
        });
      if (url.endsWith("/token")) {
        const nonce = new URL(authorization).searchParams.get("nonce");
        const id = await new SignJWT({
          sub: "2",
          sid: "sid",
          nonce: badNonce ? "wrong" : nonce,
        })
          .setProtectedHeader({ alg: "RS256", kid: "1" })
          .setIssuer(issuer)
          .setAudience("sage")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(key.privateKey);
        return Response.json({
          access_token: "access",
          id_token: id,
          token_type: "Bearer",
          expires_in: 300,
        });
      }
      throw new Error("Unexpected endpoint");
    }),
  );
  try {
    const oidc = createOidc(config);
    await oidc.signIn();
    expect(new URL(authorization).searchParams.get("prompt")).toBe("login");
    expect(
      new URL(authorization).searchParams.get("code_challenge_method"),
    ).toBe("S256");
    const state = new URL(authorization).searchParams.get("state");
    oidc.clear(true);
    expect(store.length).toBe(2);
    await expect(
      oidc.callback(config.redirectUri + "?code=code&state=wrong"),
    ).rejects.toThrow();
    const result = await oidc.callback(
      config.redirectUri + "?code=code&state=" + state,
    );
    expect(result.subject).toBe("2");
    expect(store.length).toBe(1);
    expect(store.getItem("unrelated")).toBe("keep");
    await oidc.signIn(true);
    expect(new URL(authorization).searchParams.has("prompt")).toBe(false);
    badNonce = true;
    const second = new URL(authorization).searchParams.get("state");
    await expect(
      oidc.callback(config.redirectUri + "?code=code&state=" + second),
    ).rejects.toThrow();
    expect(store.length).toBe(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
