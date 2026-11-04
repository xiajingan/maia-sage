import { expect, test, vi } from "vitest";
import { ApiFailure, createSessionController } from "../src/auth/session";
import type { GetSessionResponse } from "maia-mud-client";
const facts: GetSessionResponse = {
  rootWorkspace: { id: "1", name: "我的个人空间" },
  user: { id: "2", loginName: "lili" },
  membership: { role: "manager" },
  accessContextVersion: "v1",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const credentials = { accessToken: "access", idToken: "id", subject: "2" };
const oidc = () => ({
  signIn: vi.fn(async () => {}),
  callback: vi.fn(async () => credentials),
  clear: vi.fn(),
});
const api = () => ({
  session: vi.fn(async () => facts),
  members: vi.fn(async () => ({
    items: [{ userId: "2", loginName: "lili", role: "manager" as const }],
    nextCursor: null,
  })),
  logout: vi.fn(async () => {}),
});
// TC-SAGE-001
test("退出后完成的旧查询不能恢复个人信息", async () => {
  const late = deferred<GetSessionResponse>();
  const a = api();
  a.session.mockReturnValue(late.promise);
  const c = createSessionController({ oidc: oidc(), api: a });
  const loading = c.callback("https://localhost/auth/callback");
  await vi.waitFor(() => expect(c.state.phase).toBe("loading"));
  await c.logout();
  late.resolve(facts);
  await loading;
  expect(c.state.session).toBeUndefined();
  expect(c.state.phase).toBe("signed-out");
});
// TC-SAGE-001
test("旧登录失败不能覆盖新会话", async () => {
  const late = deferred<void>();
  const o = oidc();
  o.signIn.mockReturnValue(late.promise);
  const c = createSessionController({ oidc: o, api: api() });
  const start = c.signIn();
  await c.callback("callback");
  late.resolve();
  await start;
  expect(c.state.phase).toBe("ready");
});
// TC-SAGE-001
test("旧退出未知结果与重试不能进入新回调会话", async () => {
  const late = deferred<void>();
  const a = api();
  a.logout.mockReturnValue(late.promise);
  const c = createSessionController({ oidc: oidc(), api: a });
  await c.callback("callback");
  const leaving = c.logout();
  await c.callback("new");
  late.resolve();
  await leaving;
  await c.retryLogout();
  expect(c.state.phase).toBe("ready");
  expect(a.logout).toHaveBeenCalledTimes(1);
});
// TC-SAGE-001
test("未知退出重试固定原操作，主动登录丢弃原操作", async () => {
  const a = api();
  a.logout.mockRejectedValueOnce(new Error("network"));
  const c = createSessionController({ oidc: oidc(), api: a });
  await c.callback("callback");
  await c.logout();
  expect(c.state.phase).toBe("logout-unknown");
  const input = a.logout.mock.calls[0];
  await c.retryLogout();
  expect(a.logout.mock.calls[1]).toEqual(input);
  await c.signIn();
  await c.retryLogout();
  expect(a.logout).toHaveBeenCalledTimes(2);
});
// TC-SAGE-001
test.each([401, 403, 503])("session %s安全呈现且不保留资料", async (status) => {
  const a = api();
  a.session.mockRejectedValue(new ApiFailure(status, "request-safe"));
  const c = createSessionController({ oidc: oidc(), api: a });
  await c.callback("callback");
  expect(c.state.phase).toBe(
    status === 401 ? "signed-out" : status === 403 ? "forbidden" : "error",
  );
  expect(c.state.session).toBeUndefined();
});
// TC-SAGE-001
test("成员503保留空间并显式降级，不伪装空列表", async () => {
  const a = api();
  a.members.mockRejectedValue(new ApiFailure(503));
  const c = createSessionController({ oidc: oidc(), api: a });
  await c.callback("callback");
  expect(c.state.phase).toBe("degraded");
  expect(c.state.session?.user.id).toBe("2");
  expect(c.state.members).toBeUndefined();
});
// TC-SAGE-001
test("API主体与签名主体不一致时拒绝", async () => {
  const o = oidc();
  o.callback.mockResolvedValue({ ...credentials, subject: "3" });
  const c = createSessionController({ oidc: o, api: api() });
  await c.callback("callback");
  expect(c.state.phase).toBe("signed-out");
});
// TC-SAGE-001
test("旧callback迟到不恢复新会话；重复登录去重", async () => {
  const late = deferred<typeof credentials>();
  const o = oidc();
  o.callback.mockReturnValueOnce(late.promise);
  const c = createSessionController({ oidc: o, api: api() });
  const callback = c.callback("old");
  await c.logout();
  late.resolve(credentials);
  await callback;
  expect(c.state.phase).toBe("signed-out");
  await Promise.all([c.signIn(), c.signIn()]);
  expect(o.signIn).toHaveBeenCalledTimes(1);
});
// TC-SAGE-001
test("旧登录拒绝不能抹掉已完成的新会话", async () => {
  let reject!: (e: Error) => void;
  const o = oidc();
  o.signIn.mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  const c = createSessionController({ oidc: o, api: api() });
  const start = c.signIn();
  await c.callback("callback");
  reject(new Error("late"));
  await start;
  expect(c.state.phase).toBe("ready");
});
// TC-SAGE-001
test("已未知退出在新callback后不能重试旧撤销", async () => {
  const a = api();
  a.logout.mockRejectedValueOnce(new Error("network"));
  const c = createSessionController({ oidc: oidc(), api: a });
  await c.callback("first");
  await c.logout();
  await c.callback("new");
  await c.retryLogout();
  expect(a.logout).toHaveBeenCalledTimes(1);
  expect(c.state.phase).toBe("ready");
});
// TC-SAGE-001
test("失权错误保留安全关联编号供核对", async () => {
  const a = api();
  a.session.mockRejectedValue(new ApiFailure(403, "safe-id"));
  const c = createSessionController({ oidc: oidc(), api: a });
  await c.callback("callback");
  expect(c.state.requestId).toBe("safe-id");
});
// TC-SAGE-001
test("离页销毁内存会话但保留短期PKCE以完成顶层授权", async () => {
  const o = oidc();
  const c = createSessionController({ oidc: o, api: api() });
  await c.callback("callback");
  c.dispose();
  expect(c.state.session).toBeUndefined();
  expect(o.clear).toHaveBeenLastCalledWith(true);
});
