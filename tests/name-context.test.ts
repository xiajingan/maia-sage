import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { harness, memoryStorage } from "./fixtures/wecom";
import {
  createNameContextController,
  readNameReturn,
  handleNameResult,
  prepareNameNavigation,
} from "../src/features/contacts/name-context";
import { createSessionController } from "../src/auth/session";
import type { CreateNameContextResponse } from "maia-mud-client";
const pageLocation = {
  origin: "https://localhost",
  href: "https://localhost/workspaces/1/channel-app-instances/20/contacts",
  pathname: "/workspaces/1/channel-app-instances/20/contacts",
};
beforeEach(() => {
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("location", pageLocation);
});
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
function pageConfig(scopeVersion: string) {
  return {
    instanceId: "20",
    pageKey: "instance_contacts",
    pageUrl: pageLocation.href,
    environment: "web",
    scopeVersion,
    expiresAt: Date.now() + 60000,
    corpId: "synthetic-corp",
    agentId: "100",
    nonceStr: "synthetic",
    timestamp: Math.floor(Date.now() / 1000),
    corpSignature: "a".repeat(40),
    agentSignature: "b".repeat(40),
    references: [],
    nextCursor: null,
  };
}
test.each([
  { instanceId: "21" },
  {
    pageUrl: "https://localhost/workspaces/1/channel-app-instances/21/contacts",
  },
  { expiresAt: 1 },
])(
  "续签应答来自其他实例、其他页面或已过期时不可使联系人范围失效 %o",
  async (invalid) => {
    vi.stubGlobal("window", { location: pageLocation });
    const first = { source: "installation_binding", ...pageConfig("1") };
    let response = first;
    const h = await harness(() => Response.json(response));
    const onScopeChange = vi.fn();
    const names = createNameContextController({ ...h, onScopeChange });
    names.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
    await names.loadBoundConfig();
    expect(names.state.config).toBeDefined();
    response = { ...first, scopeVersion: "2", ...invalid };
    await names.loadBoundConfig(names.state.config);
    expect(names.state.config).toBeUndefined();
    expect(names.state.message).toBeTruthy();
    expect(onScopeChange).not.toHaveBeenCalled();
    names.dispose();
  },
);

test.each(["bound", "web", "member"] as const)(
  "首次签名或显式授权 %s 的范围不符仅影响姓名",
  async (environment) => {
    vi.stubGlobal("window", { location: pageLocation });
    const h = await harness((r) => {
      if (r.method === "GET")
        return Response.json({
          ...operation,
          environment,
          phase: "completed",
          nextAction: "use_component",
        });
      const config = pageConfig("2");
      return Response.json(
        environment === "bound"
          ? { ...config, source: "installation_binding" }
          : { ...config, environment, operationId: operation.operationId },
      );
    });
    const onScopeChange = vi.fn();
    const names = createNameContextController({ ...h, onScopeChange });
    names.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
    if (environment === "bound") await names.loadBoundConfig();
    else
      await names.resume({
        operationId: operation.operationId,
        instanceId: "20",
        returnPath: pageLocation.pathname,
        expiresAt: operation.expiresAt,
      });
    expect(h.requests.at(-1)?.url).toMatch(/name-component-config$/);
    expect(names.state.config).toBeUndefined();
    expect(names.state.message).toBeTruthy();
    expect(onScopeChange).not.toHaveBeenCalled();
    names.dispose();
  },
);

