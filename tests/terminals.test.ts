import { afterEach, expect, test, vi } from "vitest";
import { createMudApi } from "../src/api/mud";
import { ApiFailure, createSessionController } from "../src/auth/session";
import { createTerminalPage } from "../src/features/terminals/terminal-page";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// TC-SAGE-002
test("生成客户端发送空 JSON 和 Bearer，拒绝不符合契约的响应", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ code: "示例", expiresAt: 12 }, { status: 201 }),
    );
  await expect(
    createMudApi("https://localhost").issueTerminalActivation(
      "access",
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  const request = fetch.mock.calls[0]?.[0] as Request;
  expect(new URL(request.url).pathname).toBe(
    "/api/mud/v1/terminal-activations",
  );
  expect(request.method).toBe("POST");
  expect(request.headers.get("authorization")).toBe("Bearer access");
  expect(await request.json()).toEqual({});
});

// TC-SAGE-002
test("关闭、超时和离开清除一次性码，迟到的签发不能恢复显示", async () => {
  vi.useFakeTimers();
  const result = {
    code: "sample",
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  };
  let finish!: (value: typeof result) => void;
  const issue = vi.fn(
    () =>
      new Promise<typeof result>((resolve) => {
        finish = resolve;
      }),
  );
  const page = createTerminalPage({
    issueTerminalActivation: issue,
    listTerminals: async () => ({ items: [], nextCursor: null }),
  });
  const late = page.issue();
  await page.issue();
  expect(issue).toHaveBeenCalledTimes(1);
  page.closeActivation();
  finish(result);
  await late;
  expect(page.activation.value).toBeUndefined();
  const open = page.issue();
  finish(result);
  await open;
  expect(page.activation.value).toEqual(result);
  await vi.advanceTimersByTimeAsync(1000);
  expect(page.activation.value).toBeUndefined();
  expect(page.activationExpired.value).toBe(true);
  const leaving = page.issue();
  page.dispose();
  finish({ ...result, expiresAt: new Date(Date.now() + 1000).toISOString() });
  await leaving;
  expect(page.activation.value).toBeUndefined();
});

// TC-SAGE-002
test("轮询达到上限后停止，页面离开时丢弃旧列表", async () => {
  vi.useFakeTimers();
  const list = vi.fn(async () => ({ items: [], nextCursor: null }));
  const page = createTerminalPage({
    listTerminals: list,
    issueTerminalActivation: async () => undefined,
  });
  await page.refresh();
  await vi.runAllTimersAsync();
  expect(list).toHaveBeenCalledTimes(61);
  expect(vi.getTimerCount()).toBe(0);

  let finish!: (value: { items: []; nextCursor: null }) => void;
  const leaving = createTerminalPage({
    listTerminals: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    issueTerminalActivation: async () => undefined,
  });
  const pending = leaving.refresh();
  leaving.dispose();
  finish({ items: [], nextCursor: null });
  await pending;
  expect(leaving.result.value).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

// TC-SAGE-002
test("旧会话终端请求的拒绝不会撤销新会话", async () => {
  let reject!: (error: unknown) => void;
  const api = createMudApi("https://localhost");
  const controller = createSessionController({
    oidc: {
      signIn: async () => {},
      callback: async (subject) => ({
        subject,
        accessToken: subject,
        idToken: "id",
      }),
      clear: () => {},
    },
    api: {
      ...api,
      session: async (id) => ({
        rootWorkspace: { id, name: "个人工作空间" },
        user: { id, loginName: id },
        membership: { role: "manager" },
        accessContextVersion: "1",
      }),
      members: async () => ({ items: [], nextCursor: null }),
      listTerminals: () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    },
  });
  await controller.callback("1");
  const pending = controller.listTerminals(
    undefined,
    new AbortController().signal,
  );
  await controller.callback("2");
  reject(new ApiFailure(403));
  await expect(pending).resolves.toBeUndefined();
  expect(controller.state.session?.user.id).toBe("2");
});
