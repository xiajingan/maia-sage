import type { GetWecomInstallRecoveryResponse } from "maia-mud-client";
import { afterEach, expect, test, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import WecomWorkspace from "../src/features/wecom/WecomWorkspace.vue";
import { createWecomPage } from "../src/features/wecom/wecom-page";
import {
  harness as fixtureHarness,
  install,
  memoryStorage,
} from "./fixtures/wecom";
// Existing install scenarios explicitly model that their IDs are not recovery rounds.
const harness: typeof fixtureHarness = (handle) =>
  fixtureHarness((request) =>
    new URL(request.url).pathname.includes("/install-recoveries/")
      ? Response.json(
          {
            code: "NOT_FOUND",
            message: "safe",
            requestId: "synthetic",
            recovery: "query_original",
          },
          { status: 404 },
        )
      : handle(request),
  );
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
    JSON.stringify({
      workspaceId: "1",
      operationId: "10",
      kind: "install",
      mustQuery: false,
    }),
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
      JSON.stringify({
        workspaceId: "1",
        operationId: "10",
        kind: "install",
        mustQuery: false,
      }),
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
      JSON.stringify({
        workspaceId: "1",
        operationId: "10",
        kind: "install",
        mustQuery: false,
      }),
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
    kind: "install",
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
    JSON.stringify({
      workspaceId: "1",
      operationId: "10",
      kind: "install",
      mustQuery: false,
    }),
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
  expect(h.requests).toHaveLength(3);
  expect(storage.getItem("sage.wecom.install")).not.toBeNull();
  page.dispose();
  storage.setItem(
    "sage.wecom.install",
    JSON.stringify({ workspaceId: "1", operationId: "10" }),
  );
  page = createWecomPage({ ...h, storage });
  await page.resume();
  expect(page.state.forbidden).toBe(true);
  expect(h.requests).toHaveLength(5);
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
  expect(h.requests).toHaveLength(2);
  await page.refreshInstances();
  expect(page.state.forbidden).toBe(false);
  expect(page.state.instances?.items).toEqual([]);
  expect(h.requests.map((r) => r.method)).toEqual(["GET", "GET", "GET"]);
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
  await vi.waitFor(() => expect(h.requests).toHaveLength(2));
  await page.resume();
  await page.refreshInstances();
  release(Response.json(install));
  await old;
  expect(page.state.operation).toBeUndefined();
  expect(page.state.operationId).toBeUndefined();
  expect(page.state.instances?.items).toEqual([]);
  expect(h.requests.map((r) => r.method)).toEqual(["GET", "GET", "GET"]);
  page.dispose();
});

// TC-SAGE-003 — approved recovery seam: controller + real generated adapter.
const expiredSource = {
  ...install,
  phase: "expired",
  nextAction: "start_new",
  safeReason: null,
  launch: null,
};
const recovered: GetWecomInstallRecoveryResponse = {
  ...install,
  operationId: "11",
  phase: "awaiting_authorization",
  nextAction: "authorize",
  safeReason: "administrator_identity_required",
  launch: {
    kind: "member",
    url: "https://synthetic.example/recovery-identity",
  },
  sourceOperationId: "10",
  sourceRowVersion: "1",
};
const recoverySource = {
  sourceOperationId: "10",
  rowVersion: "1",
  nextAction: "recover",
  safeReason: null,
  recovery: null,
};
const notFound = () =>
  Response.json(
    {
      code: "NOT_FOUND",
      message: "safe",
      requestId: "synthetic",
      recovery: "query_original",
    },
    { status: 404 },
  );

test("expired_result_offers_recovery", async () => {
  const h = await fixtureHarness((r) => {
    const path = new URL(r.url).pathname;
    if (path.endsWith("install-recoveries/10")) return notFound();
    if (path.endsWith("/recovery")) return Response.json(recoverySource);
    if (path.endsWith("/recover")) return Response.json(recovered);
    return Response.json(expiredSource);
  });
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("10");
  expect(page.state.source?.nextAction).toBe("recover");
  await page.recover();
  expect(page.state.operation?.operationId).toBe("11");
  expect(page.state.operation?.launch?.kind).toBe("member");
  expect(
    h.requests
      .filter((r) => r.method === "POST")
      .map((r) => new URL(r.url).pathname),
  ).toEqual(["/api/mud/v1/wecom/install-operations/10/recover"]);
  page.dispose();
});