test("切换实例后返回的旧续签不能使当前联系人范围失效", async () => {
  vi.stubGlobal("window", { location: pageLocation });
  let hold = false;
  let finish!: (response: Response) => void;
  const h = await harness(() =>
    hold
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Response.json({ ...pageConfig("1"), source: "installation_binding" }),
  );
  const onScopeChange = vi.fn();
  const names = createNameContextController({ ...h, onScopeChange });
  names.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await names.loadBoundConfig();
  expect(names.state.config).toBeDefined();
  hold = true;
  const renewal = names.loadBoundConfig(names.state.config);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  names.select({ workspaceId: "1", instanceId: "21", scopeVersion: "1" });
  finish(Response.json({ ...pageConfig("2"), source: "installation_binding" }));
  await renewal;
  expect(names.state.config).toBeUndefined();
  expect(names.state.message).toBeUndefined();
  expect(onScopeChange).not.toHaveBeenCalled();
  names.dispose();
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
    location: pageLocation,
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
    location: pageLocation,
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
    location: pageLocation,
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
      pathname: "/workspaces/1/channel-app-instances/20/contacts",
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
      pathname: "/workspaces/1/channel-app-instances/20/contacts",
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
        pathname: "/workspaces/1/channel-app-instances/20/contacts",
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
  vi.stubGlobal("window", { location: pageLocation, open });
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

// TC-SAGE-004 — T8 review I1
test.each([false, true])(
  "closed_popup_reopen 保留原操作并替换通知来源（重开被阻止=%s）",
  async (blocked) => {
    const h = await harness((request) =>
      Response.json(
        request.method === "GET"
          ? { ...operation, phase: "ready", nextAction: "complete" }
          : request.url.endsWith("/complete")
            ? { ...operation, phase: "completed", nextAction: "use_component" }
            : operation,
      ),
    );
    const oldPopup = {
      closed: false,
      location: { replace: vi.fn() },
      close: vi.fn(),
    };
    const newPopup = {
      closed: false,
      location: { replace: vi.fn() },
      close: vi.fn(),
    };
    const open = vi.fn().mockReturnValueOnce(oldPopup);
    if (blocked) open.mockReturnValueOnce(null);
    open.mockReturnValueOnce(newPopup);
    vi.stubGlobal("window", {
      location: pageLocation,
      open,
    });
    const c = createNameContextController(h);
    try {
      c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
      await c.start("web");
      oldPopup.closed = true;
      c.openAuthorization();
      expect(open).toHaveBeenCalledTimes(2);
      if (blocked) {
        expect(c.state.message).toContain("阻止");
        await c.receive({
          origin: "https://localhost",
          source: oldPopup,
          data: { operationId: "50" },
        });
        expect(h.requests).toHaveLength(1);
        c.openAuthorization();
        expect(open).toHaveBeenCalledTimes(3);
      }
      expect(oldPopup.location.replace).toHaveBeenCalledTimes(1);
      expect(newPopup.location.replace).toHaveBeenCalledExactlyOnceWith(
        operation.authorizationUrl,
      );
      expect(c.state.operation?.operationId).toBe("50");
      expect(c.state.operation?.phase).toBe("awaiting_authorization");
      await c.receive({
        origin: "https://localhost",
        source: oldPopup,
        data: { operationId: "50" },
      });
      await c.receive({
        origin: "https://evil.test",
        source: newPopup,
        data: { operationId: "50" },
      });
      expect(h.requests).toHaveLength(1);
      await c.receive({
        origin: "https://localhost",
        source: newPopup,
        data: { operationId: "50" },
      });
      expect(
        h.requests.some((request) =>
          request.url.endsWith("/name-context-operations/50/complete"),
        ),
      ).toBe(true);
      expect(
        h.requests.filter((request) =>
          request.url.endsWith("/name-context-operations"),
        ),
      ).toHaveLength(1);
    } finally {
      c.dispose();
    }
  },
);

// TC-SAGE-001 TC-SAGE-004
test.each(["pagehide", "logout", "switch"])(
  "短token恢复保留姓名引用到%s并阻止所有新业务",
  async (outcome) => {
    vi.stubGlobal("localStorage", memoryStorage());
    const h = await harness(() => Response.json(operation));
    const store = memoryStorage();
    vi.stubGlobal("sessionStorage", store);
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        location: {
          origin: "https://localhost",
          href: "https://localhost/workspaces/1/channel-app-instances/20/contacts",
          pathname: "/workspaces/1/channel-app-instances/20/contacts",
        },
        open: () => null,
      }),
    );
    const c = createNameContextController(h);
    c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
    await c.start("web");
    const saved = store.getItem("sage.wecom.name-return");
    expect(saved).not.toBeNull();
    await h.session.signIn(true, { sameSessionOnly: true });
    expect(h.session.state.phase).toBe("authenticating");
    expect(store.getItem("sage.wecom.name-return")).toBe(saved);
    const sent = h.requests.length;
    await c.query();
    await h.session.load();
    expect(h.requests).toHaveLength(sent);
    if (outcome === "pagehide") {
      prepareNameNavigation();
      h.session.dispose();
      c.dispose();
      expect(store.getItem("sage.wecom.name-return")).toBe(saved);
    } else {
      if (outcome === "logout") await h.session.logout();
      else await h.session.signIn();
      expect(store.getItem("sage.wecom.name-return")).toBeNull();
      c.dispose();
    }
    expect(h.session.state.session).toBeUndefined();
  },
);

