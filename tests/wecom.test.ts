import { afterEach, expect, test, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import WecomWorkspace from "../src/features/wecom/WecomWorkspace.vue";
import { createWecomPage } from "../src/features/wecom/wecom-page";
import { harness, install, memoryStorage } from "./fixtures/wecom";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
// TC-SAGE-003
test("unknown_keeps_operation", async () => {
  const { api, session, requests } = await harness((request) =>
    Response.json(
      request.method === "POST" ? install : { ...install, rowVersion: "2" },
    ),
  );
  const page = createWecomPage({ api, session, storage: memoryStorage() });
  await page.start("admin");
  await page.complete();
  await page.query();
  expect(page.state.operation?.operationId).toBe("10");
  expect(page.state.operation?.rowVersion).toBe("2");
  expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
    ["POST", "/api/mud/v1/workspaces/1/wecom/install-operations"],
    ["GET", "/api/mud/v1/wecom/install-operations/10"],
  ]);
  page.dispose();
});
// TC-SAGE-003
test("result_reload_not_invite", async () => {
  const storage = memoryStorage();
  const { api, session, requests } = await harness((request) =>
    Response.json(
      request.method === "POST"
        ? {
            ...install,
            phase: "awaiting_authorization",
            nextAction: "authorize",
            launch: { kind: "admin", url: "https://synthetic.example/one-use" },
          }
        : {
            ...install,
            phase: "completed",
            nextAction: "none",
            instanceId: "20",
          },
    ),
  );
  const page = createWecomPage({ api, session, storage });
  await page.start("admin");
  page.dispose();
  expect(storage.getItem("sage.wecom.install")).not.toContain("one-use");
  const reloaded = createWecomPage({ api, session, storage });
  await reloaded.resume("10");
  expect(reloaded.state.operation?.phase).toBe("completed");
  expect(reloaded.state.operation?.launch).toBeNull();
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  reloaded.dispose();
});
// TC-SAGE-003
test("unknown create explicitly rechecks the same idempotent request; complete unknown only queries", async () => {
  let unavailable = true;
  const { api, session, requests } = await harness(() => {
    if (unavailable)
      return Response.json(
        {
          code: "RESULT_UNKNOWN",
          message: "safe",
          requestId: "synthetic-request",
          recovery: "query_original",
        },
        { status: 503 },
      );
    return Response.json({
      ...install,
      nextAction: "complete",
      safeReason: null,
      rowVersion: "2",
    });
  });
  const page = createWecomPage({ api, session, storage: memoryStorage() });
  await page.start("member");
  await page.start("admin");
  expect(requests).toHaveLength(1);
  expect(page.state.unknownStart).toBe(true);
  unavailable = false;
  await page.retryStart();
  expect(await requests[0]!.json()).toEqual(await requests[1]!.json());
  unavailable = true;
  await page.complete();
  expect(page.state.mustQuery).toBe(true);
  await page.complete();
  expect(requests).toHaveLength(3);
  page.dispose();
});
// TC-SAGE-003
test("stable operation remains queryable after a failed initial result read", async () => {
  let unavailable = true;
  const { api, session, requests } = await harness(() =>
    unavailable
      ? Response.json(
          {
            code: "UNAVAILABLE",
            message: "safe",
            requestId: "synthetic-request",
            recovery: "query_original",
          },
          { status: 503 },
        )
      : Response.json(install),
  );
  const page = createWecomPage({ api, session, storage: memoryStorage() });
  await page.resume("10");
  expect(page.state.operationId).toBe("10");
  await page.start("admin");
  unavailable = false;
  await page.query();
  expect(page.state.operation?.operationId).toBe("10");
  expect(requests.every((r) => r.method === "GET")).toBe(true);
  page.dispose();
});

