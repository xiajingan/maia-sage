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
  const recovery = {
    ...operation,
    operationId: "11",
    sourceOperationId: "10",
    sourceRowVersion: "1",
    safeReason: "administrator_identity_required",
    launch: {
      kind: "member",
      url: "https://synthetic.example/recovery-identity",
    },
  };
  const hardOperation = {
    ...operation,
    operationId: "13",
    phase: "awaiting_verification",
    nextAction: "complete",
    safeReason: "authorization_invalidation_pending",
    launch: null,
    rowVersion: "5",
  };
  let recoveryPosts = 0,
    sourceUnavailable = false;
  const recoveryKeys = [];
  const completeBodies = [];
  const nextRecovery = { ...recovery, operationId: "12" };
  let lostRoundKey;
  const recoveryRoundReads = [];
  const recoverySourceReads = [];
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
    if (
      path.endsWith("/install-recoveries/11") ||
      path.endsWith("/install-recoveries/12")
    ) {
      recoveryRoundReads.push(path);
      return route.fulfill({
        json: path.endsWith("/12") ? nextRecovery : recovery,
      });
    }
    if (path.includes("/install-recoveries/"))
      return route.fulfill({
        status: 404,
        json: { ...safeError, code: "NOT_FOUND" },
      });
    if (path.endsWith("/install-operations/10/recovery")) {
      recoverySourceReads.push(url.searchParams.get("clientRequestId"));
      return route.fulfill({
        json: {
          sourceOperationId: "10",
          rowVersion: "1",
          nextAction: sourceUnavailable ? "none" : "recover",
          safeReason: sourceUnavailable ? "recovery_source_expired" : null,
          recovery:
            mode === "second-round-created" &&
            url.searchParams.get("clientRequestId") === lostRoundKey
              ? nextRecovery
              : null,
        },
      });
    }
    if (path.endsWith("/install-operations/10/recover")) {
      recoveryPosts++;
      recoveryKeys.push(req.postDataJSON().clientRequestId);
      assert.equal(req.postDataJSON().rowVersion, "1");
      if (
        mode === "second-round-created" ||
        mode === "second-round-uncreated"
      ) {
        lostRoundKey = req.postDataJSON().clientRequestId;
        return route.fulfill({
          status: 503,
          json: { ...safeError, code: "RESULT_UNKNOWN" },
        });
      }
      if (mode === "second-round-retry")
        return route.fulfill({ json: nextRecovery });
      if (mode === "recovery-create-lost")
        return route.fulfill({
          status: 503,
          json: { ...safeError, code: "RESULT_UNKNOWN" },
        });
      return route.fulfill({ json: recovery });
    }
    if (path.endsWith("/wecom/install-operations")) {
      installPosts++;
      return route.fulfill({ json: operation });
    }
    if (path.endsWith("/install-operations/10/complete")) {
      completeBodies.push(req.postDataJSON());
      if (mode === "subscribe-pending")
        return route.fulfill({ json: operation });
      return route.fulfill({
        json: {
          ...operation,
          phase: "completed",
          nextAction: "none",
          instanceId: "20",
          launch: null,
          rowVersion: "4",
        },
      });
    }
    if (path.endsWith("/install-operations/13/complete")) {
      completeBodies.push(req.postDataJSON());
      Object.assign(hardOperation, {
        phase: "restricted",
        nextAction: "start_new",
        safeReason: "operation_authorization_invalidated",
        rowVersion: "6",
      });
      return route.fulfill({ json: hardOperation });
    }
    if (path.endsWith("/install-operations/13"))
      return route.fulfill({ json: hardOperation });
    if (path.endsWith("/install-operations/10")) {
      queryReads++;
      return mode === "operation-missing"
        ? route.fulfill({
            status: 404,
            json: { ...safeError, code: "NOT_FOUND" },
          })
        : mode === "operation-error" || mode === "recovery-read-lost"
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
      safeReason: "authorization_invalidation_pending",
      rowVersion: "2",
    });
    mode = "subscribe-pending";
    await button("查询原操作").click();
    await button("核对并完成接入").click();
    await expect(button("核对并完成接入")).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "接入待核对" }),
    ).toBeVisible();
    await page.reload();
    await expect(button("核对并完成接入")).toBeEnabled();
    await expect(page).toHaveURL(
      `${origin}/workspaces/1/wecom/install-operations/10`,
    );
    assert.deepEqual(completeBodies, [{ rowVersion: "2" }]);
    assert.equal(installPosts, 1);
    assert.equal(recoveryPosts, 0);
    Object.assign(operation, { safeReason: null, rowVersion: "3" });
    mode = "ready";
    await button("查询原操作").click();
    await button("核对并完成接入").click();
    await expect(
      page.getByText("可信绑定已完成", { exact: true }),
    ).toBeVisible();
    assert.deepEqual(completeBodies, [
      { rowVersion: "2" },
      { rowVersion: "3" },
    ]);
    Object.assign(operation, {
      phase: "completed",
      nextAction: "none",
      instanceId: "20",
      rowVersion: "4",
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
    await page.goto(`${origin}/workspaces/1/wecom/install-operations/13`);
    await expect(button("核对并完成接入")).toBeEnabled();
    await button("核对并完成接入").click();
    await expect(page.getByRole("heading", { name: "接入受限" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "接入受限" })).toBeVisible();
    await expect(button("核对并完成接入")).toHaveCount(0);
    await expect(button("使用已保存结果重新核验管理员身份")).toHaveCount(0);
    assert.deepEqual(completeBodies, [
      { rowVersion: "2" },
      { rowVersion: "3" },
      { rowVersion: "5" },
    ]);
    assert.equal(installPosts, 1);
    assert.equal(recoveryPosts, 0);
    // Recovery uses only synthetic responses on the existing public adapter.
    Object.assign(operation, {
      phase: "expired",
      nextAction: "start_new",
      instanceId: null,
      launch: null,
    });
    await page.goto(`${origin}/workspaces/1/wecom/install-operations/10`);
    await expect(button("使用已保存结果重新核验管理员身份")).toBeVisible();
    await expect(
      page.getByText("只重新核验管理员身份，不会重新安装。", { exact: true }),
    ).toBeVisible();
    await button("使用已保存结果重新核验管理员身份").click();
    await expect(page).toHaveURL(
      `${origin}/workspaces/1/wecom/install-operations/11`,
    );
    await expect(button("复制管理员身份核验链接")).toBeVisible();
    await expect(button("重新核验管理员身份")).toHaveCount(0);
    await expect(
      page.getByText("保留此电脑页面与当前 Maia 登录", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("无需在手机登录 Maia", { exact: false }),
    ).toBeVisible();
    await page.evaluate(() =>
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value) => {
            globalThis.__copied = value;
          },
        },
      }),
    );
    await button("复制管理员身份核验链接").click();
    assert.equal(
      await page.evaluate(() => globalThis.__copied),
      recovery.launch.url,
    );
    assert.equal(recoveryPosts, 1);
    assert.equal(installPosts, 1);
    await page.evaluate(() =>
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("synthetic denial");
          },
        },
      }),
    );
    await button("复制管理员身份核验链接").click();
    const manualLink = page.getByLabel("管理员身份核验链接（只读）");
    await expect(manualLink).toHaveValue(recovery.launch.url);
    await expect(manualLink).toHaveAttribute("readonly", "");
    await manualLink.focus();
    assert.equal(
      await manualLink.evaluate((el) => el.selectionEnd - el.selectionStart),
      recovery.launch.url.length,
    );
    await page.setViewportSize({ width: 375, height: 812 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await mkdir("/tmp/maia-sage-wecom-ui", { recursive: true });
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await page.locator("section.panel").first().screenshot({
      path: "/tmp/maia-sage-wecom-ui/recovery-handoff-synthetic.png",
    });
    // Late clipboard failure after query changes the authorized action cannot restore fallback.
    await page.evaluate(() =>
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            new Promise((_resolve, reject) => {
              globalThis.__rejectCopy = () =>
                reject(new Error("synthetic denial"));
            }),
        },
      }),
    );
    await button("复制管理员身份核验链接").click();
    Object.assign(recovery, { nextAction: "query_original", launch: null });
    await button("查询原操作").click();
    await page.evaluate(() => globalThis.__rejectCopy());
    await expect(manualLink).toHaveCount(0);
    await expect(button("复制管理员身份核验链接")).toHaveCount(0);
    Object.assign(recovery, {
      nextAction: "authorize",
      expiresAt: Date.now() + 500,
      launch: {
        kind: "member",
        url: "https://synthetic.example/recovery-identity",
      },
    });
    await button("查询原操作").click();
    await expect(button("复制管理员身份核验链接")).toBeVisible();
    await expect(button("复制管理员身份核验链接")).toHaveCount(0);
    Object.assign(recovery, {
      phase: "expired",
      nextAction: "recover",
      launch: null,
    });
    await button("查询原操作").click();
    await expect(button("重新核验管理员身份")).toBeVisible();
    Object.assign(recovery, {
      phase: "awaiting_authorization",
      nextAction: "authorize",
      expiresAt: 1900000000000,
      launch: {
        kind: "member",
        url: "https://synthetic.example/recovery-identity",
      },
    });
    await button("重新核验管理员身份").click();
    assert.equal(recoveryPosts, 2);
    assert.notEqual(recoveryKeys[0], recoveryKeys[1]);
    await page.evaluate(() => sessionStorage.removeItem("sage.wecom.install"));
    await page.goto(
      `${origin}/workspaces/1/wecom/install-operations/11?synthetic=discard#discard`,
    );
    await expect(page).toHaveURL(
      `${origin}/workspaces/1/wecom/install-operations/11`,
    );
    await expect(button("复制管理员身份核验链接")).toBeVisible();
    assert.equal(recoveryPosts, 2);
    assert(
      !/synthetic\.example|browser-fixture|Bearer/.test(
        await page.evaluate(() => JSON.stringify({ ...sessionStorage })),
      ),
    );
    await page.evaluate(() => sessionStorage.removeItem("sage.wecom.install"));
    mode = "recovery-create-lost";
    await page.goto(`${origin}/workspaces/1/wecom/install-operations/10`);
    await button("使用已保存结果重新核验管理员身份").click();
    await expect(button("核对原核验请求")).toBeVisible();
    mode = "recovery-read-lost";
    await page.reload();
    await expect(button("查询原操作")).toBeVisible();
    await expect(button("核对原核验请求")).toBeVisible();
    mode = "ready";
    await button("核对原核验请求").click();
    await expect(button("复制管理员身份核验链接")).toBeVisible();
    assert.equal(recoveryPosts, 4);
    assert.equal(recoveryKeys[2], recoveryKeys[3]);
    // I-1: refreshing old recovery11 must resolve key B, never alias it to 11.
    for (const created of [true, false]) {
      Object.assign(recovery, {
        phase: "expired",
        nextAction: "recover",
        launch: null,
      });
      await page.evaluate(() =>
        sessionStorage.removeItem("sage.wecom.install"),
      );
      mode = created ? "second-round-created" : "second-round-uncreated";
      await page.goto(`${origin}/workspaces/1/wecom/install-operations/11`);
      const postsBefore = recoveryPosts;
      await button("重新核验管理员身份").click();
      await expect(button("核对原核验请求")).toBeVisible();
      const originalKey = lostRoundKey;
      const sourceReadsBefore = recoverySourceReads.length;
      const roundReadsBefore = recoveryRoundReads.length;
      await page.reload();
      if (created) {
        await expect(page).toHaveURL(
          `${origin}/workspaces/1/wecom/install-operations/12`,
        );
        await expect(button("复制管理员身份核验链接")).toBeVisible();
      } else {
        await expect(button("核对原核验请求")).toBeVisible();
        const saved = await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem("sage.wecom.install")),
        );
        assert.equal(saved.operationId, "11");
        assert.equal(saved.recoveryPending.input.clientRequestId, originalKey);
        assert.equal(saved.clientRequestId, undefined);
        await button("查询原操作").click();
        assert.equal(recoveryPosts, postsBefore + 1);
      }
      assert.equal(recoverySourceReads[sourceReadsBefore], originalKey);
      assert(
        !recoveryRoundReads
          .slice(roundReadsBefore)
          .some((path) => path.endsWith("/11")),
      );
      assert.equal(recoveryPosts, postsBefore + 1);
      if (!created) {
        mode = "second-round-retry";
        await button("核对原核验请求").click();
        await expect(page).toHaveURL(
          `${origin}/workspaces/1/wecom/install-operations/12`,
        );
        await expect(button("复制管理员身份核验链接")).toBeVisible();
        assert.equal(recoveryPosts, postsBefore + 2);
        assert.equal(recoveryKeys.at(-1), originalKey);
      }
      const saved = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("sage.wecom.install")),
      );
      assert.equal(saved.operationId, "12");
      assert.equal(saved.clientRequestId, originalKey);
      assert.equal(saved.recoveryPending, undefined);
    }
    mode = "ready";
    Object.assign(recovery, {
      phase: "awaiting_authorization",
      nextAction: "authorize",
      launch: nextRecovery.launch,
    });
    sourceUnavailable = true;
    await page.evaluate(() => sessionStorage.removeItem("sage.wecom.install"));
    await page.goto(`${origin}/workspaces/1/wecom/install-operations/10`);
    await expect(
      page.getByText("已保存结果已不可核验，请重新取得可信授权。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(button("使用已保存结果重新核验管理员身份")).toHaveCount(0);
    assert.equal(installPosts, 1);
    Object.assign(operation, {
      phase: "completed",
      nextAction: "none",
      instanceId: "20",
      launch: null,
    });
    await button("查询原操作").click();
    await page.setViewportSize({ width: 1280, height: 900 });
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
    // The App keeps the same Workspace component when only operationId changes.
    mode = "operation-missing";
    await page.goto(`${origin}/workspaces/1/wecom/install-operations/10`);
    await expect(
      page.getByRole("heading", { name: "无法访问此接入" }),
    ).toBeVisible();
    await expect(button("管理员接入")).toHaveCount(0);
    const postsBeforeList = installPosts;
    await button("企业微信接入").click();
    await expect(page).toHaveURL(`${origin}/workspaces/1/wecom`);
    await expect(button("管理员接入")).toBeEnabled();
    assert.equal(installPosts, postsBeforeList);
    mode = "ready";
    Object.assign(operation, {
      operationId: "11",
      phase: "awaiting_authorization",
      nextAction: "authorize",
      safeReason: null,
      instanceId: null,
      launch: { kind: "admin", url: "https://synthetic.example/new-install" },
    });
    await button("管理员接入").click();
    await expect(page).toHaveURL(
      `${origin}/workspaces/1/wecom/install-operations/11`,
    );
    assert.equal(installPosts, postsBeforeList + 1);
    await page.evaluate(() => sessionStorage.removeItem("sage.wecom.install"));
    await page.goto(`${origin}/workspaces/1/wecom/install-operations/11`);
    await expect(button("复制管理员身份核验链接")).toBeVisible();
    await page.evaluate(() =>
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            new Promise((_resolve, reject) => {
              globalThis.__rejectCopy = () =>
                reject(new Error("synthetic denial"));
            }),
        },
      }),
    );
    await button("复制管理员身份核验链接").click();
    await button("退出登录").click();
    await page.evaluate(() => globalThis.__rejectCopy());
    await expect(page.getByLabel("管理员身份核验链接（只读）")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "核验管理员身份", exact: true }),
    ).toHaveCount(0);
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
      if (prototype === "wecom-onboarding") {
        for (const state of [
          "recovery-source",
          "recovery-expired",
          "source-expired",
          "recovery-unknown",
          "administrator",
          "copy-failed",
        ]) {
          await page.getByLabel("预览状态").selectOption(state);
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
        }
        await expect(
          page.getByLabel("管理员身份核验链接（只读）"),
        ).toHaveAttribute("readonly", "");
      }
      await page.getByLabel("预览状态").selectOption("ready");
      await page.screenshot({
        path: `/tmp/maia-sage-wecom-ui/${prototype}-prototype.png`,
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      `Chrome ${browser.version()} 合成企微页面、原操作/结果恢复、跨设备链接与到期清理、分页、同步未知、权限清理与原型状态通过；不代表真实企微安装或姓名验收`,
    );
  }
} finally {
  await browser?.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(outDir, { recursive: true, force: true });
}
