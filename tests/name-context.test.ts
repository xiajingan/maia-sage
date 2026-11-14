import { afterEach, expect, test, vi } from "vitest";
import { harness, memoryStorage } from "./fixtures/wecom";
import {
  createNameContextController,
  readNameReturn,
  handleNameResult,
  prepareNameNavigation,
} from "../src/features/contacts/name-context";
import type { CreateNameContextResponse } from "maia-mud-client";
const operation: CreateNameContextResponse = {
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
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
// TC-SAGE-004
test("popup_source_and_origin 错通知不领取，正确通知由原Bearer查询并完成", async () => {
  const h = await harness((request) =>
    Response.json(
      request.method === "GET"
        ? { ...operation, phase: "ready", nextAction: "complete" }
        : request.url.endsWith("/complete")
          ? { ...operation, phase: "completed", nextAction: "use_component" }
          : operation,
    ),
  );
  const popup = { location: { replace: vi.fn() }, close: vi.fn() };
  vi.stubGlobal("window", {
    location: {
      origin: "https://localhost",
      href: "https://localhost/workspaces/1/channel-app-instances/20/contacts",
      pathname: "/workspaces/1/channel-app-instances/20/contacts",
    },
    open: vi.fn(() => popup),
  });
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await c.start("web");
  expect(popup.location.replace).toHaveBeenCalledWith(
    operation.authorizationUrl,
  );
  const count = h.requests.length;
  for (const event of [
    { origin: "https://evil.test", source: popup, data: { operationId: "50" } },
    { origin: "https://localhost", source: {}, data: { operationId: "50" } },
    { origin: "https://localhost", source: popup, data: { operationId: "51" } },
    {
      origin: "https://localhost",
      source: popup,
      data: { operationId: "50", code: "forbidden" },
    },
  ])
    await c.receive(event);
  expect(h.requests).toHaveLength(count);
  await c.receive({
    origin: "https://localhost",
    source: popup,
    data: { operationId: "50" },
  });
  expect(h.requests.some((r) => r.url.endsWith("/complete"))).toBe(true);
  expect(
    h.requests.every(
      (r) => r.headers.get("authorization") === "Bearer synthetic-access",
    ),
  ).toBe(true);
  expect(h.session.state.session?.user.id).toBe("2");
  c.dispose();
});

test("component_expired_or_wrong_corp 拒绝状态不改同步或实例，不循环授权", async () => {
  const h = await harness(() =>
    Response.json({
      ...operation,
      phase: "restricted",
      safeReason: "login_configuration_unavailable",
      nextAction: "check_configuration",
      authorizationUrl: null,
    }),
  );
  const popup = { close: vi.fn(), location: { replace: vi.fn() } };
  vi.stubGlobal("window", {
    location: { origin: "https://localhost" },
    open: vi.fn(() => popup),
  });
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await c.start("web");
  c.openAuthorization();
  expect(c.state.message).toContain("尚未配置");
  expect(popup.location.replace).not.toHaveBeenCalled();
  expect(h.requests).toHaveLength(1);
  expect(c.state.config).toBeUndefined();
  expect(h.session.state.session?.rootWorkspace.id).toBe("1");
  c.dispose();
});

test("同窗口结果仅消费非秘密原操作关联，通知仅operationId且去除query/hash", () => {
  const store = memoryStorage();
  vi.stubGlobal("sessionStorage", store);
  const origin = "https://localhost",
    path = "/workspaces/1/channel-app-instances/20/contacts";
  vi.stubGlobal("location", {
    href:
      origin +
      "/wecom/name-context-result?operationId=50&code=synthetic#token=synthetic",
    origin,
  });
  const replaceState = vi.fn();
  vi.stubGlobal("history", { replaceState });
  const postMessage = vi.fn();
  vi.stubGlobal("window", { opener: { postMessage } });
  handleNameResult();
  expect(postMessage).toHaveBeenCalledWith({ operationId: "50" }, origin);
  expect(replaceState).toHaveBeenCalledWith(
    null,
    "",
    "/wecom/name-context-result",
  );
  vi.stubGlobal("window", { opener: null });
  store.setItem(
    "sage.wecom.name-return",
    JSON.stringify({
      operationId: "50",
      instanceId: "20",
      returnPath: path,
      expiresAt: Date.now() + 60000,
    }),
  );
  expect(handleNameResult()?.returnPath).toBe(path);
  store.setItem(
    "sage.wecom.name-return",
    JSON.stringify({
      operationId: "50",
      instanceId: "20",
      returnPath: path + "?code=bad",
      expiresAt: Date.now() + 60000,
    }),
  );
  expect(readNameReturn()).toBeUndefined();
});

test("退出与迟到姓名响应不恢复旧上下文", async () => {
  let release!: (r: Response) => void;
  const h = await harness(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal("window", {
    location: { origin: "https://localhost" },
    open: () => null,
  });
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  const pending = c.start("web");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  h.session.dispose();
  release(Response.json(operation));
  await pending;
  expect(c.state.operation).toBeUndefined();
  expect(c.state.config).toBeUndefined();
  c.dispose();
});

test("同根重新登录后迟到响应不恢复旧操作", async () => {
  let release!: (r: Response) => void;
  const h = await harness(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal("window", {
    location: { origin: "https://localhost" },
    open: () => null,
  });
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  const pending = c.start("web");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await h.session.callback("new-session");
  release(Response.json(operation));
  await pending;
  expect(c.state.operation).toBeUndefined();
  c.dispose();
});

test("姓名配置跟随当前页cursor/20条；容量拒绝保留会话和安全recovery", async () => {
  const h = await harness((request) => {
    if (request.url.endsWith("/name-component-config"))
      return Response.json(
        {
          code: "FORBIDDEN",
          message: "受限",
          requestId: "safe",
          recovery:
            "当前页范围未能在核验预算内完成。可先缩小分页；重新安装或重复授权不会解除容量限制。",
        },
        { status: 403 },
      );
    return Response.json(
      request.method === "GET"
        ? { ...operation, phase: "completed", nextAction: "use_component" }
        : operation,
    );
  });
  vi.stubGlobal("window", {
    location: {
      origin: "https://localhost",
      href: "https://localhost/workspaces/1/channel-app-instances/20/contacts",
    },
    open: () => null,
  });
  const c = createNameContextController(h);
  c.select({
    workspaceId: "1",
    instanceId: "20",
    scopeVersion: "1",
    cursor: "page-two",
  });
  await c.start("web");
  await c.query();
  const configRequest = h.requests.find((r) =>
    r.url.endsWith("/name-component-config"),
  )!;
  expect(await configRequest.json()).toEqual({
    operationId: "50",
    pageKey: "instance_contacts",
    limit: 20,
    cursor: "page-two",
  });
  expect(configRequest.credentials).toBe("same-origin");
  expect(c.state.message).toContain("核验预算");
  expect(c.state.config).toBeUndefined();
  expect(h.session.state.session).toBeDefined();
  c.dispose();
});

test("恢复原操作被sid/权限拒绝时要求先Maia登录，不自动新建", async () => {
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("window", {
    location: {
      origin: "https://localhost",
      pathname: "/workspaces/1/channel-app-instances/20/contacts",
    },
  });
  const h = await harness(() =>
    Response.json(
      {
        code: "FORBIDDEN",
        message: "拒绝",
        requestId: "safe",
        recovery: "请核对原会话",
      },
      { status: 403 },
    ),
  );
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await c.resume({
    operationId: "50",
    instanceId: "20",
    returnPath: window.location.pathname,
    expiresAt: Date.now() + 60000,
  });
  expect(c.state.requiresLogin).toBe(true);
  expect(c.state.config).toBeUndefined();
  expect(h.requests).toHaveLength(1);
  expect(h.requests[0]!.method).toBe("GET");
  expect(h.session.state.session).toBeDefined();
  c.dispose();
});

test("较新范围清除旧恢复引用，避免再次领取旧范围操作", async () => {
  const h = await harness(() => Response.json(operation));
  const store = memoryStorage();
  vi.stubGlobal("sessionStorage", store);
  vi.stubGlobal("window", {
    location: {
      origin: "https://localhost",
      href: "https://localhost/workspaces/1/channel-app-instances/20/contacts",
    },
    open: () => null,
  });
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await c.start("web");
  expect(store.getItem("sage.wecom.name-return")).not.toBeNull();
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "2" });
  expect(store.getItem("sage.wecom.name-return")).toBeNull();
  expect(c.state.operation).toBeUndefined();
  c.dispose();
});

test("恢复已验证原上下文时配置容量403不被改写成重新登录", async () => {
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("window", {
    location: {
      origin: "https://localhost",
      pathname: "/workspaces/1/channel-app-instances/20/contacts",
    },
  });
  const h = await harness((request) =>
    request.url.endsWith("/name-component-config")
      ? Response.json(
          {
            code: "FORBIDDEN",
            message: "受限",
            requestId: "safe",
            recovery:
              "核验预算不足，请管理员核对范围，重复授权不会解除容量限制。",
          },
          { status: 403 },
        )
      : Response.json({
          ...operation,
          phase: "completed",
          nextAction: "use_component",
        }),
  );
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await c.resume({
    operationId: "50",
    instanceId: "20",
    returnPath: window.location.pathname,
    expiresAt: Date.now() + 60000,
  });
  expect(c.state.requiresLogin).not.toBe(true);
  expect(c.state.message).toContain("核验预算");
  c.dispose();
});

test("显式离页保留非秘密原操作，正常会话切换和卸载仍清理", async () => {
  const h = await harness(() => Response.json(operation));
  const store = memoryStorage();
  vi.stubGlobal("sessionStorage", store);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location: {
        origin: "https://localhost",
        href: "https://localhost/workspaces/1/channel-app-instances/20/contacts",
      },
      open: () => null,
    }),
  );
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await c.start("web");
  prepareNameNavigation();
  h.session.dispose();
  c.dispose();
  expect(JSON.parse(store.getItem("sage.wecom.name-return")!)).toEqual({
    operationId: "50",
    instanceId: "20",
    returnPath: "/workspaces/1/channel-app-instances/20/contacts",
    expiresAt: operation.expiresAt,
  });
  await h.session.callback("new-session");
  const second = createNameContextController(h);
  second.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await second.start("web");
  await h.session.signIn();
  expect(store.getItem("sage.wecom.name-return")).toBeNull();
  second.dispose();
  await h.session.callback("new-session");
  const third = createNameContextController(h);
  third.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await third.start("web");
  third.dispose();
  expect(store.getItem("sage.wecom.name-return")).toBeNull();
});

test("弹窗被阻止只尝试一次，显式打开复用原操作", async () => {
  const h = await harness(() => Response.json(operation));
  const open = vi.fn(() => null);
  vi.stubGlobal("window", { location: { origin: "https://localhost" }, open });
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await c.start("web");
  expect(open).toHaveBeenCalledTimes(1);
  expect(c.state.message).toContain("阻止");
  c.openAuthorization();
  expect(open).toHaveBeenCalledTimes(2);
  expect(h.requests).toHaveLength(1);
  c.dispose();
});