test("recovery_identity_handoff", async () => {
  const h = await fixtureHarness(() => Response.json(recovered));
  const storage = memoryStorage();
  const writeClipboard = vi.fn(async () => {
    throw new Error("denied");
  });
  const page = createWecomPage({ ...h, storage, writeClipboard });
  await page.resume("11");
  await page.copyIdentityLink();
  expect(writeClipboard).toHaveBeenCalledWith(recovered.launch!.url);
  expect(page.state.handoffFallback).toBe(true);
  expect(page.authorizationUrl()).toBe(recovered.launch!.url);
  expect(storage.getItem("sage.wecom.install")).not.toContain(
    "synthetic.example",
  );
  expect(h.requests).toHaveLength(1);
  h.session.dispose();
  expect(page.authorizationUrl()).toBeUndefined();
  expect(page.state.handoffFallback).toBe(false);
  page.dispose();
});

test("recovery_expires_again", async () => {
  let round = 11;
  const h = await fixtureHarness((r) => {
    const p = new URL(r.url).pathname;
    if (r.method === "POST")
      return Response.json({ ...recovered, operationId: String(round++) });
    if (p.includes("install-recoveries/"))
      return Response.json({
        ...recovered,
        phase: "expired",
        nextAction: "recover",
        launch: null,
        sourceRowVersion: "3",
      });
    return notFound();
  });
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("11");
  await page.recover();
  await page.query();
  await page.recover();
  const posts = h.requests.filter((r) => r.method === "POST");
  expect(posts.map((r) => new URL(r.url).pathname)).toEqual([
    "/api/mud/v1/wecom/install-operations/10/recover",
    "/api/mud/v1/wecom/install-operations/10/recover",
  ]);
  const bodies = await Promise.all(posts.map((r) => r.json()));
  expect(bodies[0].rowVersion).toBe("3");
  expect(bodies[1].clientRequestId).not.toBe(bodies[0].clientRequestId);
  page.dispose();
});

test("recovery_create_unknown_queries_original_key", async () => {
  let lost = true;
  const h = await fixtureHarness((r) => {
    const p = new URL(r.url).pathname;
    if (p.endsWith("/recover")) {
      if (lost) {
        lost = false;
        throw new Error("lost response");
      }
      return Response.json(recovered);
    }
    if (p.endsWith("/recovery")) return Response.json(recoverySource);
    if (p.includes("install-recoveries/")) return notFound();
    return Response.json(expiredSource);
  });
  const storage = memoryStorage();
  const page = createWecomPage({ ...h, storage });
  await page.resume("10");
  await page.recover();
  expect(page.state.unknownRecovery).toBe(true);
  const original = await h.requests.find((r) => r.method === "POST")!.json();
  await page.recover();
  await page.retryRecovery();
  const posts = h.requests.filter((r) => r.method === "POST");
  expect(posts).toHaveLength(2);
  expect(await posts[1]!.json()).toEqual(original);
  expect(
    new URL(h.requests.at(-2)!.url).searchParams.get("clientRequestId"),
  ).toBe(original.clientRequestId);
  expect(page.state.kind).toBe("recovery");
  expect(storage.getItem("sage.wecom.install")).not.toContain(
    "recoveryPending",
  );
  page.dispose();
});