test("恢复开始后姓名旧查询迟到不能接受新版本或继续完成副作用", async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  let release!: (response: Response) => void;
  const h = await harness((request) =>
    request.method === "GET"
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : Response.json(operation),
  );
  const store = memoryStorage();
  vi.stubGlobal("sessionStorage", store);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location: {
        origin: "https://localhost",
        href: "https://localhost/workspaces/1/channel-app-instances/20/contacts",
        pathname: "/workspaces/1/channel-app-instances/20/contacts",
      },
      open: () => null,
    }),
  );
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await c.start("web");
  const original = store.getItem("sage.wecom.name-return");
  const late = c.query();
  await vi.waitFor(() => expect(h.requests).toHaveLength(2));
  await h.session.signIn(true, { sameSessionOnly: true });
  release(
    Response.json({ ...operation, rowVersion: "2", nextAction: "complete" }),
  );
  await late;
  expect(h.requests).toHaveLength(2);
  expect(c.state.operation?.rowVersion).toBe("1");
  expect(store.getItem("sage.wecom.name-return")).toBe(original);
  prepareNameNavigation();
  h.session.dispose();
  c.dispose();
});

// TC-SAGE-001 TC-SAGE-004 — real session + name controller + generated API.
test.each([
  ["query", 0],
  ["query", 4_000],
  ["complete", 0],
  ["complete", 4_000],
  ["complete401", 0],
] as const)(
  "%s响应跨到剩余%s毫秒时下一步零发送，恢复后只核对原操作",
  async (boundary, remaining) => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    const path = "/workspaces/1/channel-app-instances/20/contacts";
    vi.stubGlobal("location", { origin: "https://localhost" });
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        location: {
          origin: "https://localhost",
          href: "https://localhost" + path,
          pathname: path,
        },
        open: () => null,
      }),
    );
    const activeOperation = { ...operation, expiresAt: now + 594_000 };
    let recovered = false;
    const h = await harness((request) => {
      if (request.method === "GET") {
        if (!recovered && boundary === "query") now += 6_000 - remaining;
        return Response.json({
          ...activeOperation,
          rowVersion: recovered ? "4" : "2",
          nextAction: recovered ? "wait" : "complete",
        });
      }
      if (request.url.endsWith("/complete")) {
        now += 6_000 - remaining;
        if (boundary === "complete401")
          return Response.json(
            {
              code: "UNAUTHORIZED",
              message: "synthetic",
              requestId: "safe-request",
            },
            { status: 401 },
          );
        return Response.json({
          ...activeOperation,
          rowVersion: "3",
          phase: "completed",
          nextAction: "use_component",
        });
      }
      return Response.json(activeOperation);
    });
    const signIn = vi.fn(async () => {});
    const session = createSessionController({
      api: h.api,
      now: () => now,
      oidc: {
        signIn,
        clear: () => {},
        callback: async () => ({
          subject: "2",
          expiresAt: now + 300_000,
          accessToken: "synthetic-access",
          idToken: "synthetic-id",
        }),
      },
    });
    await session.callback("initial");
    const c = createNameContextController({ api: h.api, session });
    try {
      c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
      now += 294_000;
      await c.start("web");
      await c.query();
      expect(signIn).toHaveBeenCalledExactlyOnceWith(true, {
        sameSessionOnly: true,
      });
      expect(
        h.requests.filter((r) => r.url.endsWith("/complete")),
      ).toHaveLength(boundary === "query" ? 0 : 1);
      expect(h.requests.some((r) => r.url.includes("component-config"))).toBe(
        false,
      );
      expect(c.state.operation?.operationId).toBe("50");
      expect(c.state.operation?.rowVersion).toBe(
        boundary === "complete" ? "3" : "2",
      );
      const saved = readNameReturn()!;
      expect(saved).toMatchObject({ operationId: "50" });
      expect(localStorage.getItem("sage.auth.recovery-blocked")).toBeNull();
      recovered = true;
      await session.callback("restored");
      c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
      await c.resume(saved);
      expect(c.state.operation?.rowVersion).toBe("4");
      expect(h.requests.filter((r) => r.method === "GET")).toHaveLength(2);
      expect(h.requests.filter((r) => r.method === "POST")).toHaveLength(
        boundary === "query" ? 1 : 2,
      );
      expect(signIn).toHaveBeenCalledTimes(1);
    } finally {
      c.dispose();
      session.dispose();
      h.session.dispose();
    }
  },
);