// TC-SAGE-003 — auth recovery never generically replays an uncertain write.
test("短token到期恢复后只沿原clientRequestId及operationId核对，不重放complete", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", memoryStorage());
  let unavailable = true;
  const h = await harness(() => {
    if (unavailable) throw new Error("unknown network result");
    return Response.json({
      ...install,
      nextAction: "complete",
      safeReason: null,
      rowVersion: "2",
    });
  });
  const storage = memoryStorage();
  let page = createWecomPage({ ...h, storage });
  await page.start("member");
  const original = await h.requests[0]!.json();
  vi.setSystemTime(Date.now() + 300_000);
  await page.retryStart();
  expect(h.session.state.phase).toBe("authenticating");
  expect(h.requests).toHaveLength(1);
  expect(storage.getItem("sage.wecom.install")).toContain(
    original.clientRequestId,
  );
  h.session.dispose();
  page.dispose();
  await h.session.callback("restored");
  page = createWecomPage({ ...h, storage });
  await page.resume();
  expect(h.requests).toHaveLength(1);
  unavailable = false;
  await page.retryStart();
  expect(await h.requests[1]!.json()).toEqual(original);
  unavailable = true;
  await page.complete();
  expect(await h.requests[2]!.json()).toEqual({ rowVersion: "2" });
  expect(page.state.mustQuery).toBe(true);
  vi.setSystemTime(Date.now() + 300_000);
  await page.query();
  expect(h.requests).toHaveLength(3);
  h.session.dispose();
  page.dispose();
  await h.session.callback("restored-again");
  page = createWecomPage({ ...h, storage });
  unavailable = false;
  await page.resume();
  expect(h.requests).toHaveLength(4);
  expect(h.requests[3]!.method).toBe("GET");
  expect(new URL(h.requests[3]!.url).pathname).toBe(
    "/api/mud/v1/wecom/install-operations/10",
  );
  page.dispose();
});

// TC-SAGE-003 — ordinary list recovery must not let an old sid reference lock out a current manager.
test("正常列表自动恢复旧操作404后先核对本空间实例，再允许显式新admin", async () => {
  const h = await harness((request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("install-operations/10"))
      return Response.json(
        {
          code: "NOT_FOUND",
          message: "safe",
          requestId: "old-sid",
          recovery: "query_original",
        },
        { status: 404 },
      );
    if (path.endsWith("channel-app-instances"))
      return Response.json({ items: [], nextCursor: null });
    return Response.json({ ...install, operationId: "11" });
  });
  const storage = memoryStorage();
  storage.setItem(
    "sage.wecom.install",
    JSON.stringify({ workspaceId: "1", operationId: "10", mustQuery: false }),
  );
  const page = createWecomPage({ ...h, storage });
  await page.resume();
  expect(page.state.forbidden).toBe(false);
  expect(page.state.operation).toBeUndefined();
  expect(page.state.operationId).toBeUndefined();
  expect(page.state.instances?.items).toEqual([]);
  expect(storage.getItem("sage.wecom.install")).toBeNull();
  expect(h.requests.map((r) => r.method)).toEqual(["GET", "GET"]);
  expect(h.session.state.session?.user.id).toBe("2");
  await page.start("admin");
  expect(h.requests).toHaveLength(3);
  expect(await h.requests[2]!.json()).toMatchObject({ mode: "admin" });
  expect(page.state.operationId).toBe("11");
  page.dispose();
});

// TC-SAGE-003
test.each(["deep-link", "query", "saved-403"])(
  "%s的操作拒绝仍阻止新create，不借普通列表恢复放宽",
  async (entry) => {
    let reject = entry !== "query";
    const h = await harness(() =>
      reject
        ? Response.json(
            {
              code: "FORBIDDEN",
              message: "safe",
              requestId: "denied",
              recovery: "query_original",
            },
            { status: entry === "saved-403" ? 403 : 404 },
          )
        : Response.json(install),
    );
    const storage = memoryStorage();
    storage.setItem(
      "sage.wecom.install",
      JSON.stringify({ workspaceId: "1", operationId: "10", mustQuery: false }),
    );
    const page = createWecomPage({ ...h, storage });
    await page.resume(entry === "saved-403" ? undefined : "10");
    if (entry === "query") {
      reject = true;
      await page.query();
    }
    await page.start("admin");
    expect(page.state.forbidden).toBe(true);
    expect(page.state.operation).toBeUndefined();
    expect(h.requests.every((r) => r.method === "GET")).toBe(true);
    expect(h.session.state.session?.user.id).toBe("2");
    page.dispose();
  },
);