test("recovery_conflict_ends_key_intent_and_queries_current_without_alias", async () => {
  const h = await fixtureHarness((r) => {
    const p = new URL(r.url).pathname;
    if (p.endsWith("/recover"))
      return Response.json(
        {
          code: "CONFLICT",
          message: "safe",
          requestId: "synthetic",
          recovery: "query_original",
        },
        { status: 409 },
      );
    if (p.endsWith("/recovery"))
      return Response.json({
        ...recoverySource,
        nextAction: "query_original",
        recovery: recovered,
      });
    if (p.includes("install-recoveries/"))
      return Response.json({
        ...recovered,
        phase: "expired",
        nextAction: "recover",
        launch: null,
      });
    return Response.json(expiredSource);
  });
  const storage = memoryStorage();
  const page = createWecomPage({ ...h, storage });
  await page.resume("11");
  await page.recover();
  const key = (await h.requests.find((r) => r.method === "POST")!.json())
    .clientRequestId;
  expect(
    new URL(h.requests.at(-1)!.url).searchParams.has("clientRequestId"),
  ).toBe(false);
  expect(storage.getItem("sage.wecom.install")).not.toContain(key);
  expect(page.state.unknownRecovery).toBe(false);
  await page.query();
  await page.retryRecovery();
  expect(h.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  await page.recover();
  expect(
    (await h.requests.filter((r) => r.method === "POST")[1]!.json())
      .clientRequestId,
  ).not.toBe(key);
  page.dispose();
});

test("recovery_reload_without_storage", async () => {
  const h = await fixtureHarness((r) => {
    const p = new URL(r.url).pathname;
    if (p.endsWith("install-recoveries/11")) return Response.json(recovered);
    if (p.endsWith("install-recoveries/12"))
      return Response.json(
        {
          code: "UNAVAILABLE",
          message: "safe",
          requestId: "synthetic",
          recovery: "query_original",
        },
        { status: 503 },
      );
    if (p.includes("install-recoveries/")) return notFound();
    return Response.json(install);
  });
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("11");
  expect(page.state.kind).toBe("recovery");
  await page.resume("12");
  expect(page.state.operation).toBeUndefined();
  expect(h.requests.map((r) => new URL(r.url).pathname)).toEqual([
    "/api/mud/v1/wecom/install-recoveries/11",
    "/api/mud/v1/wecom/install-recoveries/12",
  ]);
  await page.resume("10");
  expect(h.requests.slice(-2).map((r) => new URL(r.url).pathname)).toEqual([
    "/api/mud/v1/wecom/install-recoveries/10",
    "/api/mud/v1/wecom/install-operations/10",
  ]);
  page.dispose();
});

test("recovery_discovery_queries_current_round", async () => {
  const h = await fixtureHarness((r) => {
    const p = new URL(r.url).pathname;
    if (p.includes("install-recoveries/")) return notFound();
    if (p.endsWith("/recovery"))
      return Response.json({
        ...recoverySource,
        nextAction: "query_original",
        recovery: recovered,
      });
    return Response.json(expiredSource);
  });
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("10");
  expect(page.state.operation?.operationId).toBe("11");
  expect(page.state.kind).toBe("recovery");
  expect(h.requests.every((r) => r.method === "GET")).toBe(true);
  page.dispose();
});

test("recovery_stale_response_and_source_expired", async () => {
  let release!: (r: Response) => void;
  const h = await fixtureHarness((r) => {
    const p = new URL(r.url).pathname;
    if (p.endsWith("/recovery"))
      return Response.json({
        ...recoverySource,
        nextAction: "none",
        safeReason: "recovery_source_expired",
      });
    if (p.endsWith("install-recoveries/11"))
      return new Promise((resolve) => {
        release = resolve;
      });
    if (p.includes("install-recoveries/")) return notFound();
    return Response.json(expiredSource);
  });
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("10");
  await page.recover();
  expect(page.state.source?.nextAction).toBe("none");
  expect(h.requests.every((r) => r.method === "GET")).toBe(true);
  const loading = page.resume("11");
  await vi.waitFor(() =>
    expect(h.requests.at(-1)?.url).toContain("install-recoveries/11"),
  );
  h.session.dispose();
  release(Response.json(recovered));
  await loading;
  expect(page.state.operation).toBeUndefined();
  expect(page.authorizationUrl()).toBeUndefined();
  page.dispose();
});

test.each(["session", "query", "expiry"])(
  "recovery_identity_handoff_late_failure_%s",
  async (change) => {
    vi.useFakeTimers();
    let resolve!: () => void;
    let current: GetWecomInstallRecoveryResponse = {
      ...recovered,
      expiresAt: Date.now() + 1000,
    };
    const h = await fixtureHarness(() => Response.json(current));
    const writeClipboard = () =>
      new Promise<void>((_r, reject) => {
        resolve = () => reject(new Error("denied"));
      });
    const page = createWecomPage({
      ...h,
      storage: memoryStorage(),
      writeClipboard,
    });
    await page.resume("11");
    const copying = page.copyIdentityLink();
    if (change === "session") h.session.dispose();
    if (change === "query") {
      current = { ...current, launch: null, nextAction: "query_original" };
      await page.query();
    }
    if (change === "expiry") await vi.advanceTimersByTimeAsync(1001);
    resolve();
    await copying;
    expect(page.state.handoffFallback).toBe(false);
    expect(page.state.handoffMessage).toBeUndefined();
    expect(page.authorizationUrl()).toBeUndefined();
    page.dispose();
  },
);

test("recovery_unknown_reload_finds_exact_key_without_reposting", async () => {
  let key: string | undefined;
  const h = await fixtureHarness(async (r) => {
    const u = new URL(r.url);
    if (r.method === "POST") {
      key = (await r.json()).clientRequestId;
      throw new Error("lost");
    }
    if (u.pathname.endsWith("/recovery"))
      return Response.json(
        u.searchParams.get("clientRequestId") === key
          ? { ...recoverySource, recovery: recovered }
          : recoverySource,
      );
    if (u.pathname.includes("install-recoveries/")) return notFound();
    return Response.json(expiredSource);
  });
  const storage = memoryStorage();
  let page = createWecomPage({ ...h, storage });
  await page.resume("10");
  await page.recover();
  page.dispose();
  page = createWecomPage({ ...h, storage });
  await page.resume("10");
  expect(page.state.unknownRecovery).toBe(true);
  await page.retryRecovery();
  expect(page.state.operation?.operationId).toBe("11");
  expect(h.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  expect(
    new URL(h.requests.at(-1)!.url).searchParams.get("clientRequestId"),
  ).toBe(key);
  page.dispose();
});

test("recovery_runtime_schemas_and_only_not_found_fallback", async () => {
  const h = await fixtureHarness(() => Response.json(install));
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("11");
  expect(page.state.operation).toBeUndefined();
  expect(h.requests).toHaveLength(1); // Old view is invalid on the recovery endpoint.
  page.dispose();
  const invalid404 = await fixtureHarness(() =>
    Response.json(
      {
        code: "FORBIDDEN",
        message: "safe",
        requestId: "synthetic",
        recovery: "query_original",
      },
      { status: 404 },
    ),
  );
  const other = createWecomPage({ ...invalid404, storage: memoryStorage() });
  await other.resume("11");
  expect(invalid404.requests).toHaveLength(1);
  other.dispose();
});

test("recovery_complete_uses_own_endpoint_then_unknown_only_queries", async () => {
  const h = await fixtureHarness((r) =>
    r.method === "POST"
      ? Response.json(
          {
            code: "RESULT_UNKNOWN",
            message: "safe",
            requestId: "synthetic",
            recovery: "query_original",
          },
          { status: 503 },
        )
      : Response.json({ ...recovered, launch: null, nextAction: "complete" }),
  );
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("11");
  await page.complete();
  await page.complete();
  expect(page.state.mustQuery).toBe(true);
  await page.query();
  expect(h.requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
    ["GET", "/api/mud/v1/wecom/install-recoveries/11"],
    ["POST", "/api/mud/v1/wecom/install-recoveries/11/complete"],
    ["GET", "/api/mud/v1/wecom/install-recoveries/11"],
  ]);
  page.dispose();
});

test("recovery_unknown_second_round_retries_exact_body_without_losing_intent", async () => {
  let lost = true;
  const h = await fixtureHarness((r) => {
    if (r.method === "POST") {
      if (lost) {
        lost = false;
        throw new Error("lost");
      }
      return Response.json(recovered);
    }
    if (new URL(r.url).pathname.endsWith("/recovery"))
      return Response.json(recoverySource);
    return Response.json({
      ...recovered,
      phase: "expired",
      nextAction: "recover",
      launch: null,
    });
  });
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("11");
  await page.recover();
  await page.retryRecovery();
  const posts = h.requests.filter((r) => r.method === "POST");
  expect(posts).toHaveLength(2);
  expect(await posts[1]!.json()).toEqual(await posts[0]!.json());
  page.dispose();
});

test("recovery_query_of_unknown_intent_never_resends_create", async () => {
  const h = await fixtureHarness((r) => {
    const p = new URL(r.url).pathname;
    if (r.method === "POST") throw new Error("unknown");
    if (p.endsWith("/recovery")) return Response.json(recoverySource);
    return Response.json({
      ...recovered,
      phase: "expired",
      nextAction: "recover",
      launch: null,
    });
  });
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("11");
  await page.recover();
  await page.query();
  expect(page.state.unknownRecovery).toBe(true);
  expect(h.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  page.dispose();
});

test("recovery_short_token_navigation_hides_old_launch_before_pagehide", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", memoryStorage());
  const h = await fixtureHarness(() => Response.json(recovered));
  const page = createWecomPage({
    ...h,
    storage: memoryStorage(),
    writeClipboard: async () => {
      throw new Error("denied");
    },
  });
  await page.resume("11");
  await page.copyIdentityLink();
  expect(page.state.handoffFallback).toBe(true);
  vi.setSystemTime(Date.now() + 296_000);
  await page.query();
  expect(h.session.state.phase).toBe("authenticating");
  expect(h.requests).toHaveLength(1);
  expect(page.authorizationUrl()).toBeUndefined();
  expect(page.state.handoffFallback).toBe(false);
  page.dispose();
});

test.each(["root", "session"])(
  "recovery_old_query_and_clipboard_cannot_restore_after_%s_change",
  async (change) => {
    let reads = 0;
    let release!: (r: Response) => void;
    let rejectCopy!: (error: Error) => void;
    const h = await fixtureHarness(() =>
      ++reads === 1
        ? Response.json(recovered)
        : new Promise((resolve) => {
            release = resolve;
          }),
    );
    const page = createWecomPage({
      ...h,
      storage: memoryStorage(),
      writeClipboard: () =>
        new Promise((_resolve, reject) => {
          rejectCopy = reject;
        }),
    });
    await page.resume("11");
    const copying = page.copyIdentityLink();
    const querying = page.query();
    await vi.waitFor(() => expect(reads).toBe(2));
    if (change === "root")
      vi.spyOn(h.api, "session").mockResolvedValue({
        ...h.session.state.session!,
        rootWorkspace: { id: "9", name: "另一合成空间" },
      });
    await h.session.callback("another-synthetic-session-generation");
    release(Response.json(recovered));
    rejectCopy(new Error("denied"));
    await Promise.all([copying, querying]);
    expect(page.state.operation).toBeUndefined();
    expect(page.state.handoffFallback).toBe(false);
    expect(page.authorizationUrl()).toBeUndefined();
    page.dispose();
  },
);

test("recovery_forbidden_clears_launch_and_fallback", async () => {
  let forbidden = false;
  const h = await fixtureHarness(() =>
    forbidden
      ? Response.json(
          {
            code: "FORBIDDEN",
            message: "safe",
            requestId: "synthetic",
            recovery: "query_original",
          },
          { status: 403 },
        )
      : Response.json(recovered),
  );
  const page = createWecomPage({
    ...h,
    storage: memoryStorage(),
    writeClipboard: async () => {
      throw new Error("denied");
    },
  });
  await page.resume("11");
  await page.copyIdentityLink();
  forbidden = true;
  await page.query();
  expect(page.state.forbidden).toBe(true);
  expect(page.state.handoffFallback).toBe(false);
  expect(page.authorizationUrl()).toBeUndefined();
  page.dispose();
});

test("recovery_legacy_fallback_dispatch_rechecks_short_token", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", memoryStorage());
  const h = await fixtureHarness(() => {
    vi.setSystemTime(Date.now() + 296_000);
    return notFound();
  });
  const page = createWecomPage({ ...h, storage: memoryStorage() });
  await page.resume("10");
  expect(h.requests).toHaveLength(1);
  expect(h.session.state.phase).toBe("authenticating");
  expect(page.state.operation).toBeUndefined();
  page.dispose();
});
