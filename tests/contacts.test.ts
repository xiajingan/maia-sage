import { afterEach, expect, test, vi } from "vitest";
import { createContactPage } from "../src/features/contacts/contact-page";
import { contacts, harness } from "./fixtures/wecom";
afterEach(() => vi.restoreAllMocks());
test("已证实范围变化后从首页重读，丢弃滞后的旧版本直至新范围可读", async () => {
  let scopeVersion = "1";
  const h = await harness(() => Response.json({ ...contacts, scopeVersion }));
  const page = createContactPage(h);
  await page.select("1", "20");
  await page.refresh("page-two");
  const recheck = page.refreshAfterScopeChange("1");
  expect(page.state.page).toBeUndefined();
  expect(page.state.cursor).toBeUndefined();
  await recheck;
  expect(new URL(h.requests.at(-1)!.url).searchParams.has("cursor")).toBe(
    false,
  );
  expect(page.state.page).toBeUndefined();
  expect(page.state.message).toContain("范围");
  await page.refresh();
  expect(page.state.page).toBeUndefined();
  scopeVersion = "2";
  await page.refresh();
  expect(page.state.page?.scopeVersion).toBe("2");
  page.dispose();
});

// TC-SAGE-003
test("contact_partial_and_permissions", async () => {
  let deny = false;
  let resolve!: (response: Response) => void;
  let hold = false;
  const { api, session } = await harness(() =>
    hold
      ? new Promise<Response>((r) => {
          resolve = r;
        })
      : deny
        ? Response.json(
            {
              code: "FORBIDDEN",
              message: "安全拒绝",
              requestId: "synthetic-request",
              recovery: "核对权限",
            },
            { status: 403 },
          )
        : Response.json(contacts),
  );
  const page = createContactPage({ api, session });
  await page.select("1", "20");
  expect(page.state.page?.sync?.coverage).toBe("partial");
  expect(page.state.page?.items[0]?.sourceId).toBe("synthetic-member");
  deny = true;
  await page.refresh();
  expect(page.state.page).toBeUndefined();
  expect(page.state.forbidden).toBe(true);
  expect(session.state.phase).toBe("ready");
  deny = false;
  await page.select("1", "20");
  hold = true;
  const late = page.refresh();
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  await page.select("9", "21");
  resolve(Response.json(contacts));
  await late;
  expect(page.state.page).toBeUndefined();
  page.dispose();
});
// TC-SAGE-003
test("pagination and unknown sync retain the original request, a newer scope invalidates old reads", async () => {
  let unknown = true;
  let hold = false;
  let finish!: (response: Response) => void;
  const { api, session, requests } = await harness((request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "POST")
      return unknown
        ? Response.json(
            {
              code: "RESULT_UNKNOWN",
              message: "safe",
              requestId: "synthetic-request",
              recovery: "query_original",
            },
            { status: 503 },
          )
        : Response.json({ ...contacts.sync, scopeVersion: "2" });
    if (path.includes("contact-syncs"))
      return Response.json({ ...contacts.sync, scopeVersion: "2" });
    if (hold)
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    return Response.json(contacts);
  });
  const page = createContactPage({ api, session });
  await page.select("1", "20");
  await page.refresh("second");
  expect(new URL(requests.at(-1)!.url).searchParams.get("cursor")).toBe(
    "second",
  );
  expect(new URL(requests.at(-1)!.url).searchParams.get("limit")).toBe("20");
  await page.requestSync();
  expect(page.state.unknownSync).toBe(true);
  const original = requests.at(-1)!;
  unknown = false;
  await page.retrySync();
  expect(await original.json()).toEqual(await requests.at(-1)!.json());
  expect(page.state.page).toBeUndefined();
  hold = true;
  const late = page.refresh();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await page.querySync();
  finish(Response.json(contacts));
  await late;
  expect(page.state.page).toBeUndefined();
  expect(page.state.loading).toBe(false);
  page.dispose();
});
// TC-SAGE-003
test("pending access cannot submit sync and is not an empty complete directory", async () => {
  const { api, session, requests } = await harness(() =>
    Response.json({
      ...contacts,
      accessState: "pending_verification",
      safeReason: "scope_reverification_required",
      sync: null,
    }),
  );
  const page = createContactPage({ api, session });
  await page.select("1", "20");
  expect(page.state.page?.items).toEqual([]);
  expect(page.state.page?.accessState).toBe("pending_verification");
  await page.requestSync();
  expect(requests.every((r) => r.method === "GET")).toBe(true);
  page.dispose();
});
// TC-SAGE-003
test.each([
  ["pending_verification", "provider_invalid_response", "failed", true],
  ["pending_verification", "provider_invalid_response", "running", false],
  ["pending_verification", "authorization_revoked", "failed", false],
  ["disabled", "provider_invalid_response", "failed", false],
] as const)(
  "a manager's retry respects contact access %s, reason %s and sync phase %s",
  async (accessState, safeReason, phase, retryAllowed) => {
    const oldSync = {
      ...contacts.sync,
      phase,
      coverage: "pending",
      safeReason: "provider_invalid_response",
    };
    const newSync = {
      ...oldSync,
      syncId: "41",
      phase: "planned",
      safeReason: null,
    };
    const { api, session, requests } = await harness((request) =>
      request.method === "POST"
        ? Response.json(newSync)
        : Response.json({ ...contacts, accessState, safeReason, sync: oldSync }),
    );
    const page = createContactPage({ api, session });
    await page.select("1", "20");
    await page.requestSync();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(
      retryAllowed ? 1 : 0,
    );
    expect(page.state.sync).toEqual(retryAllowed ? newSync : oldSync);
    expect(page.state.page?.items).toEqual([]);
    page.dispose();
  },
);
// TC-SAGE-003
test("a late old unauthorized response cannot clear a new session", async () => {
  let finish!: (response: Response) => void;
  const { api, session } = await harness(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const page = createContactPage({ api, session });
  const late = page.select("1", "20");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await session.callback("new-session");
  finish(
    Response.json(
      {
        code: "UNAUTHENTICATED",
        message: "safe",
        requestId: "synthetic-request",
        recovery: "login",
      },
      { status: 401 },
    ),
  );
  await late;
  expect(session.state.phase).toBe("ready");
  expect(page.state.page).toBeUndefined();
  page.dispose();
});
// TC-SAGE-003
test.each([401, 404])(
  "current resource %s clears contacts with the appropriate session boundary",
  async (status) => {
    let rejected = false;
    const { api, session } = await harness(() =>
      rejected
        ? Response.json(
            {
              code: status === 401 ? "UNAUTHENTICATED" : "NOT_FOUND",
              message: "safe",
              requestId: "synthetic-request",
              recovery: "check",
            },
            { status },
          )
        : Response.json(contacts),
    );
    const page = createContactPage({ api, session });
    await page.select("1", "20");
    rejected = true;
    await page.refresh();
    expect(page.state.page).toBeUndefined();
    expect(session.state.phase).toBe(status === 401 ? "signed-out" : "ready");
    expect(page.state.forbidden).toBe(status === 404);
    page.dispose();
  },
);
// TC-SAGE-003
test("generated contract rejects a contact carrying an extracted name", async () => {
  const { api, session } = await harness(() =>
    Response.json({
      ...contacts,
      items: [{ ...contacts.items[0], name: "synthetic-extracted-name" }],
    }),
  );
  const page = createContactPage({ api, session });
  await page.select("1", "20");
  expect(page.state.page).toBeUndefined();
  expect(page.state.message).toContain("停止显示旧资料");
  page.dispose();
});

// TC-SAGE-003
test.each([
  {
    title: "different scope and sync",
    scopeVersion: "2",
    syncId: "41",
    rowVersion: "1",
  },
  {
    title: "same scope, replaced sync",
    scopeVersion: "1",
    syncId: "41",
    rowVersion: "1",
  },
  {
    title: "same scope and sync, replaced rowVersion",
    scopeVersion: "1",
    syncId: "40",
    rowVersion: "2",
  },
])(
  "older sync query cannot replace accepted page facts: $title",
  async ({ scopeVersion, syncId, rowVersion }) => {
    let latest = false;
    let finish!: (response: Response) => void;
    const latestSync = {
      ...contacts.sync!,
      scopeVersion,
      syncId,
      rowVersion,
      phase: "running" as const,
    };
    const latestPage = { ...contacts, scopeVersion, sync: latestSync };
    const { api, session } = await harness((request) =>
      new URL(request.url).pathname.includes("contact-syncs")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Response.json(latest ? latestPage : contacts),
    );
    const page = createContactPage({ api, session });
    await page.select("1", "20");
    const old = page.querySync();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    latest = true;
    await page.refresh();
    expect(page.state.sync).toEqual(latestSync);
    finish(
      Response.json({
        ...contacts.sync,
        phase: "completed",
        coverage: "complete",
      }),
    );
    await old;
    expect(page.state.page).toEqual(latestPage);
    expect(page.state.sync).toEqual(latestSync);
    expect(page.state.syncing).toBe(false);
    expect(page.state.loading).toBe(false);
    page.dispose();
  },
);
// TC-SAGE-003
test("older sync query failure cannot annotate a replacement page", async () => {
  let latest = false;
  let finish!: (response: Response) => void;
  const restrictedPage = {
    ...contacts,
    scopeVersion: "2",
    accessState: "pending_verification" as const,
    safeReason: "scope_reverification_required",
    sync: null,
    items: [],
  };
  const { api, session } = await harness((request) =>
    new URL(request.url).pathname.includes("contact-syncs")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Response.json(latest ? restrictedPage : contacts),
  );
  const page = createContactPage({ api, session });
  await page.select("1", "20");
  const old = page.querySync();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  latest = true;
  await page.refresh();
  finish(
    Response.json(
      {
        code: "UNAVAILABLE",
        message: "safe",
        requestId: "old-query",
        recovery: "query_original",
      },
      { status: 503 },
    ),
  );
  await old;
  expect(page.state.page).toEqual(restrictedPage);
  expect(page.state.sync).toBeUndefined();
  expect(page.state.syncMessage).toBeUndefined();
  expect(page.state.requestId).toBeUndefined();
  expect(page.state.syncing).toBe(false);
  expect(page.state.loading).toBe(false);
  page.dispose();
});

// TC-SAGE-003
test("rechecking an unknown original sync confirms its key without replacing later page facts", async () => {
  let latest = false;
  let unknown = true;
  const latestSync = {
    ...contacts.sync!,
    syncId: "41",
    scopeVersion: "2",
    phase: "running" as const,
  };
  const latestPage = { ...contacts, scopeVersion: "2", sync: latestSync };
  const { api, session, requests } = await harness((request) =>
    request.method === "POST"
      ? unknown
        ? Response.json(
            {
              code: "RESULT_UNKNOWN",
              message: "safe",
              requestId: "original-sync",
              recovery: "query_original",
            },
            { status: 503 },
          )
        : Response.json({
            ...contacts.sync,
            phase: "completed",
            coverage: "complete",
          })
      : Response.json(latest ? latestPage : contacts),
  );
  const page = createContactPage({ api, session });
  await page.select("1", "20");
  await page.requestSync();
  expect(page.state.unknownSync).toBe(true);
  const original = requests.at(-1)!;
  latest = true;
  await page.refresh();
  unknown = false;
  await page.retrySync();
  expect(await requests.at(-1)!.json()).toEqual(await original.json());
  expect(page.state.unknownSync).toBe(false);
  expect(page.state.page).toEqual(latestPage);
  expect(page.state.sync).toEqual(latestSync);
  expect(page.state.syncing).toBe(false);
  page.dispose();
});
// TC-SAGE-003
test.each([401, 403])(
  "current sync query %s retains the existing permission cleanup",
  async (status) => {
    const { api, session } = await harness((request) =>
      new URL(request.url).pathname.includes("contact-syncs")
        ? Response.json(
            {
              code: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
              message: "safe",
              requestId: "current-sync",
              recovery: "check",
            },
            { status },
          )
        : Response.json(contacts),
    );
    const page = createContactPage({ api, session });
    await page.select("1", "20");
    await page.querySync();
    expect(page.state.page).toBeUndefined();
    expect(page.state.sync).toBeUndefined();
    expect(page.state.forbidden).toBe(status === 403);
    expect(session.state.phase).toBe(status === 401 ? "signed-out" : "ready");
    expect(page.state.syncing).toBe(false);
    page.dispose();
  },
);

// TC-SAGE-003
test("a current denial while rechecking an old sync still clears replacement page data", async () => {
  let latest = false;
  const { api, session } = await harness((request) =>
    request.method === "POST"
      ? Response.json(
          {
            code: latest ? "FORBIDDEN" : "RESULT_UNKNOWN",
            message: "safe",
            requestId: "sync-recheck",
            recovery: "check",
          },
          { status: latest ? 403 : 503 },
        )
      : Response.json(
          latest
            ? {
                ...contacts,
                scopeVersion: "2",
                sync: { ...contacts.sync!, syncId: "41", scopeVersion: "2" },
              }
            : contacts,
        ),
  );
  const page = createContactPage({ api, session });
  await page.select("1", "20");
  await page.requestSync();
  expect(page.state.unknownSync).toBe(true);
  latest = true;
  await page.refresh();
  await page.retrySync();
  expect(page.state.forbidden).toBe(true);
  expect(page.state.page).toBeUndefined();
  expect(page.state.sync).toBeUndefined();
  expect(session.state.phase).toBe("ready");
  expect(page.state.syncing).toBe(false);
  page.dispose();
});