// TC-SAGE-003
test.each([403, 404, 503])(
  "旧引用404后当前空间列表%s不能获得创建入口",
  async (status) => {
    const h = await harness((request) =>
      Response.json(
        {
          code: "FORBIDDEN",
          message: "safe",
          requestId: "list-denied",
          recovery: "retry",
        },
        {
          status: new URL(request.url).pathname.endsWith(
            "install-operations/10",
          )
            ? 404
            : status,
        },
      ),
    );
    const storage = memoryStorage();
    storage.setItem(
      "sage.wecom.install",
      JSON.stringify({ workspaceId: "1", operationId: "10", mustQuery: false }),
    );
    const page = createWecomPage({ ...h, storage });
    await page.resume();
    await page.start("admin");
    expect(h.requests.map((r) => r.method)).toEqual(["GET", "GET"]);
    expect(page.state.instances).toBeUndefined();
    if (status === 503) {
      expect(page.state.operationId).toBe("10");
      expect(storage.getItem("sage.wecom.install")).toContain(
        '"operationId":"10"',
      );
    } else expect(page.state.forbidden).toBe(true);
    page.dispose();
  },
);

// TC-SAGE-003
test("旧引用确认期间禁发create，迟到列表不能解除新会话限制", async () => {
  let release!: (response: Response) => void;
  const h = await harness((request) =>
    new URL(request.url).pathname.endsWith("install-operations/10")
      ? Response.json(
          {
            code: "NOT_FOUND",
            message: "safe",
            requestId: "old",
            recovery: "retry",
          },
          { status: 404 },
        )
      : new Promise((resolve) => {
          release = resolve;
        }),
  );
  const storage = memoryStorage();
  const original = JSON.stringify({
    workspaceId: "1",
    operationId: "10",
    mustQuery: false,
  });
  storage.setItem("sage.wecom.install", original);
  const page = createWecomPage({ ...h, storage });
  const resuming = page.resume();
  await vi.waitFor(() => expect(h.requests).toHaveLength(2));
  await page.start("admin");
  expect(h.requests).toHaveLength(2);
  h.session.dispose();
  release(Response.json({ items: [], nextCursor: null }));
  await resuming;
  expect(page.state.instances).toBeUndefined();
  expect(storage.getItem("sage.wecom.install")).toBe(original);
  page.dispose();
});

// TC-SAGE-003
test("跨Workspace路由继续显示拒绝且不呈现管理员接入", async () => {
  const h = await harness(() => Response.json({ items: [], nextCursor: null }));
  const html = await renderToString(
    createSSRApp(WecomWorkspace, {
      api: h.api,
      session: h.session,
      workspaceId: "3",
    }),
  );
  expect(html).toContain("无法访问此接入");
  expect(html).not.toContain("管理员接入");
  expect(h.requests).toHaveLength(0);
});

