import { afterEach, expect, test, vi } from "vitest";
import { createContactPage } from "../src/features/contacts/contact-page";
import { contacts, harness } from "./fixtures/wecom";
afterEach(() => vi.restoreAllMocks());
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