// TC-SAGE-004 — unknown create survives authentication without another POST.
test.each([
  ["inflight401", "network"],
  ["before-dispatch", "network"],
  ["inflight401", "503"],
  ["before-dispatch", "503"],
])(
  "未知姓名create在%s恢复离页后保留原key，只有显式核对可发送（%s）",
  async (boundary, failure) => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    const path = "/workspaces/1/channel-app-instances/20/contacts";
    vi.stubGlobal("location", { origin: "https://localhost" });
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        location: {
          origin: "https://localhost",
          href: "https://localhost" + path,
          pathname: path,
        },
        open: () => null,
      }),
    );
    let attempt = 0;
    const h = await harness(() => {
      attempt++;
      if (attempt === 1) {
        if (failure === "503") return Response.json({}, { status: 503 });
        throw new Error("network-unknown");
      }
      if (boundary === "inflight401" && attempt === 2) {
        now += 6_000;
        return Response.json({}, { status: 401 });
      }
      return Response.json({
        ...operation,
        environment: "member",
        expiresAt: now + 240_000,
        nextAction: "wait",
        authorizationUrl: null,
      });
    });
    const signIn = vi.fn(async () => {});
    const newSession = async () => {
      const session = createSessionController({
        api: h.api,
        now: () => now,
        oidc: {
          signIn,
          clear: () => {},
          callback: async () => ({
            subject: "2",
            expiresAt: now + 300_000,
            accessToken: "synthetic-access",
            idToken: "synthetic-id",
          }),
        },
      });
      await session.callback("callback");
      return session;
    };
    const session = await newSession();
    const c = createNameContextController({ api: h.api, session });
    c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
    now += 294_000;
    await c.start("member");
    const original = await h.requests[0]!.clone().json();
    expect(readNameReturn()).toMatchObject({
      kind: "pending-create",
      clientRequestId: original.clientRequestId,
      userId: "2",
      environment: "member",
    });
    const initialDeadline = readNameReturn()!.expiresAt;
    if (boundary === "before-dispatch") now += 6_000;
    await c.start("web");
    expect(signIn).toHaveBeenCalledTimes(1);
    const sent = h.requests.length;
    prepareNameNavigation();
    session.dispose();
    c.dispose();
    const restoredSession = await newSession();
    const restored = createNameContextController({
      api: h.api,
      session: restoredSession,
    });
    try {
      const saved = readNameReturn()!;
      expect(saved.expiresAt).toBe(initialDeadline);
      restored.select({
        workspaceId: "1",
        instanceId: "20",
        scopeVersion: "1",
      });
      await restored.resume(saved);
      expect(h.requests).toHaveLength(sent);
      await restored.start("web");
      expect(h.requests).toHaveLength(sent + 1);
      for (const request of h.requests)
        expect(await request.json()).toEqual(original);
      expect(restored.state.operation?.operationId).toBe("50");
      expect(readNameReturn()).toMatchObject({ operationId: "50" });
    } finally {
      restored.dispose();
      restoredSession.dispose();
      h.session.dispose();
    }
  },
);

