import { test, expect, vi } from "vitest";
import { businessReturnPath, createOidc } from "../src/auth/oidc";
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
// TC-SAGE-001 TC-SAGE-003
test("真实oidc-client-ts验证state/nonce，离页保留PKCE，回调清理且token不进入storage", async () => {
  const store = storage();
  let authorization = "";
  store.setItem("unrelated", "keep");
  vi.stubGlobal("sessionStorage", store);
  vi.stubGlobal("window", {
    location: {
      href:
        config.apiBaseUrl + "/workspaces/1/channel-app-instances/20/contacts",
      assign: (url: string) => {
        authorization = url;
      },
    },
  });
  const key = await generateKeyPair("RS256");
  const publicKey = await exportJWK(key.publicKey);
  let badNonce = false;
  let expiresIn: unknown = 300;
  let holdToken: Promise<void> | undefined;
  let exchanging = false;
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
        exchanging = true;
        if (holdToken) await holdToken;
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
          expires_in: expiresIn,
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
    expect(result.expiresAt).toBeGreaterThan(Date.now() + 290_000);
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(result.returnPath).toBe(
      "/workspaces/1/channel-app-instances/20/contacts",
    );
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
    badNonce = false;
    for (const [href, expected] of [
      [
        config.apiBaseUrl + "/workspaces/1/wecom/install-operations/10",
        "/workspaces/1/wecom/install-operations/10",
      ],
      [
        config.apiBaseUrl +
          "/workspaces/1/channel-app-instances/20/contacts?unsafe=synthetic",
        undefined,
      ],
      [
        "https://outside.example/workspaces/1/wecom/install-operations/10",
        undefined,
      ],
    ]) {
      Object.assign(globalThis.window.location, { href });
      await oidc.signIn(true);
      const currentState = new URL(authorization).searchParams.get("state")!;
      const protocol = JSON.parse(store.getItem("sage.oidc." + currentState)!);
      expect(protocol.data.returnPath).toBe(expected);
      expect(
        (
          await oidc.callback(
            config.redirectUri + "?code=synthetic&state=" + currentState,
          )
        ).returnPath,
      ).toBe(expected);
    }
    Object.assign(globalThis.window.location, {
      href:
        config.apiBaseUrl + "/workspaces/1/channel-app-instances/20/contacts",
    });
    for (const unsafe of [
      "https://outside.example/workspaces/1/wecom/install-operations/10",
      "//outside.example/workspaces/1/wecom/install-operations/10",
      "/workspaces/1/channel-app-instances/20/contacts?token=synthetic",
      "/workspaces/1/channel-app-instances/20/contacts#fragment",
      "/workspaces/0/wecom/install-operations/10",
      "/workspaces/9223372036854775808/wecom/install-operations/10",
      "/workspaces/1/wecom/install-operations/not-an-id",
      "/unrelated",
      { path: "/workspaces/1/wecom/install-operations/10" },
    ]) {
      await oidc.signIn(true);
      const currentState = new URL(authorization).searchParams.get("state")!;
      const key = "sage.oidc." + currentState;
      const protocol = JSON.parse(store.getItem(key)!);
      protocol.data = { returnPath: unsafe };
      store.setItem(key, JSON.stringify(protocol));
      const result = await oidc.callback(
        config.redirectUri + "?code=synthetic&state=" + currentState,
      );
      expect(result.returnPath).toBeUndefined();
      expect(store.length).toBe(1);
    }
    for (const invalid of [undefined, null, "invalid", 0, -1]) {
      expiresIn = invalid;
      await oidc.signIn(true, { sameSessionOnly: true });
      const invalidState = new URL(authorization).searchParams.get("state");
      await expect(
        oidc.callback(
          config.redirectUri + "?code=synthetic&state=" + invalidState,
        ),
      ).rejects.toThrow();
      expect(store.length).toBe(1);
    }
    expiresIn = 300;
    let release!: () => void;
    holdToken = new Promise((resolve) => {
      release = resolve;
    });
    exchanging = false;
    await oidc.signIn(true);
    const lastState = new URL(authorization).searchParams.get("state");
    const cancelled = oidc.callback(
      config.redirectUri + "?code=synthetic&state=" + lastState,
    );
    const rejection = expect(cancelled).rejects.toThrow("登录已取消");
    await vi.waitFor(() => expect(exchanging).toBe(true));
    oidc.clear();
    release();
    await rejection;
    expect(store.length).toBe(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

// TC-SAGE-004
test("same_window_prompt_none 使用显式无交互PKCE恢复，不持久Bearer", async () => {
  vi.stubGlobal("sessionStorage", storage());
  let authorization = "";
  vi.stubGlobal("window", {
    location: {
      href:
        config.apiBaseUrl + "/workspaces/1/channel-app-instances/20/contacts",
      assign: (url: string) => {
        authorization = url;
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        issuer,
        authorization_endpoint: issuer + "/auth",
        token_endpoint: issuer + "/token",
      }),
    ),
  );
  try {
    const oidc = createOidc(config);
    const navigation = oidc.signIn(true, { sameSessionOnly: true });
    // A synchronous App watcher can move home while the PKCE request is being built.
    Object.assign(window.location, { href: config.apiBaseUrl + "/" });
    await navigation;
    const url = new URL(authorization);
    expect(url.searchParams.get("prompt")).toBe("none");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    const state = url.searchParams.get("state");
    expect(
      JSON.parse(sessionStorage.getItem("sage.oidc." + state)!).data.returnPath,
    ).toBe("/workspaces/1/channel-app-instances/20/contacts");
    await expect(
      oidc.callback(
        config.redirectUri + "?error=login_required&state=" + state,
      ),
    ).rejects.toThrow();
    expect(sessionStorage.getItem("sage.oidc." + state)).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

// TC-SAGE-001 TC-SAGE-003
test.each([
  "/",
  "/terminals",
  "/workspaces/1/wecom",
  "/workspaces/1/wecom/install-operations/10",
  "/workspaces/1/channel-app-instances/20/contacts",
])("稳定返回路径%s按白名单接受", (path) => {
  expect(businessReturnPath(path, config.apiBaseUrl)).toBe(path);
});
test.each([
  "/workspaces/0/wecom",
  "/workspaces/9223372036854775808/wecom",
  "/terminals?code=secret",
  "/#secret",
  "/other",
  "https://outside.example/terminals",
])("拒绝返回路径%s", (path) => {
  expect(businessReturnPath(path, config.apiBaseUrl)).toBeUndefined();
});

test("无响应的OIDC发现请求十秒内取消，不导航或无限等待", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("sessionStorage", storage());
  const assign = vi.fn();
  vi.stubGlobal("window", {
    location: { href: config.apiBaseUrl + "/terminals", assign },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ),
  );
  try {
    let outcome = "pending";
    const navigation = createOidc(config)
      .signIn(true, { sameSessionOnly: true })
      .then(
        () => {
          outcome = "navigated";
        },
        () => {
          outcome = "failed";
        },
      );
    await vi.advanceTimersByTimeAsync(10_100);
    expect(outcome).toBe("failed");
    expect(assign).not.toHaveBeenCalled();
    await navigation;
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
