import { afterEach, expect, test, vi } from "vitest";
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
