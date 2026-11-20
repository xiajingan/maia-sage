// TC-SAGE-004. Chrome, real Vue/client, exclusively synthetic API and SDK responses.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
const outDir = await mkdtemp(join(tmpdir(), "sage-name-browser-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(outDir, "key"),
    "-out",
    join(outDir, "cert"),
    "-subj",
    "/CN=localhost",
    "-days",
    "1",
  ],
  { stdio: "ignore" },
);
const server = createServer(
  {
    key: await readFile(join(outDir, "key")),
    cert: await readFile(join(outDir, "cert")),
  },
  async (request, response) => {
    if (request.url === "/fixture.js" || request.url === "/fixture.css") {
      response.setHeader(
        "Content-Type",
        request.url.endsWith(".js") ? "text/javascript" : "text/css",
      );
      response.end(await readFile(join(outDir, request.url.slice(1))));
    } else if (request.url === "/prototype") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        await readFile(
          new URL("../docs/prototypes/contacts.html", import.meta.url),
        ),
      );
    } else {
      response.setHeader("Content-Type", "text/html");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' https://res.wx.qq.com/open/js/jweixin-1.2.0.js https://open.work.weixin.qq.com/wwopen/js/jwxwork-1.0.0.js; style-src 'self'; connect-src 'self' https://open.work.weixin.qq.com/wwopen/openData/getOpenData; frame-src https://open.work.weixin.qq.com/wwopen/openData/frame/index; img-src 'self' data: https://wwcdn.weixin.qq.com/node/wework/images/1x1-00000000.91e42db1c6.png; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      response.end(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div><script type="module" src="/fixture.js"></script></html>',
      );
    }
  },
);
let browser;
try {
  await build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: "tests/fixtures/name-browser.ts",
        formats: ["es"],
        fileName: "fixture",
        cssFileName: "fixture",
      },
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `https://localhost:${server.address().port}`;
  const path = "/workspaces/1/channel-app-instances/20/contacts";
  browser = await chromium.launch({
    executablePath:
      process.env.SAGE_CHROME ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [],
    bodies = [],
    phases = [];
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("console", (msg) => {
    if (
      msg.type() === "error" &&
      !msg.text().startsWith("Failed to load resource:")
    )
      errors.push("console-error");
  });
  let holdAuthorization = true;
  let cookieRequests = 0,
    boundConfigRequests = 0;
  let mode = "ready",
    queries = 0,
    creates = 0,
    sdkGate;
  const operation = () => ({
    operationId: "50",
    instanceId: "20",
    rowVersion: "1",
    phase: "awaiting_authorization",
    safeReason: null,
    nextAction: "authorize",
    authorizationUrl:
      "https://login.work.weixin.qq.com/wwlogin/sso/login?login_type=ServiceApp&state=synthetic",
    environment: "web",
    expiresAt: Date.now() + 300000,
  });
  const sync = {
    syncId: "40",
    instanceId: "20",
    rowVersion: "1",
    phase: "completed",
    coverage: "complete",
    safeReason: null,
    lastTrustedAt: 1800000000000,
    scopeVersion: "1",
  };
  const contact = {
    id: "30",
    sourceNamespace: "wecom.open_userid",
    sourceId: "synthetic-member",
    position: null,
    positionAvailability: "not_authorized",
    avatarUrl: null,
    avatarAvailability: "not_returned",
    lastTrustedAt: 1800000000000,
    state: "active",
    safeReason: null,
  };
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin === origin && !url.pathname.startsWith("/api/"))
      return route.continue();
    if (url.hostname === "res.wx.qq.com")
      return route.fulfill({
        contentType: "text/javascript; charset=utf-8",
        body: `window.__syntheticStages=[];window.wx={config(){window.__syntheticStages.push('config')},ready(cb){cb()},error(){},agentConfig(input){window.__syntheticStages.push('agentConfig');window.__syntheticCorp=input.corpid;input.success()}};`,
      });
    if (url.pathname === "/wwopen/js/jwxwork-1.0.0.js") {
      const browserSession = {
        corporation:
          mode === "bound-wrong-corp"
            ? "another-synthetic-corp"
            : "synthetic-corp",
        expiresAt: mode === "bound-expired" ? 1 : Date.now() + 60000,
      };
      if (mode === "sdk-error") return route.abort();
      if (sdkGate) await sdkGate;
      return route.fulfill({
        contentType: "text/javascript; charset=utf-8",
        body: `
          const browserSession = ${JSON.stringify(browserSession)};
          window.__syntheticEvents = {};
          window.WWOpenData = {
            checkSession(input) {
              window.__syntheticStages.push('checkSession');
              if (browserSession.corporation === window.__syntheticCorp && browserSession.expiresAt > Date.now()) input.success();
              else input.fail();
            },
            bind(el) {
              if (!el.isConnected) throw Error('unmounted');
              window.__syntheticStages.push('bind');
              const shadow = el.shadowRoot || el.attachShadow({mode: 'open'});
              shadow.textContent = el.getAttribute('openid') === 'synthetic-userid-b' ? '合成成员乙' : '合成成员甲';
            },
            on(event,cb){window.__syntheticEvents[event]=cb},
            off(event){delete window.__syntheticEvents[event]}
          };
          ${mode === "bound-missing" ? "delete window.WWOpenData.checkSession" : ""}
        `,
      });
    }
    if (
      url.hostname === "login.work.weixin.qq.com" &&
      url.pathname === "/wwlogin/sso/login"
    ) {
      if (holdAuthorization)
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<p>合成授权等待页；可关闭后从原页面继续。</p><a href="${origin}/wecom/name-context-result?operationId=50&amp;code=synthetic#synthetic">完成合成授权</a>`,
        });
      return route.fulfill({
        status: 302,
        headers: {
          location:
            origin +
            "/wecom/name-context-result?operationId=50&code=synthetic#synthetic",
        },
        body: "",
      });
    }
    assert.equal(
      url.origin,
      origin,
      "No real third-party network request is permitted",
    );
    assert.equal(request.headers().authorization, "Bearer synthetic-bearer");
    if (
      url.pathname.endsWith("/name-context-operations/50") ||
      url.pathname.endsWith("/complete") ||
      url.pathname.endsWith("/name-component-config")
    ) {
      assert.ok(
        request
          .headers()
          .cookie?.includes(
            "__Host-maia-name-browser=synthetic-browser-binding",
          ),
        "Same-origin name query/complete/config must carry the HttpOnly browser binding",
      );
      cookieRequests++;
    }
    let data;
    if (url.pathname.endsWith("/session"))
      data = {
        rootWorkspace: { id: "1", name: "合成个人空间" },
        user: { id: "2", loginName: "synthetic" },
        membership: { role: "manager" },
        accessContextVersion: "1",
      };
    else if (url.pathname.endsWith("/members"))
      data = { items: [], nextCursor: null };
    else if (url.pathname.endsWith("/contacts")) {
      assert.equal(request.headers()["x-maia-wecom-binding"], "1");
      if (mode === "forbidden")
        return route.fulfill({
          status: 403,
          json: {
            code: "FORBIDDEN",
            message: "合成拒绝",
            requestId: "synthetic",
            recovery: "请核对权限",
          },
        });
      data = {
        accessState: "active",
        safeReason: null,
        lastTrustedAt: 1800000000000,
        sync,
        ...(mode.startsWith("bound-") ? { currentUserWecomBound: true } : {}),
        items:
          mode === "empty"
            ? []
            : mode.startsWith("bound-")
              ? [contact, { ...contact, id: "31", sourceId: "synthetic-b" }]
              : [contact],
        nextCursor: null,
        scopeVersion: mode === "scope" ? "2" : "1",
      };
    } else if (url.pathname.endsWith("/name-context-operations")) {
      creates++;
      bodies.push(request.postDataJSON());
      data =
        mode === "configuration"
          ? {
              ...operation(),
              phase: "restricted",
              safeReason: "login_configuration_unavailable",
              nextAction: "check_configuration",
              authorizationUrl: null,
            }
          : operation();
    } else if (url.pathname.endsWith("/name-context-operations/50")) {
      queries++;
      data =
        mode === "wrong-corp"
          ? {
              ...operation(),
              phase: "restricted",
              safeReason: "wrong_corporation",
              nextAction: "recreate",
              authorizationUrl: null,
            }
          : { ...operation(), phase: "ready", nextAction: "complete" };
    } else if (url.pathname.endsWith("/complete"))
      data = {
        ...operation(),
        phase: "completed",
        nextAction: "use_component",
      };
    else if (
      url.pathname.endsWith("/name-component-config") ||
      url.pathname.endsWith("/bound-name-component-config")
    ) {
      const bound = url.pathname.endsWith("/bound-name-component-config");
      if (bound) {
        boundConfigRequests++;
        if (mode === "bound-denied")
          return route.fulfill({
            status: 403,
            json: {
              code: "FORBIDDEN",
              message: "合成拒绝",
              requestId: "synthetic",
              recovery: "请核对当前浏览器的企微企业",
            },
          });
        assert.deepEqual(request.postDataJSON(), {
          pageKey: "instance_contacts",
          limit: 20,
        });
      } else bodies.push(request.postDataJSON());
      data = {
        ...(bound ? { source: "installation_binding" } : { operationId: "50" }),
        instanceId: "20",
        pageKey: "instance_contacts",
        pageUrl: origin + path,
        environment: "web",
        scopeVersion: "1",
        expiresAt: Date.now() + (mode === "expires" ? 1200 : 60000),
        corpId: "synthetic-corp",
        agentId: "100",
        nonceStr: "synthetic",
        timestamp: Math.floor(Date.now() / 1000),
        corpSignature: "a".repeat(40),
        agentSignature: "b".repeat(40),
        references: [
          { contactId: "30", userId: "synthetic-userid", type: "userName" },
          ...(bound
            ? [
                {
                  contactId: "31",
                  userId: "synthetic-userid-b",
                  type: "userName",
                },
              ]
            : []),
        ],
        nextCursor: null,
      };
    } else throw Error("Unexpected synthetic endpoint");
    await route.fulfill({
      json: data,
      headers: url.pathname.endsWith("/name-context-operations")
        ? {
            "set-cookie":
              "__Host-maia-name-browser=synthetic-browser-binding; Secure; HttpOnly; SameSite=Lax; Path=/",
          }
        : {},
    });
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.addInitScript(() => {
    const open = globalThis.open;
    globalThis.__syntheticPopups = [];
    globalThis.open = function (...args) {
      const popup = open.apply(globalThis, args);
      globalThis.__syntheticPopups.push(popup);
      return popup;
    };
  });
  await page.goto(origin + path);
  await expect(button("授权姓名展示")).toBeVisible();
  sdkGate = new Promise((resolve) => {
    phases.push(resolve);
  });
  const popupPromise = context.waitForEvent("page");
  await button("授权姓名展示").click();
  const oldPopup = await popupPromise;
  await oldPopup.waitForURL(
    (url) => url.hostname === "login.work.weixin.qq.com",
  );
  await oldPopup.close();
  assert.equal(
    await page.evaluate(() => globalThis.__syntheticPopups[0].closed),
    true,
  );
  const reopened = context.waitForEvent("page", { timeout: 2000 });
  await button("打开姓名授权").click();
  const popup = await reopened;
  await popup.waitForURL((url) => url.hostname === "login.work.weixin.qq.com");
  assert.equal(creates, 1);
  assert.equal(
    await page.evaluate(() => globalThis.__syntheticPopups.length),
    2,
  );
  await page.evaluate(() => {
    globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", {
        origin: globalThis.location.origin,
        source: globalThis.__syntheticPopups[0],
        data: { operationId: "50" },
      }),
    );
    globalThis.dispatchEvent(
      new globalThis.MessageEvent("message", {
        origin: "https://wrong.example",
        source: globalThis.__syntheticPopups[1],
        data: { operationId: "50" },
      }),
    );
  });
  assert.equal(queries, 0);
  holdAuthorization = false;
  assert.equal(await popup.evaluate(() => Boolean(globalThis.opener)), true);
  await popup.getByRole("link", { name: "完成合成授权", exact: true }).click();
  await expect.poll(() => queries).toBe(1);
  await expect(page.locator("ww-open-data")).toHaveCount(0);
  phases.pop()();
  sdkGate = undefined;
  await expect(page.locator("ww-open-data")).toHaveCount(1);
  await expect(
    page.getByText("官方组件已绑定", { exact: false }),
  ).toBeVisible();
  assert.deepEqual(await page.evaluate(() => globalThis.__syntheticStages), [
    "agentConfig",
    "checkSession",
    "bind",
  ]);
  await expect(
    page.locator(
      'script[src="https://res.wx.qq.com/open/js/jweixin-1.2.0.js"]',
    ),
  ).toHaveAttribute("referrerpolicy", "origin");
  await expect(
    page.locator(
      'script[src="https://open.work.weixin.qq.com/wwopen/js/jwxwork-1.0.0.js"]',
    ),
  ).toHaveAttribute("referrerpolicy", "origin");
  assert.equal(new URL(popup.url()).search, "");
  assert.equal(new URL(popup.url()).hash, "");
  assert.ok(
    bodies.some(
      (body) => body.limit === 20 && body.pageKey === "instance_contacts",
    ),
  );
  const queryCount = queries;
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.postMessage(
          { operationId: "50" },
          globalThis.location.origin,
        );
        globalThis.setTimeout(resolve, 0);
      }),
  );
  await expect.poll(() => queries).toBe(queryCount);
  await mkdir("/tmp/maia-sage-t8-synthetic", { recursive: true });
  await page.screenshot({
    path: "/tmp/maia-sage-t8-synthetic/names-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "/tmp/maia-sage-t8-synthetic/names-mobile.png",
    fullPage: true,
  });
  await page.evaluate(() => globalThis.__syntheticEvents.error());
  await expect(page.locator("ww-open-data")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "同步已完成" })).toBeVisible();
  await button("核对原姓名授权").click();
  await expect(page.locator("ww-open-data")).toHaveCount(1);
  mode = "scope";
  await button("刷新联系人").click();
  await expect(page.locator("ww-open-data")).toHaveCount(0);
  mode = "forbidden";
  await button("刷新联系人").click();
  await expect(
    page.getByText("当前无权读取此实例", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("ww-open-data")).toHaveCount(0);
  for (const next of [
    "configuration",
    "wrong-corp",
    "expires",
    "sdk-error",
    "empty",
  ]) {
    mode = next;
    await page.goto(origin + path);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    if (next === "empty") {
      await expect(
        page.getByText("当前页暂无可展示的联系人", { exact: false }),
      ).toBeVisible();
      continue;
    }
    await button("授权姓名展示").click();
    if (next === "configuration") {
      await expect(
        page.getByText("普通浏览器姓名授权尚未配置", { exact: false }),
      ).toBeVisible();
      await expect(button("打开姓名授权")).toHaveCount(0);
    }
    if (next === "wrong-corp") {
      await expect(button("重新建立姓名上下文")).toBeVisible();
      await expect(page.locator("ww-open-data")).toHaveCount(0);
    }
    if (next === "sdk-error") {
      await expect(button("刷新页面恢复姓名展示")).toBeVisible();
      await expect(page.locator("ww-open-data")).toHaveCount(0);
    }
    if (next === "expires") {
      await expect(page.locator("ww-open-data")).toHaveCount(1);
      await expect(page.locator("ww-open-data")).toHaveCount(0);
    }
    await expect(
      page.getByRole("heading", { name: "同步已完成" }),
    ).toBeVisible();
  }
  // A fresh Maia page gets a binding only from the authenticated contact response.
  const manualCreates = creates,
    previousQueries = queries;
  for (const scenario of [
    "bound-active",
    "bound-expired",
    "bound-wrong-corp",
    "bound-missing",
    "bound-denied",
  ]) {
    mode = scenario;
    const fresh = await context.newPage();
    await fresh.goto(origin + path);
    await expect(
      fresh.getByText("当前 Maia 用户已绑定企微身份", { exact: true }),
    ).toBeVisible();
    if (scenario === "bound-active") {
      await expect(
        fresh.getByRole("cell", { name: "合成成员甲", exact: true }),
      ).toBeVisible();
      await expect(
        fresh.getByRole("cell", { name: "合成成员乙", exact: true }),
      ).toBeVisible();
      assert.deepEqual(
        await fresh.evaluate(() => globalThis.__syntheticStages),
        ["agentConfig", "checkSession", "bind", "bind"],
      );
    } else if (scenario === "bound-denied") {
      await expect(
        fresh.getByRole("button", { name: "授权姓名展示" }),
      ).toBeEnabled();
      await expect(fresh.getByText("请核对当前浏览器的企微企业")).toBeVisible();
      await expect(fresh.locator("ww-open-data")).toHaveCount(0);
    } else {
      await expect(
        fresh.getByText("当前浏览器的企微姓名展示会话未通过核验。", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(fresh.locator("ww-open-data")).toHaveCount(0);
    }
    assert.equal(creates, manualCreates);
    assert.equal(queries, previousQueries);
    await fresh.close();
  }
  // Restore a same-tab explicit operation through the normal authenticated API.
  // The stored reference alone is not evidence of a usable browser session.
  mode = "bound-active";
  const returning = await context.newPage();
  await returning.addInitScript(
    ({ path }) => {
      sessionStorage.setItem(
        "sage.wecom.name-return",
        JSON.stringify({
          operationId: "50",
          instanceId: "20",
          returnPath: path,
          expiresAt: Date.now() + 60000,
        }),
      );
    },
    { path },
  );
  await returning.goto(origin + path);
  await expect.poll(() => queries).toBe(previousQueries + 1);
  await expect(returning.locator("ww-open-data")).toHaveCount(1);
  assert.equal(creates, manualCreates);
  await returning.close();
  assert.equal(boundConfigRequests, 5);
  // Another browser context has no original Maia in-memory bearer or popup source.
  const isolated = await browser.newContext({ ignoreHTTPSErrors: true });
  const detached = await isolated.newPage();
  await detached.goto(origin + "/wecom/name-context-result?operationId=50");
  assert.equal(await detached.evaluate(() => sessionStorage.length), 0);
  await expect(detached.getByText("合成授权结果已通知原窗口")).toBeVisible();
  await isolated.close();
  await page.goto(origin + "/prototype");
  for (const state of [
    "ready",
    "empty",
    "loading",
    "error",
    "degraded",
    "name-bound",
    "name-loading",
    "name-error",
    "name-expired",
    "name-configuration",
    "name-reload",
  ]) {
    await page.getByLabel("预览状态").selectOption(state);
    await expect(
      page.getByRole("heading", { name: "内部联系人", exact: true }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  await page.screenshot({
    path: "/tmp/maia-sage-t8-synthetic/names-prototype.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: "passed",
      syntheticOnly: true,
      browser: "Chrome",
      creates,
      cookieRequests,
      boundConfigRequests,
      cases:
        "popup close/reopen/source replacement, source/origin, no-code result, init-before-mount, error/update, scope/revocation, wrong corporation, expiry, missing loginSuite, empty/mobile, isolated browser",
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(outDir, { recursive: true, force: true });
}
