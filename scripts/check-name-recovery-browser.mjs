// TC-SAGE-004. Real main + oidc-client-ts + JWS in isolated HTTPS Chrome; all identity/API/SDK facts synthetic.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
const temp = await mkdtemp(join(tmpdir(), "sage-name-recovery-"));
let server, browser;
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(temp, "key"),
      "-out",
      join(temp, "cert"),
      "-subj",
      "/CN=localhost",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  await build({ build: { outDir: join(temp, "dist"), emptyOutDir: true } });
  server = createServer(
    {
      key: await readFile(join(temp, "key")),
      cert: await readFile(join(temp, "cert")),
    },
    async (req, res) => {
      const path = new URL(req.url, "https://localhost").pathname;
      const asset = path.startsWith("/assets/") ? path : "/index.html";
      res.setHeader(
        "Content-Type",
        asset.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : asset.endsWith(".css")
            ? "text/css"
            : "text/html; charset=utf-8",
      );
      res.end(await readFile(join(temp, "dist", asset)));
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `https://localhost:${server.address().port}`,
    issuer = origin + "/api/mud/auth",
    contactPath = "/workspaces/1/channel-app-instances/20/contacts";
  const keys = await generateKeyPair("RS256"),
    jwk = await exportJWK(keys.publicKey);
  browser = await chromium.launch({
    executablePath:
      process.env.SAGE_CHROME ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  let authorization,
    mode = "success",
    configReads = 0,
    claims = 0,
    exchanges = 0;
  const errors = [];
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.hostname === "res.wx.qq.com")
      return route.fulfill({
        contentType: "text/javascript",
        body: "window.syntheticStages=[];window.wx={config(){window.syntheticStages.push('config')},ready(cb){cb()},error(){},agentConfig(c){window.syntheticStages.push('agentConfig');c.success()}}",
      });
    if (url.hostname === "open.work.weixin.qq.com")
      return route.fulfill({
        contentType: "text/javascript",
        body: "window.WWOpenData={checkSession(c){window.syntheticStages.push('checkSession');c.success()},bind(){window.syntheticStages.push('bind')},on(){},off(){}}",
      });
    assert.equal(
      url.origin,
      origin,
      "No external identity/provider request allowed",
    );
    const path = url.pathname;
    if (path === "/runtime-config.json")
      return route.fulfill({
        json: {
          issuer,
          clientId: "sage",
          redirectUri: origin + "/auth/callback",
          apiBaseUrl: origin,
          version: "synthetic",
          wecomNamesEnabled: true,
        },
      });
    if (!path.startsWith("/api/")) return route.continue();
    if (path.endsWith("/.well-known/openid-configuration"))
      return route.fulfill({
        json: {
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
        },
      });
    if (path.endsWith("/authorize")) {
      authorization = url;
      return route.fulfill({
        contentType: "text/html",
        body: "<p>Synthetic issuer: no credential entry.</p>",
      });
    }
    if (path.endsWith("/jwks"))
      return route.fulfill({
        json: { keys: [{ ...jwk, alg: "RS256", kid: "synthetic" }] },
      });
    if (path.endsWith("/token")) {
      exchanges++;
      const input = new globalThis.URLSearchParams(request.postData());
      assert.equal(input.get("grant_type"), "authorization_code");
      assert.equal(
        createHash("sha256")
          .update(input.get("code_verifier"))
          .digest("base64url"),
        authorization.searchParams.get("code_challenge"),
      );
      const id = await new SignJWT({
        sub: "2",
        sid:
          mode === "sid-rejected"
            ? "synthetic-new-sid"
            : "synthetic-original-sid",
        nonce: authorization.searchParams.get("nonce"),
      })
        .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
        .setIssuer(issuer)
        .setAudience("sage")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey);
      return route.fulfill({
        json: {
          access_token: "synthetic-bearer",
          id_token: id,
          token_type: "Bearer",
          expires_in: 300,
        },
      });
    }
    assert.equal(request.headers().authorization, "Bearer synthetic-bearer");
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          rootWorkspace: { id: "1", name: "合成个人空间" },
          user: { id: "2", loginName: "synthetic" },
          membership: { role: "manager" },
          accessContextVersion: "1",
        },
      });
    if (path.endsWith("/members"))
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (path.endsWith("/contacts"))
      return route.fulfill({
        json: {
          accessState: "active",
          safeReason: null,
          lastTrustedAt: 1800000000000,
          sync: null,
          items: [
            {
              id: "30",
              sourceNamespace: "wecom.open_userid",
              sourceId: "synthetic",
              position: null,
              positionAvailability: "not_authorized",
              avatarUrl: null,
              avatarAvailability: "not_returned",
              lastTrustedAt: 1800000000000,
              state: "active",
              safeReason: null,
            },
          ],
          nextCursor: null,
          scopeVersion: "1",
        },
      });
    if (path.endsWith("/name-context-operations/50")) {
      claims++;
      if (mode === "sid-rejected")
        return route.fulfill({
          status: 403,
          json: {
            code: "FORBIDDEN",
            message: "合成原会话拒绝",
            requestId: "synthetic",
            recovery: "请核对原会话",
          },
        });
      return route.fulfill({
        json: {
          operationId: "50",
          instanceId: "20",
          rowVersion: "2",
          phase: "completed",
          safeReason: null,
          nextAction: "use_component",
          authorizationUrl: null,
          environment: "member",
          expiresAt: Date.now() + 300000,
        },
      });
    }
    if (path.endsWith("/name-component-config")) {
      configReads++;
      assert.deepEqual(request.postDataJSON(), {
        operationId: "50",
        pageKey: "instance_contacts",
        limit: 20,
      });
      return route.fulfill({
        json: {
          operationId: "50",
          instanceId: "20",
          pageKey: "instance_contacts",
          pageUrl: origin + contactPath,
          environment: "member",
          scopeVersion: "1",
          expiresAt: Date.now() + 60000,
          corpId: "synthetic-corp",
          agentId: "100",
          nonceStr: "synthetic",
          timestamp: Math.floor(Date.now() / 1000),
          corpSignature: "a".repeat(40),
          agentSignature: "b".repeat(40),
          nextCursor: null,
          references: [
            { contactId: "30", userId: "synthetic-userid", type: "userName" },
          ],
        },
      });
    }
    throw Error(
      "Unexpected request: cannot create new name context during recovery",
    );
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("console", (msg) => {
    if (
      msg.type() === "error" &&
      !msg.text().startsWith("Failed to load resource:")
    )
      errors.push("console-error");
  });
  await page.goto(origin);
  await page.evaluate(
    (path) =>
      sessionStorage.setItem(
        "sage.wecom.name-return",
        JSON.stringify({
          operationId: "50",
          instanceId: "20",
          returnPath: path,
          expiresAt: Date.now() + 240000,
        }),
      ),
    contactPath,
  );
  async function finish(error = false) {
    await page.waitForURL((url) => url.pathname.endsWith("/authorize"));
    assert.equal(authorization.searchParams.get("prompt"), "none");
    assert.equal(
      authorization.searchParams.get("code_challenge_method"),
      "S256",
    );
    assert.equal(authorization.searchParams.get("response_type"), "code");
    await page.goto(
      origin +
        "/auth/callback?" +
        (error ? "error=login_required" : "code=synthetic") +
        "&state=" +
        authorization.searchParams.get("state"),
    );
  }
  await page.goto(
    origin + "/wecom/name-context-result?operationId=50&code=ignored#ignored",
  );
  await finish();
  await expect(page.locator("ww-open-data")).toHaveCount(1);
  assert.equal(page.url(), origin + contactPath);
  assert.deepEqual(await page.evaluate(() => globalThis.syntheticStages), [
    "config",
    "agentConfig",
    "checkSession",
    "bind",
  ]);
  assert.equal(claims, 1);
  assert.equal(configReads, 1);
  assert.equal(
    await page.evaluate(() =>
      Object.values(sessionStorage).some(
        (v) => v.includes("synthetic-bearer") || v.includes("id_token"),
      ),
    ),
    false,
  );
  // Reload carries only the original operation; a changed trusted sid is rejected by synthetic Mud.
  assert.notEqual(
    await page.evaluate(() => sessionStorage.getItem("sage.wecom.name-return")),
    null,
  );
  mode = "sid-rejected";
  await page.reload();
  await finish();
  await expect(
    page.getByRole("button", { name: "先登录 Maia", exact: true }),
  ).toBeVisible();
  await expect(page.locator("ww-open-data")).toHaveCount(0);
  assert.equal(configReads, 1);
  assert.equal(claims, 2);
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("sage.wecom.name-return")),
    null,
  );
  // No issuer session: consume OIDC state, do not query the original operation.
  mode = "login-required";
  await page.evaluate(
    (path) =>
      sessionStorage.setItem(
        "sage.wecom.name-return",
        JSON.stringify({
          operationId: "50",
          instanceId: "20",
          returnPath: path,
          expiresAt: Date.now() + 60000,
        }),
      ),
    contactPath,
  );
  await page.reload();
  await finish(true);
  await expect(
    page.getByText("登录未完成，请重新登录。", { exact: true }),
  ).toBeVisible();
  assert.equal(claims, 2);
  assert.equal(exchanges, 2);
  assert.equal(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter(
          (k) => k.startsWith("sage.oidc.") || k === "sage.wecom.name-return",
        ).length,
    ),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: "passed",
      syntheticOnly: true,
      cases:
        "real main/PKCE/prompt=none/JWS/original-operation/member SDK sequence/reload/sid denial/login_required/state consumed",
    }),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
