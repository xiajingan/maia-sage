// TC-SAGE-001 — 真实Mud主路径；route仅用于显式标注的UI故障场景。
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.SAGE_BROWSER_ORIGIN ?? "https://localhost:15443";
const output = process.env.SAGE_SCREENSHOTS ?? "/tmp/maia-sage-ui";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.SAGE_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", () => errors.push("uncaught-page-error"));
page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().startsWith("Failed to load resource:")
  )
    errors.push("console-error");
});
let access;
const prompts = [];
page.on("request", (request) => {
  const url = new URL(request.url());
  if (
    url.pathname.endsWith("/v1/session") &&
    request.headers()["authorization"]
  )
    access = request.headers()["authorization"];
  if (url.pathname === new URL(origin).pathname + "api/mud/auth/auth")
    prompts.push(url.searchParams.get("prompt"));
});
const name = "sage_ui_" + Date.now();
const password = crypto.randomUUID() + "aB7";
const screenshot = (label) =>
  page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
const statusError = (status) => ({
  code:
    status === 403
      ? "FORBIDDEN"
      : status === 401
        ? "UNAUTHENTICATED"
        : "UNAVAILABLE",
  message: "暂时无法读取",
  requestId: "ui-safe-request",
  recovery: "稍后重试",
});
const members = "**/api/mud/v1/workspaces/*/members?*";
const session = "**/api/mud/v1/session";
async function login(button = "登录或注册") {
  await page.getByRole("button", { name: button, exact: true }).click();
  await page.getByLabel("账号名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "空间成员", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "管理者", exact: true }),
  ).toBeVisible();
}
try {
  await page.goto(origin);
  await expect(
    page.getByText("登录未完成，请重新登录。", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(prompts, ["none"]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "登录或注册", exact: true }),
  ).toBeVisible();
  assert.deepEqual(prompts, ["none"]);
  await screenshot("signed-out");
  const discovery = await page.evaluate(
    async () =>
      await (
        await fetch("/api/mud/auth/.well-known/openid-configuration")
      ).json(),
  );
  for (const field of [
    "issuer",
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
  ])
    assert.equal(new URL(discovery[field]).origin, origin);
  await page.getByRole("button", { name: "登录或注册" }).click();
  await page.getByLabel("账号名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("注册成功，请输入密码登录");
  assert.equal(
    await page
      .getByLabel("密码", { exact: true })
      .evaluate((input) => input.value.length),
    0,
  );
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "管理者", exact: true }),
  ).toBeVisible();
  assert(new URL(page.url()).search === "");
  await screenshot("ready");
  const before = await page.evaluate(
    async () => await (await fetch("/api/mud/v1/session")).status,
  );
  assert.equal(before, 401); // 真实服务拒绝无令牌请求。
  const store = await page.evaluate(() => ({
    local: localStorage.length,
    session: Object.keys(sessionStorage),
  }));
  assert.equal(store.local, 0);
  assert.equal(store.session.length, 0);
  const facts = await page.evaluate(
    async (auth) =>
      await (
        await fetch("/api/mud/v1/session", { headers: { Authorization: auth } })
      ).json(),
    access,
  );
  await page.reload();
  await expect(
    page.getByRole("cell", { name: "管理者", exact: true }),
  ).toBeVisible();
  assert.equal(prompts.at(-1), "none");
  const reopened = await context.newPage();
  await reopened.goto(origin + "/terminals");
  await expect(
    reopened.getByRole("heading", { name: "终端", exact: true }),
  ).toBeVisible();
  assert.equal(new URL(reopened.url()).pathname, "/terminals");
  await reopened.close();
  // UI expiry injection: retain the real token/JWS, shorten only client expiry metadata.
  // Real 300-second bearer expiry is a separate integration check, not claimed here.
  let expiresSoonAt;
  await page.route(
    "**/api/mud/auth/token",
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      expiresSoonAt = Date.now() + 2500;
      await route.fulfill({ response, json: { ...body, expires_in: 7 } });
    },
    { times: 1 },
  );
  await page.reload();
  await expect(
    page.getByRole("cell", { name: "管理者", exact: true }),
  ).toBeVisible();
  await expect.poll(() => Date.now() >= expiresSoonAt).toBe(true);
  const beforeExpiry = prompts.length;
  await page.getByRole("button", { name: "刷新成员" }).click();
  await expect.poll(() => prompts.length).toBe(beforeExpiry + 1);
  await expect(
    page.getByRole("cell", { name: "管理者", exact: true }),
  ).toBeVisible();
  assert.equal(prompts.at(-1), "none");
  // 明确的浏览器UI故障注入：不计为真实后端验收。
  let release;
  const hold = new Promise((r) => {
    release = r;
  });
  await page.route(members, async (route) => {
    await hold;
    await route.continue();
  });
  await page.getByRole("button", { name: "刷新成员" }).click();
  await expect(page.getByRole("status")).toContainText("正在确认");
  await screenshot("loading");
  release();
  await expect(
    page.getByRole("cell", { name: "管理者", exact: true }),
  ).toBeVisible();
  await page.unroute(members);
  await page.route(members, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.getByRole("button", { name: "刷新成员" }).click();
  await expect(
    page.getByRole("heading", { name: "暂未读取到成员" }),
  ).toBeVisible();
  await screenshot("empty");
  await page.unroute(members);
  await page.route(members, (route) =>
    route.fulfill({ status: 503, json: statusError(503) }),
  );
  await page.getByRole("button", { name: "刷新成员" }).click();
  await expect(page.getByRole("status")).toContainText("成员信息暂时不可用");
  await screenshot("degraded");
  await page.unroute(members);
  await page.route(session, (route) =>
    route.fulfill({ status: 503, json: statusError(503) }),
  );
  await page.getByRole("button", { name: "重新读取成员" }).click();
  await expect(
    page.getByRole("heading", { name: "暂时无法进入工作空间" }),
  ).toBeVisible();
  await screenshot("error");
  await page.unroute(session);
  await expect(
    page.getByRole("button", { name: "退出登录", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "你的个人工作空间" }),
  ).toBeVisible();
  await login();
  await expect(
    page.getByRole("cell", { name: "管理者", exact: true }),
  ).toBeVisible();
  await page.route(session, (route) =>
    route.fulfill({
      json: {
        ...facts,
        rootWorkspace: {
          ...facts.rootWorkspace,
          name: "很长的个人工作空间名称用于检查小屏与长文本的安全换行".repeat(
            4,
          ),
        },
      },
    }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "刷新成员" }).click();
  await expect(
    page.getByRole("cell", { name: "管理者", exact: true }),
  ).toBeVisible();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await screenshot("mobile-long");
  await page.unroute(session);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route(session, (route) =>
    route.fulfill({ status: 403, json: statusError(403) }),
  );
  await page.getByRole("button", { name: "刷新成员" }).click();
  await expect(
    page.getByRole("heading", { name: "无法访问此工作空间" }),
  ).toBeVisible();
  await screenshot("forbidden");
  await page.unroute(session);
  await login("使用其他账号登录");
  // 真实退出撤销 + 同账号再次登录复用。
  const old = access;
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("heading", { name: "你的个人工作空间" }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      async (auth) =>
        (
          await fetch("/api/mud/v1/session", {
            headers: { Authorization: auth },
          })
        ).status,
      old,
    ),
    401,
  );
  await login();
  const after = await page.evaluate(
    async (auth) =>
      await (
        await fetch("/api/mud/v1/session", { headers: { Authorization: auth } })
      ).json(),
    access,
  );
  assert.equal(after.rootWorkspace.id, facts.rootWorkspace.id);
  assert.equal(after.user.id, facts.user.id);
  let original;
  await page.route("**/api/mud/auth/logout", async (route) => {
    original = JSON.parse(route.request().postData());
    // Leave the request unhandled: simulate a connection that never settles.
  });
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "本机已退出" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新登录", exact: true }),
  ).toBeVisible();
  await screenshot("logout-pending");
  await expect(page.getByRole("button", { name: "重试核实退出" })).toBeVisible({
    timeout: 15000,
  });
  await screenshot("logout-unknown");
  const afterUnknown = await context.newPage();
  let unwantedRestore = 0;
  afterUnknown.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/auth/auth"))
      unwantedRestore++;
  });
  await afterUnknown.goto(origin);
  await expect(
    afterUnknown.getByRole("button", { name: "登录或注册", exact: true }),
  ).toBeVisible();
  assert.equal(unwantedRestore, 0);
  await afterUnknown.close();
  await page.unroute("**/api/mud/auth/logout");
  const checkRetry = (r) => {
    if (new URL(r.url()).pathname.endsWith("/auth/logout"))
      assert(
        JSON.parse(r.postData()).idTokenHint === original.idTokenHint &&
          JSON.parse(r.postData()).logoutRequestId === original.logoutRequestId,
      );
  };
  page.on("request", checkRetry);
  await page.getByRole("button", { name: "重试核实退出" }).click();
  await expect(
    page.getByRole("heading", { name: "你的个人工作空间" }),
  ).toBeVisible();
  page.off("request", checkRetry);
  await login();
  await page.route("**/api/mud/auth/logout", () => {});
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("status")).toContainText("正在核实原会话已撤销");
  await login("重新登录");
  await page.unroute("**/api/mud/auth/logout");
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("heading", { name: "你的个人工作空间" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "跳到主要内容" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const invalid = await context.newPage();
  await invalid.route("**/runtime-config.json", (route) =>
    route.fulfill({ json: { issuer: "https://evil.test" } }),
  );
  await invalid.goto(
    origin + "/auth/callback?code=invalid-check&state=invalid-check",
  );
  await expect(
    invalid.getByRole("heading", { name: "暂时无法打开 Maia" }),
  ).toBeVisible();
  await invalid.screenshot({
    path: output + "/invalid-config.png",
    fullPage: true,
  });
  assert(new URL(invalid.url()).search === "");
  await invalid.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: browser.version(),
      origin,
      real: [
        "register/login",
        "memory-only tokens",
        "startup no-cookie stops once",
        "refresh/reopen prompt-none restore",
        "logout revocation",
        "same workspace re-login",
      ],
      uiInjected: [
        "short expires_in pre-dispatch restore",
        "loading",
        "empty",
        "degraded",
        "error",
        "forbidden",
        "mobile-long",
        "logout timeout/retry/new-tab suppression",
        "pending re-login",
        "authenticated error logout",
        "invalid config",
      ],
      screenshots: output,
      pageErrors: errors.length,
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
