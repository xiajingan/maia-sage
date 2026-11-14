// TC-SAGE-003 — Chrome + real Vue/SDK; every business response below is synthetic.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
const outDir = await mkdtemp(join(tmpdir(), "sage-wecom-browser-"));
const server = createServer(async (request, response) => {
  if (request.url === "/fixture.js" || request.url === "/fixture.css") {
    response.setHeader(
      "Content-Type",
      request.url.endsWith(".js") ? "text/javascript" : "text/css",
    );
    response.end(await readFile(join(outDir, request.url.slice(1))));
  } else if (
    /^\/prototypes\/(wecom-onboarding|contacts)\.html$/.test(request.url ?? "")
  ) {
    response.setHeader("Content-Type", "text/html");
    response.end(
      await readFile(new URL(`../docs${request.url}`, import.meta.url)),
    );
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div><script type="module" src="/fixture.js"></script></html>',
    );
  }
});
let browser;
try {
  await build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: "tests/fixtures/terminal-browser.ts",
        formats: ["es"],
        fileName: "fixture",
        cssFileName: "fixture",
      },
    },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  browser = await chromium.launch({
    executablePath:
      process.env.SAGE_CHROME ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(8000);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    )
      errors.push("console-error");
  });
  const safeError = {
    code: "UNAVAILABLE",
    message: "安全合成错误",
    requestId: "synthetic-request",
    recovery: "query_original",
  };
  const operation = {
    operationId: "10",
    phase: "awaiting_authorization",
    expiresAt: 1900000000000,
    safeReason: null,
    nextAction: "authorize",
    instanceId: null,
    rowVersion: "1",
    launch: { kind: "admin", url: "https://synthetic.example/install" },
  };
  const instance = {
    instanceId: "20",
    workspaceId: "1",
    status: "active",
    authorizationVersion: "1",
    scopeVersion: "1",
    rowVersion: "1",
    installation: "completed",
    sync: "partial",
    archive: "not_enabled",
    terminal: "not_configured",
    scope: {
      authority: "member",
      basis: "member_self",
      member: { namespace: "wecom.open_userid", id: "synthetic-member" },
      completeness: "verified",
      lastTrustedAt: 1800000000000,
    },
  };
  const sync = {
    syncId: "40",
    instanceId: "20",
    rowVersion: "1",
    phase: "partial",
    coverage: "partial",
    safeReason: "provider_unavailable",
    lastTrustedAt: 1800000000000,
    scopeVersion: "1",
  };
  const contact = {
    id: "30",
    sourceNamespace: "wecom.open_userid",
    sourceId: "synthetic-member" + "合成标识".repeat(8),
    position: null,
    positionAvailability: "not_authorized",
    avatarUrl: null,
    avatarAvailability: "not_returned",
    lastTrustedAt: 1800000000000,
    state: "active",
    safeReason: null,
  };
  let contactPage = {
    accessState: "active",
    safeReason: null,
    lastTrustedAt: 1800000000000,
    sync,
    items: [contact],
    nextCursor: "second",
    scopeVersion: "1",
  };
  let mode = "ready",
    installPosts = 0,
    queryReads = 0,
    syncPosts = 0,
    instancesEmpty = true;
  const syncKeys = [];
  let holdContacts;
  let waitingContacts;
  await page.route("**/api/mud/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    assert.equal(req.headers().authorization, "Bearer browser-fixture");
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
    if (path.endsWith("/channel-app-instances"))
      return mode === "instance-error"
        ? route.fulfill({ status: 503, json: safeError })
        : route.fulfill({
            json: { items: instancesEmpty ? [] : [instance], nextCursor: null },
          });
    if (path.endsWith("/wecom/install-operations")) {
      installPosts++;
      return route.fulfill({ json: operation });
    }
    if (path.endsWith("/install-operations/10/complete"))
      return route.fulfill({
        json: {
          ...operation,
          phase: "completed",
          nextAction: "none",
          instanceId: "20",
          launch: null,
          rowVersion: "3",
        },
      });
    if (path.endsWith("/install-operations/10")) {
      queryReads++;
      return mode === "operation-error"
        ? route.fulfill({ status: 503, json: safeError })
        : route.fulfill({ json: operation });
    }
    if (path.endsWith("/contacts")) {
      if (waitingContacts) await waitingContacts;
      if (mode === "contact-error" || mode === "forbidden")
        return route.fulfill({
          status: mode === "forbidden" ? 403 : 503,
          json: {
            ...safeError,
            code: mode === "forbidden" ? "FORBIDDEN" : "UNAVAILABLE",
          },
        });
      return route.fulfill({
        json: url.searchParams.has("cursor")
          ? {
              ...contactPage,
              items: [{ ...contact, id: "31", sourceId: "synthetic-second" }],
              nextCursor: null,
            }
          : contactPage,
      });
    }
    if (path.endsWith("/contact-syncs")) {
      syncPosts++;
      syncKeys.push(req.postDataJSON().clientRequestId);
      return mode === "sync-unknown"
        ? route.fulfill({
            status: 503,
            json: { ...safeError, code: "RESULT_UNKNOWN" },
          })
        : route.fulfill({ json: sync });
    }
    if (path.endsWith("/contact-syncs/40"))
      return route.fulfill({ json: sync });
    return route.fulfill({
      status: 404,
      json: { ...safeError, code: "NOT_FOUND" },
    });
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(`${origin}/workspaces/1/wecom`);
  await page
    .getByRole("heading", { name: "企业微信接入", exact: true })
    .waitFor();
  if (process.argv.includes("--inspect")) {
    console.log(await page.locator("main").innerText());
    await page.goto(`${origin}/workspaces/1/channel-app-instances/20/contacts`);
    await page.locator('[data-contact-id="30"]').waitFor();
    console.log(await page.locator("main").innerText());
  } else {
    await expect(
      page.getByText("当前空间暂无企微实例。", { exact: false }),
    ).toBeVisible();
    await button("管理员接入").focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("link", { name: "打开管理员授权入口" }),
    ).toHaveAttribute("target", "_blank");
    await expect(page).toHaveURL(
      `${origin}/workspaces/1/wecom/install-operations/10`,
    );
    Object.assign(operation, {
      phase: "awaiting_verification",
      safeReason: "administrator_identity_required",
      launch: { kind: "member", url: "https://synthetic.example/identity" },
    });
    await button("查询原操作").click();
    await expect(
      page.getByRole("link", { name: "核验管理员身份" }),
    ).toBeVisible();
    Object.assign(operation, {
      safeReason: "exchange_result_unknown",
      nextAction: "query_original",
      launch: null,
    });
    await button("查询原操作").click();
    await expect(
      page.getByText("外部授权结果尚未核实", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /授权入口|扫码入口|核验管理员身份/ }),
    ).toHaveCount(0);
    Object.assign(operation, {
      nextAction: "complete",
      safeReason: null,
      rowVersion: "2",
    });
    await button("查询原操作").click();
    await button("核对并完成接入").click();
    await expect(
      page.getByText("可信绑定已完成", { exact: true }),
    ).toBeVisible();
    Object.assign(operation, {
      phase: "completed",
      nextAction: "none",
      instanceId: "20",
      rowVersion: "3",
    });
    mode = "operation-error";
    await page.reload();
    await expect(button("查询原操作")).toBeVisible();
    await expect(button("管理员接入")).toHaveCount(0);
    mode = "ready";
    await button("查询原操作").click();
    await expect(
      page.getByText("可信绑定已完成", { exact: true }),
    ).toBeVisible();
    assert.equal(installPosts, 1);
    assert(queryReads >= 4);
    const storage = await page.evaluate(() =>
      JSON.stringify({ ...sessionStorage }),
    );
    assert(!/synthetic\.example|browser-fixture|Bearer/.test(storage));
    instancesEmpty = false;
    await button("刷新实例").click();
    const card = page.locator('[data-instance-id="20"]');
    await expect(card).toContainText("部分完成");
    await expect(card).toContainText("尚未开通");
    await expect(card).toContainText("尚未配置");
    mode = "instance-error";
    await button("刷新实例").click();
    await expect(page.getByRole("alert")).toContainText("上次读取");
    await expect(card).toBeVisible();
    mode = "ready";
    await card.getByRole("button", { name: "查看内部联系人" }).click();
    await expect(page).toHaveURL(
      `${origin}/workspaces/1/channel-app-instances/20/contacts`,
    );
    const row = page.locator('[data-contact-id="30"]');
    await expect(row).toBeVisible();
    await page.getByRole("link", { name: "跳到主要内容" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page).toHaveURL(
      `${origin}/workspaces/1/channel-app-instances/20/contacts`,
    );
    await page.evaluate(() => {
      globalThis.location.hash = "synthetic-fragment";
    });
    await expect(page).toHaveURL(
      `${origin}/workspaces/1/channel-app-instances/20/contacts`,
    );

    await expect(
      page.getByRole("columnheader", { name: "成员标识（来源命名空间）" }),
    ).toBeVisible();
    await expect(row).toContainText("姓名暂不可展示");
    await expect(row).toContainText("未获准");
    await expect(row).toContainText("未返回");
    await expect(page.getByText("覆盖不完整", { exact: true })).toBeVisible();
    await button("下一页联系人").click();
    await expect(page.locator('[data-contact-id="31"]')).toBeVisible();
    await expect(row).toHaveCount(0);
    await button("返回联系人首页").click();
    await expect(row).toBeVisible();
    mode = "sync-unknown";
    await button("补同步当前范围").click();
    await expect(button("核对原同步请求")).toBeVisible();
    mode = "ready";
    await button("核对原同步请求").click();
    assert.equal(syncPosts, 2);
    assert.equal(syncKeys[0], syncKeys[1]);
    mode = "contact-error";
    await button("刷新联系人").click();
    await expect(page.getByRole("alert")).toContainText("停止显示旧资料");
    await expect(row).toHaveCount(0);
    mode = "ready";
    contactPage = {
      ...contactPage,
      accessState: "pending_verification",
      safeReason: "scope_reverification_required",
      items: [],
    };
    await button("刷新联系人").click();
    await expect(page.getByRole("status")).toContainText("不代表全量为零");
    await expect(button("补同步当前范围")).toHaveCount(0);
    contactPage = {
      ...contactPage,
      accessState: "active",
      safeReason: null,
      items: [],
      nextCursor: null,
    };
    await button("刷新联系人").click();
    await expect(
      page.getByText("当前页暂无可展示", { exact: false }),
    ).toBeVisible();
    waitingContacts = new Promise((resolve) => {
      holdContacts = resolve;
    });
    const refresh = button("刷新联系人").click();
    await refresh;
    await expect(page.getByRole("status")).toContainText("正在核对联系人");
    holdContacts();
    waitingContacts = undefined;
    await expect(button("刷新联系人")).toBeEnabled();
    contactPage = { ...contactPage, items: [contact] };
    await button("刷新联系人").click();
    await expect(row).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const tableRegion = page.getByRole("region", {
      name: "联系人资料，可横向滚动",
    });
    await tableRegion.focus();
    await expect(tableRegion).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => tableRegion.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await mkdir("/tmp/maia-sage-wecom-ui", { recursive: true });
    await page.screenshot({
      path: "/tmp/maia-sage-wecom-ui/contacts-synthetic.png",
      fullPage: true,
    });
    mode = "forbidden";
    await button("刷新联系人").click();
    await expect(page.getByRole("alert")).toContainText("当前无权");
    await expect(row).toHaveCount(0);
    await expect(button("退出登录")).toBeVisible();
    await expect(button("补同步当前范围")).toHaveCount(0);
    await page.goto(`${origin}/workspaces/9/channel-app-instances/20/contacts`);
    await expect(page.getByRole("alert")).toContainText("不匹配");
    await expect(row).toHaveCount(0);
    for (const prototype of ["wecom-onboarding", "contacts"]) {
      await page.goto(`${origin}/prototypes/${prototype}.html`);
      for (const state of [
        "ready",
        "empty",
        "loading",
        "error",
        "degraded",
        "forbidden",
      ]) {
        await page.getByLabel("预览状态").selectOption(state);
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
      await page.getByLabel("预览状态").selectOption("ready");
      await page.screenshot({
        path: `/tmp/maia-sage-wecom-ui/${prototype}-prototype.png`,
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      `Chrome ${browser.version()} 合成企微页面、原操作恢复、分页、同步未知、权限清理与原型状态通过；不代表真实企微安装或姓名验收`,
    );
  }
} finally {
  await browser?.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(outDir, { recursive: true, force: true });
}