// TC-SAGE-004 — pending references never grant access or silently create a new key.
test.each(["expired", "damaged", "user", "instance", "scope"])(
  "pending-create的%s引用阻止发送并保留，显式放弃只清本地",
  async (condition) => {
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        location: pageLocation,
        open: () => null,
      }),
    );
    const h = await harness(() => Response.json({}, { status: 503 }));
    const c = createNameContextController(h);
    const selected = { workspaceId: "1", instanceId: "20", scopeVersion: "1" };
    c.select(selected);
    await c.start("web");
    const saved = JSON.parse(sessionStorage.getItem("sage.wecom.name-return")!);
    if (condition === "expired") saved.expiresAt = Date.now() - 1;
    if (condition === "user") saved.userId = "3";
    if (condition === "instance") {
      saved.instanceId = "21";
      saved.returnPath = "/workspaces/1/channel-app-instances/21/contacts";
    }
    if (condition === "scope") saved.scopeVersion = "2";
    const raw = condition === "damaged" ? "{broken" : JSON.stringify(saved);
    sessionStorage.setItem("sage.wecom.name-return", raw);
    c.select(selected);
    await c.start("web");
    expect(c.state.pendingCreate).toBe(true);
    expect(c.state.blocked).toBe(true);
    expect(c.state.requiresLogin).toBe(false);
    expect(h.requests).toHaveLength(1);
    expect(sessionStorage.getItem("sage.wecom.name-return")).toBe(raw);
    c.recreate(); // The known-operation action cannot bypass a pending reference.
    expect(sessionStorage.getItem("sage.wecom.name-return")).toBe(raw);
    c.abandon();
    expect(h.requests).toHaveLength(1);
    expect(sessionStorage.getItem("sage.wecom.name-return")).toBeNull();
    await c.start("web");
    expect(h.requests).toHaveLength(2);
    expect((await h.requests[1]!.json()).clientRequestId).not.toBe(
      saved.clientRequestId,
    );
    c.abandon();
    c.dispose();
  },
);

test("pending-create持久化被拒绝时POST零发送", async () => {
  vi.stubGlobal("window", { location: pageLocation, open: () => null });
  const store = memoryStorage();
  vi.stubGlobal("sessionStorage", {
    ...store,
    setItem: () => {
      throw new Error("blocked");
    },
  });
  const h = await harness(() => Response.json(operation));
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  await c.start("web");
  expect(h.requests).toHaveLength(0);
  expect(c.state.blocked).toBe(true);
  c.dispose();
});

test.each(["logout", "switch"])(
  "pending-create在显式%s后清理且不再发送",
  async (action) => {
    vi.stubGlobal("window", { location: pageLocation, open: () => null });
    const h = await harness(() => Response.json({}, { status: 503 }));
    const c = createNameContextController(h);
    c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
    await c.start("web");
    expect(readNameReturn()).toMatchObject({ kind: "pending-create" });
    if (action === "logout") await h.session.logout();
    else await h.session.signIn();
    expect(sessionStorage.getItem("sage.wecom.name-return")).toBeNull();
    expect(h.requests).toHaveLength(action === "logout" ? 2 : 1);
    c.dispose();
  },
);

// TC-SAGE-004 — restoring an existing operation must not consume its only reference before a read.
test("原操作恢复查询在途到期401仍保留已知引用", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location: pageLocation,
      open: () => null,
    }),
  );
  const expiresAt = now + 594_000;
  const h = await harness((request) => {
    if (request.method === "GET") {
      now += 6_000;
      return Response.json({}, { status: 401 });
    }
    return Response.json({ ...operation, expiresAt });
  });
  const c = createNameContextController(h);
  c.select({ workspaceId: "1", instanceId: "20", scopeVersion: "1" });
  now += 294_000;
  await c.start("web");
  const saved = readNameReturn()!;
  await c.resume(saved);
  expect(h.session.state.phase).toBe("authenticating");
  expect(readNameReturn()).toEqual(saved);
  expect(h.requests).toHaveLength(2);
  prepareNameNavigation();
  h.session.dispose();
  c.dispose();
});
