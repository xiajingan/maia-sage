import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
  ApiFailure,
  createSessionController,
  type Api,
} from "../src/auth/session";
import type { GetSessionResponse } from "maia-mud-client";
import { memoryStorage } from "./fixtures/wecom";
beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
afterEach(() => vi.unstubAllGlobals());
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
const credentials = {
  accessToken: "access",
  idToken: "id",
  subject: "2",
  expiresAt: Date.now() + 300_000,
};
const oidc = () => ({
  signIn: vi.fn(async () => {}),
  callback: vi.fn(async () => credentials),
  clear: vi.fn(),
});
const api = () => ({
  listTerminals: async () => ({ items: [], nextCursor: null }),
  issueTerminalActivation: async () => ({
    code: "sample",
    expiresAt: "2030-01-01T00:00:00.000Z",
  }),
  session: vi.fn(async () => facts),
  members: vi.fn(async () => ({
    items: [{ userId: "2", loginName: "lili", role: "manager" as const }],
    nextCursor: null,
  })),
  logout: vi.fn<Api["logout"]>(async () => {}),
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
  const input = a.logout.mock.calls[0]?.[0];
  await c.retryLogout();
  expect(a.logout.mock.calls[1]?.[0]).toEqual(input);
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
// TC-SAGE-001
test.each([new ApiFailure(503), new Error("network"), new ApiFailure(0)])(
  "已认证读取错误仍可主动退出并撤销原会话",
  async (error) => {
    const a = api();
    a.session.mockRejectedValueOnce(error);
    const c = createSessionController({ oidc: oidc(), api: a });
    await c.callback("callback");
    expect(c.state.phase).toBe("error");
    expect(c.state.canLogout).toBe(true);
    await c.logout();
    expect(a.logout).toHaveBeenCalledTimes(1);
    expect(c.state.phase).toBe("signed-out");
    expect(c.state.canLogout).toBe(false);
  },
);
// TC-SAGE-001
test("不结算的退出在10秒后进入待核实，保留原操作重试", async () => {
  vi.useFakeTimers();
  try {
    const a = api();
    a.logout.mockReturnValueOnce(new Promise(() => {}));
    const c = createSessionController({ oidc: oidc(), api: a });
    await c.callback("callback");
    const leaving = c.logout();
    expect(c.state.phase).toBe("logout-pending");
    await vi.advanceTimersByTimeAsync(10000);
    expect(c.state.phase).toBe("logout-unknown");
    await leaving;
    const original = a.logout.mock.calls[0];
    await c.retryLogout();
    expect(c.state.phase).toBe("signed-out");
    expect(a.logout.mock.calls[1]?.[0]).toEqual(original?.[0]);
  } finally {
    vi.useRealTimers();
  }
});
// TC-SAGE-001
test("超时退出的晚到结果不能影响新登录或重试旧操作", async () => {
  vi.useFakeTimers();
  try {
    const late = deferred<void>();
    const a = api();
    a.logout.mockReturnValueOnce(late.promise);
    const c = createSessionController({ oidc: oidc(), api: a });
    await c.callback("first");
    const leaving = c.logout();
    await vi.advanceTimersByTimeAsync(10000);
    await leaving;
    await c.callback("new");
    late.resolve();
    await Promise.resolve();
    await c.retryLogout();
    expect(c.state.phase).toBe("ready");
    expect(a.logout).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

// TC-SAGE-003
test("business return path is released only by the current successful callback", async () => {
  const currentOidc = oidc();
  currentOidc.callback.mockResolvedValue(
    Object.assign(
      { ...credentials },
      { returnPath: "/workspaces/1/wecom/install-operations/10" },
    ),
  );
  const controller = createSessionController({ oidc: currentOidc, api: api() });
  expect(await controller.callback("current")).toBe(
    "/workspaces/1/wecom/install-operations/10",
  );
  const late = deferred<typeof credentials & { returnPath: string }>();
  currentOidc.callback.mockReturnValue(late.promise);
  const old = controller.callback("old");
  currentOidc.callback.mockResolvedValue(credentials);
  await controller.callback("new-session");
  late.resolve({
    ...credentials,
    returnPath: "/workspaces/1/channel-app-instances/20/contacts",
  });
  expect(await old).toBeUndefined();
  expect(controller.state.phase).toBe("ready");
});

// TC-SAGE-004
test("同窗口恢复选项传递给既有OIDC，失败不会留下可用会话", async () => {
  const o = oidc();
  const c = createSessionController({ oidc: o, api: api() });
  await c.callback("synthetic");
  o.signIn.mockRejectedValueOnce(new Error("login_required"));
  await c.signIn(true, { sameSessionOnly: true });
  expect(o.signIn).toHaveBeenCalledWith(true, { sameSessionOnly: true });
  expect(c.state.session).toBeUndefined();
  expect(c.state.phase).toBe("error");
});

// TC-SAGE-001 — known short-token expiry must stop before dispatch.
test.each([0, 4_999, 5_000])(
  "token剩余%s毫秒时并发动作只启动一次无交互恢复且不发送业务",
  async (remaining) => {
    let now = 1_000_000;
    const o = oidc();
    o.callback.mockResolvedValue({ ...credentials, expiresAt: now + 300_000 });
    const c = createSessionController({ oidc: o, api: api(), now: () => now });
    await c.callback("initial");
    now += 300_000 - remaining;
    const request = vi.fn(async () => "side effect");
    await Promise.all([
      c.withAccess(new AbortController().signal, request),
      c.withAccess(new AbortController().signal, request),
    ]);
    expect(o.signIn).toHaveBeenCalledTimes(1);
    expect(o.signIn).toHaveBeenCalledWith(true, { sameSessionOnly: true });
    expect(request).not.toHaveBeenCalled();
    expect(c.state.phase).toBe("authenticating");
  },
);

// TC-SAGE-001
test.each([undefined, NaN, Infinity, 0])(
  "无效expiresAt %s不能请求业务或发起循环恢复",
  async (expiresAt) => {
    const o = oidc();
    o.callback.mockResolvedValue({
      ...credentials,
      expiresAt: expiresAt as number,
    });
    const a = api();
    const c = createSessionController({ oidc: o, api: a });
    await c.callback("invalid");
    await c.load();
    expect(a.session).not.toHaveBeenCalled();
    expect(o.signIn).not.toHaveBeenCalled();
    expect(c.state.session).toBeUndefined();
    expect(c.state.phase).toBe("error");
  },
);
test("正常到期先恢复，session与members之间到期也不发送旧bearer", async () => {
  let now = 1_000_000;
  const o = oidc();
  o.callback.mockResolvedValue({ ...credentials, expiresAt: now + 300_000 });
  const a = api();
  const c = createSessionController({ oidc: o, api: a, now: () => now });
  await c.callback("initial");
  now += 300_000;
  await c.load();
  expect(a.session).toHaveBeenCalledTimes(1);
  expect(o.signIn).toHaveBeenCalledTimes(1);
  o.callback.mockResolvedValue({ ...credentials, expiresAt: now + 300_000 });
  a.session.mockImplementationOnce(async () => {
    now += 300_000;
    return facts;
  });
  await c.callback("new");
  expect(a.members).toHaveBeenCalledTimes(1);
  // An unusable callback is rejected rather than starting another authorize loop.
  expect(o.signIn).toHaveBeenCalledTimes(1);
  expect(c.state.phase).toBe("error");
});
test("未到期动作正常发送，已发送未知副作用与资源拒绝不会重放或重新认证", async () => {
  let now = 1_000_000;
  const o = oidc();
  o.callback.mockResolvedValue({ ...credentials, expiresAt: now + 300_000 });
  const c = createSessionController({ oidc: o, api: api(), now: () => now });
  await c.callback("initial");
  const signal = new AbortController().signal;
  expect(await c.withAccess(signal, async () => "ok")).toBe("ok");
  for (const error of [
    new Error("network"),
    new ApiFailure(503),
    new ApiFailure(403),
    new ApiFailure(404),
  ]) {
    const request = vi.fn(async () => {
      throw error;
    });
    await expect(c.withAccess(signal, request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
    expect(o.signIn).not.toHaveBeenCalled();
  }
  const sent = deferred<string>();
  const request = vi.fn(() => sent.promise);
  const result = c.withAccess(signal, request);
  now += 300_000;
  sent.resolve("original result");
  expect(await result).toBe("original result");
  expect(request).toHaveBeenCalledTimes(1);
  expect(o.signIn).not.toHaveBeenCalled();
});
test("未过期401直接失权且不自动重新授权", async () => {
  const o = oidc();
  const c = createSessionController({ oidc: o, api: api() });
  await c.callback("initial");
  await c.withAccess(new AbortController().signal, async () => {
    throw new ApiFailure(401);
  });
  expect(c.state.phase).toBe("signed-out");
  expect(o.signIn).not.toHaveBeenCalled();
});

// TC-SAGE-001
test("正常到期恢复途中退出仍撤销原会话，迟到授权不能恢复资料", async () => {
  let now = 1_000_000;
  const o = oidc();
  o.callback.mockResolvedValue({ ...credentials, expiresAt: now + 300_000 });
  const a = api();
  const c = createSessionController({ oidc: o, api: a, now: () => now });
  await c.callback("initial");
  const late = deferred<void>();
  o.signIn.mockReturnValue(late.promise);
  now += 300_000;
  const recovery = c.withAccess(
    new AbortController().signal,
    async () => "never",
  );
  expect(c.state.canLogout).toBe(true);
  await c.logout();
  late.resolve();
  await recovery;
  expect(a.logout).toHaveBeenCalledTimes(1);
  expect(c.state.phase).toBe("signed-out");
  // A new controller models another tab, with the same origin storage.
  const reopened = createSessionController({ oidc: o, api: a });
  await reopened.signIn(true, { sameSessionOnly: true });
  expect(o.signIn).toHaveBeenCalledTimes(1);
});
test("退出未知后重开阻止恢复，显式登录清除抑制且仍使用prompt login", async () => {
  const o = oidc();
  const a = api();
  a.logout.mockRejectedValue(new Error("network"));
  const c = createSessionController({ oidc: o, api: a });
  await c.callback("initial");
  await c.logout();
  expect(c.state.phase).toBe("logout-unknown");
  const reopened = createSessionController({ oidc: o, api: a });
  await reopened.signIn(true, { sameSessionOnly: true });
  expect(o.signIn).not.toHaveBeenCalled();
  await reopened.signIn();
  expect(o.signIn).toHaveBeenLastCalledWith(false, undefined);
  const afterLogin = createSessionController({ oidc: o, api: a });
  await afterLogin.signIn(true, { sameSessionOnly: true });
  expect(o.signIn).toHaveBeenCalledTimes(2);
});
test("恢复未完成时显式换账号能取消恢复，迟到恢复失败不覆盖新会话", async () => {
  let reject!: (error: Error) => void;
  const o = oidc();
  o.signIn.mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const c = createSessionController({ oidc: o, api: api() });
  const recovery = c.signIn(true, { sameSessionOnly: true });
  await c.signIn();
  expect(o.signIn).toHaveBeenCalledTimes(2);
  await c.callback("new");
  reject(new Error("late"));
  await recovery;
  expect(c.state.phase).toBe("ready");
  await createSessionController({ oidc: o, api: api() }).signIn(true, {
    sameSessionOnly: true,
  });
  expect(o.signIn).toHaveBeenCalledTimes(3);
});
test.each(["login_required", "network", "database"])(
  "恢复失败%s后重开也不会自动重试",
  async (reason) => {
    const o = oidc();
    o.callback.mockRejectedValue(new Error(reason));
    const c = createSessionController({ oidc: o, api: api() });
    await c.signIn(true, { sameSessionOnly: true });
    await c.callback("failed");
    const reopened = createSessionController({ oidc: o, api: api() });
    await reopened.signIn(true, { sameSessionOnly: true });
    expect(o.signIn).toHaveBeenCalledTimes(1);
    expect(c.state.phase).toBe("error");
  },
);
test("storage拒绝时停止自动恢复但不阻止显式登录及撤销", async () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  });
  const o = oidc();
  const a = api();
  const c = createSessionController({ oidc: o, api: a });
  await c.signIn(true, { sameSessionOnly: true });
  expect(o.signIn).not.toHaveBeenCalled();
  await c.signIn();
  await c.callback("explicit");
  await c.logout();
  expect(o.signIn).toHaveBeenCalledTimes(1);
  expect(a.logout).toHaveBeenCalledTimes(1);
});
test("资源403不抑制其他页面正常启动恢复，整体失权则抑制", async () => {
  const o = oidc();
  const a = api();
  const c = createSessionController({ oidc: o, api: a });
  await c.callback("initial");
  await expect(
    c.withAccess(new AbortController().signal, async () => {
      throw new ApiFailure(403);
    }),
  ).rejects.toThrow();
  await createSessionController({ oidc: o, api: a }).signIn(true, {
    sameSessionOnly: true,
  });
  expect(o.signIn).toHaveBeenCalledTimes(1);
  a.session.mockRejectedValue(new ApiFailure(403));
  await c.load();
  await createSessionController({ oidc: o, api: a }).signIn(true, {
    sameSessionOnly: true,
  });
  expect(o.signIn).toHaveBeenCalledTimes(1);
});

test("已取消/离页请求不启动恢复，恢复前发出的迟到401不污染新登录抑制标记", async () => {
  let now = 1_000_000;
  const o = oidc();
  o.callback.mockImplementation(async () => ({
    ...credentials,
    expiresAt: now + 300_000,
  }));
  const c = createSessionController({ oidc: o, api: api(), now: () => now });
  await c.callback("first");
  let reject!: (error: Error) => void;
  const old = c.withAccess(
    new AbortController().signal,
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  now += 300_000;
  const aborted = new AbortController();
  aborted.abort();
  await c.withAccess(aborted.signal, async () => "never");
  expect(o.signIn).not.toHaveBeenCalled();
  await c.signIn();
  await c.callback("second");
  reject(new ApiFailure(401));
  await old;
  expect(c.state.phase).toBe("ready");
  await createSessionController({ oidc: o, api: api() }).signIn(true, {
    sameSessionOnly: true,
  });
  expect(o.signIn).toHaveBeenCalledTimes(2);
  c.dispose();
  await c.withAccess(new AbortController().signal, async () => "never");
  expect(o.signIn).toHaveBeenCalledTimes(2);
});

// TC-SAGE-001 — already dispatched requests end after recovery, never replay.
test.each(["business", "session", "members"] as const)(
  "%s请求发送后跨到期401仅恢复一次，不污染恢复阻止标记",
  async (endpoint) => {
    let now = 1_000_000;
    const o = oidc();
    o.callback.mockResolvedValue({ ...credentials, expiresAt: now + 300_000 });
    const a = api();
    const c = createSessionController({ oidc: o, api: a, now: () => now });
    await c.callback("initial");
    now += 294_000;
    const request = vi.fn(async () => {
      now += 6_000;
      throw new ApiFailure(401);
    });
    if (endpoint === "business")
      expect(
        await c.withAccess(new AbortController().signal, request),
      ).toBeUndefined();
    else {
      a[endpoint].mockImplementationOnce(request);
      await c.load();
    }
    expect(request).toHaveBeenCalledTimes(1);
    expect(o.signIn).toHaveBeenCalledExactlyOnceWith(true, {
      sameSessionOnly: true,
    });
    expect(c.state.phase).toBe("authenticating");
    expect(localStorage.getItem("sage.auth.recovery-blocked")).toBeNull();
  },
);

// TC-SAGE-001 — only actual expiry plus 401 permits recovery.
test.each(["business", "session", "members"] as const)(
  "%s在途错误严格区分到期401与提前窗/其他错误",
  async (endpoint) => {
    for (const [remaining, error] of [
      [1_000, new ApiFailure(401)],
      [5_000, new ApiFailure(401)],
      [0, new ApiFailure(503)],
      [0, new Error("network")],
      [0, new ApiFailure(403)],
      [0, new ApiFailure(404)],
    ] as const) {
      vi.stubGlobal("localStorage", memoryStorage());
      let now = 1_000_000;
      const o = oidc();
      o.callback.mockResolvedValue({
        ...credentials,
        expiresAt: now + 300_000,
      });
      const a = api();
      const c = createSessionController({ oidc: o, api: a, now: () => now });
      await c.callback("initial");
      now += 294_000;
      const request = vi.fn(async () => {
        now += 6_000 - remaining;
        throw error;
      });
      if (endpoint === "business") {
        const result = c.withAccess(new AbortController().signal, request);
        if (error instanceof ApiFailure && error.status === 401) await result;
        else await expect(result).rejects.toBe(error);
      } else {
        a[endpoint].mockImplementationOnce(request);
        await c.load();
        expect(c.state.phase).toBe(
          error instanceof ApiFailure && [401, 403, 404].includes(error.status)
            ? error.status === 401
              ? "signed-out"
              : "forbidden"
            : endpoint === "members"
              ? "degraded"
              : "error",
        );
      }
      expect(request).toHaveBeenCalledTimes(1);
      expect(o.signIn).not.toHaveBeenCalled();
      c.dispose();
    }
  },
);

test.each(["session", "members"] as const)(
  "callback的%s在途到期401停止而不循环授权",
  async (endpoint) => {
    let now = 1_000_000;
    const o = oidc();
    o.callback.mockResolvedValue({ ...credentials, expiresAt: now + 6_000 });
    const a = api();
    a[endpoint].mockImplementationOnce(async () => {
      now += 6_000;
      throw new ApiFailure(401);
    });
    const c = createSessionController({ oidc: o, api: a, now: () => now });
    await c.callback("callback");
    expect(a[endpoint]).toHaveBeenCalledTimes(1);
    expect(o.signIn).not.toHaveBeenCalled();
    expect(c.state.phase).toBe("error");
    expect(c.state.session).toBeUndefined();
  },
);

test.each(["concurrent", "abort", "logout", "switch", "dispose"])(
  "到期迟到401在%s情况下不重放、不额外导航或污染新代次",
  async (outcome) => {
    let now = 1_000_000;
    const o = oidc();
    o.callback.mockImplementation(async () => ({
      ...credentials,
      expiresAt: now + 300_000,
    }));
    const c = createSessionController({ oidc: o, api: api(), now: () => now });
    await c.callback("initial");
    const release = deferred<void>();
    const request = vi.fn(async () => {
      await release.promise;
      throw new ApiFailure(401);
    });
    const abort = new AbortController();
    const first = c.withAccess(abort.signal, request);
    const second =
      outcome === "concurrent"
        ? c.withAccess(abort.signal, request)
        : Promise.resolve();
    now += 300_000;
    if (outcome === "abort") abort.abort();
    if (outcome === "logout") await c.logout();
    if (outcome === "switch") {
      await c.signIn();
      await c.callback("new");
    }
    if (outcome === "dispose") c.dispose();
    release.resolve();
    await Promise.all([first, second]);
    expect(request).toHaveBeenCalledTimes(outcome === "concurrent" ? 2 : 1);
    expect(o.signIn).toHaveBeenCalledTimes(
      ["concurrent", "switch"].includes(outcome) ? 1 : 0,
    );
    if (outcome === "concurrent")
      expect(o.signIn).toHaveBeenCalledWith(true, { sameSessionOnly: true });
    expect(localStorage.getItem("sage.auth.recovery-blocked")).toBe(
      outcome === "logout" ? "true" : null,
    );
    if (outcome === "switch") expect(c.state.phase).toBe("ready");
  },
);
