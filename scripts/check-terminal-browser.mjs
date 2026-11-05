// TC-SAGE-002 — 真实 Chrome 内验证 Vue 页面和生成客户端，业务响应由 route 注入。
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";

const outDir = await mkdtemp(join(tmpdir(), "sage-terminal-browser-"));
const server = createServer(async (request, response) => {
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="app"></div><script type="module" src="/fixture.js"></script></html>',
    );
  } else if (request.url === "/fixture.js" || request.url === "/fixture.css") {
    response.setHeader(
      "Content-Type",
      request.url.endsWith(".js") ? "text/javascript" : "text/css",
    );
    response.end(await readFile(join(outDir, request.url.slice(1))));
  } else {
    response.writeHead(404).end();
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
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    )
      errors.push("console-error");
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const button = (name) => page.getByRole("button", { name, exact: true });
  const sample = {
    terminalId: "101",
    hostname: "机器".repeat(32),
    connection: "online",
    lastSeenAt: "2026-11-05T08:00:00.000Z",
    celtVersion: "0.2.0",
    windowsVersion: "Windows 11",
    capabilities: ["wecom.send_message"],
    minimumCeltVersion: "0.2.0",
    eligible: true,
  };
  let list = [];
  let failed = false;
  let holdList;
  const waitingForList = new Promise((resolve) => {
    holdList = resolve;
  });
  await page.route("**/api/mud/v1/session", (route) =>
    route.fulfill({
      json: {
        rootWorkspace: { id: "1", name: "个人工作空间" },
        user: { id: "2", loginName: "lin" },
        membership: { role: "manager" },
        accessContextVersion: "1",
      },
    }),
  );
  await page.route("**/api/mud/v1/workspaces/*/members?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/mud/v1/terminals?*", async (route) => {
    await waitingForList;
    if (failed)
      return route.fulfill({
        status: 503,
        json: { code: "UNAVAILABLE", requestId: "ui-list-request" },
      });
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      json: {
        items: cursor ? [sample] : list,
        nextCursor: !cursor && list.length ? "second" : null,
      },
    });
  });
  const code = "123456789012345678901A";
  let expiresAt;
  let issuanceCount = 0;
  await page.route("**/api/mud/v1/terminal-activations", (route) => {
    issuanceCount++;
    return route.fulfill({ status: 201, json: { code, expiresAt } });
  });

  await page.goto(origin);
  await button("终端").click();
  await expect(
    page.getByRole("heading", { name: "终端", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("正在读取终端…");
  holdList();
  await expect(page.getByText("暂无终端。", { exact: false })).toBeVisible();

  await page.clock.install();
  expiresAt = await page.evaluate(() =>
    new Date(Date.now() + 120000).toISOString(),
  );
  const add = button("添加终端");
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "添加终端" });
  const activation = dialog.getByRole("status", { name: "一次性激活码" });
  await expect(activation).toHaveText(code);
  await expect(dialog.locator("time")).toHaveAttribute("datetime", expiresAt);
  await expect(button("关闭")).toBeFocused();
  assert.deepEqual(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    [0, 0],
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("output")).toHaveCount(0);
  await expect(add).toBeFocused();

  await add.click();
  await expect(activation).toHaveText(code);
  await page.clock.fastForward(121000);
  await expect(dialog.getByRole("alert")).toContainText("激活码已过期");
  await expect(page.locator("output")).toHaveCount(0);
  expiresAt = await page.evaluate(() =>
    new Date(Date.now() + 120000).toISOString(),
  );
  await button("重新生成").click();
  await expect(activation).toHaveText(code);
  await button("关闭").click();
  assert.equal(issuanceCount, 3);

  failed = true;
  await button("刷新终端").click();
  await expect(page.getByRole("alert")).toContainText("ui-list-request");
  failed = false;
  list = [
    sample,
    { ...sample, terminalId: "102", connection: "offline", eligible: false },
    { ...sample, terminalId: "103", celtVersion: "0.1.0", eligible: false },
    {
      ...sample,
      terminalId: "104",
      connection: "unknown",
      eligible: false,
      lastSeenAt: null,
      celtVersion: null,
      windowsVersion: null,
      minimumCeltVersion: null,
      capabilities: [],
    },
  ];
  await button("刷新终端").click();
  const card = (id) => page.locator(`[data-terminal-id="${id}"]`);
  await expect(card("101")).toContainText("已激活");
  await expect(card("101")).toContainText("发送文本消息");
  await expect(card("101")).toContainText("Windows 11");
  await expect(card("102").getByText("离线", { exact: true })).toBeVisible();
  await expect(card("102").locator("time")).toHaveAttribute(
    "datetime",
    sample.lastSeenAt,
  );
  await expect(card("103")).toContainText("不能执行任务");
  await expect(card("103")).toContainText("最低 Celt 版本为 0.2.0");
  await expect(card("104").getByText("待确认").first()).toBeVisible();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await button("下一页").click();
  await expect(card("101")).toBeVisible();
  await expect(card("102")).toHaveCount(0);
  await button("返回首页").click();
  await expect(card("102")).toBeVisible();

  failed = true;
  await button("刷新终端").click();
  await expect(page.getByRole("alert")).toContainText("上次读取");
  await expect(card("101")).toBeVisible();
  await button("个人工作空间").click();
  await expect(page.getByRole("heading", { name: "空间成员" })).toBeVisible();
  await expect(card("101")).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    `Chrome ${browser.version()} 终端页面、激活码、键盘、移动布局与故障注入通过`,
  );
} finally {
  await browser?.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(outDir, { recursive: true, force: true });
}