// TC-SAGE-003
test("未知create的原key在拒绝后仍保留，不能通过列表恢复换key", async () => {
  const h = await harness(() =>
    Response.json(
      {
        code: "NOT_FOUND",
        message: "safe",
        requestId: "unknown",
        recovery: "query_original",
      },
      { status: 404 },
    ),
  );
  const storage = memoryStorage();
  const original = {
    workspaceId: "1",
    pending: { clientRequestId: "original-unknown-key", mode: "admin" },
  };
  storage.setItem("sage.wecom.install", JSON.stringify(original));
  const page = createWecomPage({ ...h, storage });
  await page.resume();
  expect(h.requests).toHaveLength(0);
  await page.start("admin");
  expect(h.requests).toHaveLength(0);
  await page.retryStart();
  expect(await h.requests[0]!.json()).toEqual(original.pending);
  expect(JSON.parse(storage.getItem("sage.wecom.install")!)).toEqual(original);
  expect(page.state.forbidden).toBe(true);
  page.dispose();
});

// TC-SAGE-003
test("complete结果未知跨reload仍保留原operationId，旧404不能自动丢弃为新create", async () => {
  let mode = "create";
  const h = await harness(() => {
    if (mode === "unknown") throw new Error("network");
    if (mode === "denied")
      return Response.json(
        {
          code: "NOT_FOUND",
          message: "safe",
          requestId: "old",
          recovery: "query_original",
        },
        { status: 404 },
      );
    return Response.json({
      ...install,
      nextAction: "complete",
      rowVersion: "3",
    });
  });
  const storage = memoryStorage();
  let page = createWecomPage({ ...h, storage });
  await page.start("admin");
  mode = "unknown";
  await page.complete();
  expect(await h.requests[1]!.json()).toEqual({ rowVersion: "3" });
  expect(JSON.parse(storage.getItem("sage.wecom.install")!).mustQuery).toBe(
    true,
  );
  page.dispose();
  page = createWecomPage({ ...h, storage });
  mode = "denied";
  await page.resume();
  await page.start("admin");
  expect(h.requests).toHaveLength(3);
  expect(h.requests[2]!.method).toBe("GET");
  expect(page.state.forbidden).toBe(true);
  expect(JSON.parse(storage.getItem("sage.wecom.install")!).operationId).toBe(
    "10",
  );
  expect(JSON.parse(storage.getItem("sage.wecom.install")!).mustQuery).toBe(
    true,
  );
  page.dispose();
});

// TC-SAGE-003
test("恢复列表暂不可用后原操作重新可读，后续列表成功不能丢掉已核对操作", async () => {
  let available = false;
  const h = await harness((request) => {
    const list = new URL(request.url).pathname.endsWith(
      "channel-app-instances",
    );
    if (!available)
      return Response.json(
        {
          code: "UNAVAILABLE",
          message: "safe",
          requestId: "retry",
          recovery: "retry",
        },
        { status: list ? 503 : 404 },
      );
    return Response.json(list ? { items: [], nextCursor: null } : install);
  });
  const storage = memoryStorage();
  storage.setItem(
    "sage.wecom.install",
    JSON.stringify({ workspaceId: "1", operationId: "10", mustQuery: false }),
  );
  const page = createWecomPage({ ...h, storage });
  await page.resume();
  available = true;
  await page.query();
  await page.refreshInstances();
  expect(page.state.operationId).toBe("10");
  expect(page.state.operation?.rowVersion).toBe("1");
  expect(storage.getItem("sage.wecom.install")).toContain('"operationId":"10"');
  page.dispose();
});

// TC-SAGE-003
test("旧格式引用及明确query_original不会被当成可丢弃的普通引用", async () => {
  let denied = false;
  const h = await harness(() =>
    denied
      ? Response.json(
          {
            code: "NOT_FOUND",
            message: "safe",
            requestId: "old",
            recovery: "query_original",
          },
          { status: 404 },
        )
      : Response.json(install),
  );
  const storage = memoryStorage();
  storage.setItem(
    "sage.wecom.install",
    JSON.stringify({ workspaceId: "1", operationId: "10" }),
  );
  let page = createWecomPage({ ...h, storage });
  await page.resume();
  expect(JSON.parse(storage.getItem("sage.wecom.install")!).mustQuery).toBe(
    true,
  );
  page.dispose();
  denied = true;
  page = createWecomPage({ ...h, storage });
  await page.resume();
  expect(page.state.forbidden).toBe(true);
  expect(h.requests).toHaveLength(2);
  expect(storage.getItem("sage.wecom.install")).not.toBeNull();
  page.dispose();
  storage.setItem(
    "sage.wecom.install",
    JSON.stringify({ workspaceId: "1", operationId: "10" }),
  );
  page = createWecomPage({ ...h, storage });
  await page.resume();
  expect(page.state.forbidden).toBe(true);
  expect(h.requests).toHaveLength(3);
  expect(storage.getItem("sage.wecom.install")).not.toBeNull();
  page.dispose();
});

// TC-SAGE-003
test("complete保存待核对标记失败时不能发请求，避免留下旧false", async () => {
  const h = await harness(() =>
    Response.json({ ...install, safeReason: null, nextAction: "complete" }),
  );
  const memory = memoryStorage();
  let blocked = false;
  const storage = {
    ...memory,
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error("storage");
      memory.setItem(key, value);
    },
  };
  const page = createWecomPage({ ...h, storage });
  await page.start("admin");
  expect(JSON.parse(memory.getItem("sage.wecom.install")!).mustQuery).toBe(
    false,
  );
  blocked = true;
  await page.complete();
  expect(h.requests).toHaveLength(1);
  expect(page.state.mustQuery).toBe(true);
  expect(page.state.message).toContain("待核实");
  page.dispose();
});

// TC-SAGE-003
test("token到期在complete发送前恢复，不写假已发送标志", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", memoryStorage());
  const h = await harness(() =>
    Response.json({ ...install, safeReason: null, nextAction: "complete" }),
  );
  const storage = memoryStorage();
  const page = createWecomPage({ ...h, storage });
  await page.start("admin");
  vi.setSystemTime(Date.now() + 300_000);
  await page.complete();
  expect(h.session.state.phase).toBe("authenticating");
  expect(h.requests).toHaveLength(1);
  expect(JSON.parse(storage.getItem("sage.wecom.install")!).mustQuery).toBe(
    false,
  );
  page.dispose();
});

// TC-SAGE-003
test("显式旧深链404后返回同控制器列表须重新核对当前权限且不自动创建", async () => {
  const h = await harness((request) =>
    new URL(request.url).pathname.endsWith("channel-app-instances")
      ? Response.json({ items: [], nextCursor: null })
      : Response.json(
          {
            code: "NOT_FOUND",
            message: "safe",
            requestId: "old",
            recovery: "query_original",
          },
          { status: 404 },
        ),
  );
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("10");
  expect(page.state.forbidden).toBe(true);
  await page.resume();
  await page.start("admin");
  expect(h.requests).toHaveLength(1);
  await page.refreshInstances();
  expect(page.state.forbidden).toBe(false);
  expect(page.state.instances?.items).toEqual([]);
  expect(h.requests.map((r) => r.method)).toEqual(["GET", "GET"]);
  page.dispose();
});

// TC-SAGE-003
test("离开旧深链接时取消在途查询，迟到结果不能把正常列表改回旧操作", async () => {
  let release!: (response: Response) => void;
  const h = await harness((request) =>
    new URL(request.url).pathname.endsWith("channel-app-instances")
      ? Response.json({ items: [], nextCursor: null })
      : new Promise((resolve) => {
          release = resolve;
        }),
  );
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  const old = page.resume("10");
  await vi.waitFor(() => expect(h.requests).toHaveLength(1));
  await page.resume();
  await page.refreshInstances();
  release(Response.json(install));
  await old;
  expect(page.state.operation).toBeUndefined();
  expect(page.state.operationId).toBeUndefined();
  expect(page.state.instances?.items).toEqual([]);
  expect(h.requests.map((r) => r.method)).toEqual(["GET", "GET"]);
  page.dispose();
});
