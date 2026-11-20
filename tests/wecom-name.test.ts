import { afterEach, expect, test, vi } from "vitest";
import { bindNames, type WecomSdk } from "../src/features/contacts/wecom-sdk";
import type { GetNameComponentConfigResponse } from "maia-mud-client";
export const config: GetNameComponentConfigResponse = {
  operationId: "50",
  instanceId: "20",
  pageKey: "instance_contacts",
  pageUrl: "https://localhost/workspaces/1/channel-app-instances/20/contacts",
  environment: "member",
  scopeVersion: "1",
  expiresAt: Date.now() + 60000,
  corpId: "synthetic-corp",
  agentId: "100",
  nonceStr: "synthetic",
  timestamp: 1900000000,
  corpSignature: "a".repeat(40),
  agentSignature: "b".repeat(40),
  references: [
    { contactId: "30", userId: "synthetic-userid", type: "userName" },
  ],
  nextCursor: null,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  const events: Record<string, () => void> = {};
  let ready = () => {};
  const calls: string[] = [];
  const sdk: WecomSdk = {
    wx: {
      config: () => calls.push("config"),
      ready: (cb) => {
        ready = cb;
      },
      error: () => {},
      agentConfig: (input) => {
        calls.push("agentConfig");
        input.success();
      },
    },
    openData: () => ({
      bind: () => calls.push("bind"),
      on: (event, cb) => {
        events[event] = cb;
      },
      off: vi.fn(),
      checkSession: (input) => {
        calls.push("checkSession");
        input.success();
      },
    }),
  };
  const element = {
    isConnected: true,
    getAttribute: (key: string) =>
      ({
        openid: "synthetic-userid",
        type: "userName",
        corpid: "synthetic-corp",
      })[key],
    remove: vi.fn(),
  } as unknown as Element;
  vi.stubGlobal("location", { href: config.pageUrl });
  return { sdk, calls, events, element, ready: () => ready() };
}
// TC-SAGE-004
test("sdk_ready_is_not_real_name config完成后agentConfig，挂载后bind；update不宣称真名", async () => {
  const f = fixture();
  const abort = new AbortController();
  const statuses: string[] = [];
  const pending = bindNames(config, {
    sdk: f.sdk,
    elements: [f.element],
    signal: abort.signal,
    onStatus: (status) => statuses.push(status.stage),
  });
  await vi.waitFor(() => expect(f.calls).toEqual(["config"]));
  f.ready();
  expect(await pending).toEqual({ stage: "bound", realNameVerified: false });
  expect(f.calls).toEqual(["config", "agentConfig", "checkSession", "bind"]);
  f.events.update?.();
  expect(statuses.at(-1)).toBe("update");
  abort.abort();
});

test("component_expired_or_wrong_corp 过期或不匹配企业不得绑定", async () => {
  const f = fixture(),
    abort = new AbortController();
  expect(
    (
      await bindNames(
        { ...config, expiresAt: 1 },
        { sdk: f.sdk, elements: [f.element], signal: abort.signal },
      )
    ).stage,
  ).toBe("expired");
  expect(
    (
      await bindNames(
        { ...config, corpId: "wrong-corp" },
        { sdk: f.sdk, elements: [f.element], signal: abort.signal },
      )
    ).stage,
  ).toBe("invalid");
  expect(f.calls).toEqual([]);
});

test("web分支跳过config；error清理且不读取事件载荷，卸载解绑事件", async () => {
  const f = fixture(),
    abort = new AbortController(),
    stages: string[] = [];
  const status = await bindNames(
    { ...config, environment: "web" },
    {
      sdk: f.sdk,
      elements: [f.element],
      signal: abort.signal,
      onStatus: (s) => stages.push(s.stage),
    },
  );
  expect(status.realNameVerified).toBe(false);
  expect(f.calls).toEqual(["agentConfig", "checkSession", "bind"]);
  f.events.error?.();
  expect(stages.at(-1)).toBe("error");
  expect(f.element.remove).toHaveBeenCalled();
  f.events.update?.();
  expect(stages.at(-1)).toBe("error");
  abort.abort();
});

test.each(["missing", "rejected"])(
  "本人绑定模式要求当前浏览器通过企微会话检查（%s）",
  async (scenario) => {
    const f = fixture();
    const openData = f.sdk.openData()!;
    if (scenario === "missing") delete openData.checkSession;
    else openData.checkSession = ({ fail }) => fail();
    f.sdk.openData = () => openData;
    const mount = vi.fn(async () => [f.element]);
    const result = await bindNames(
      { ...config, environment: "web", source: "installation_binding" },
      { sdk: f.sdk, mount, signal: new AbortController().signal },
    );
    expect(result.stage).toBe("browser_session_unavailable");
    expect(mount).not.toHaveBeenCalled();
    expect(f.calls).not.toContain("bind");
  },
);

test("官方元素仅在初始化成功后挂载，URL改变或过期立即失效", async () => {
  vi.useFakeTimers();
  const f = fixture(),
    abort = new AbortController(),
    statuses: string[] = [];
  const mount = vi.fn(async () => {
    f.calls.push("mount");
    return [f.element];
  });
  const result = await bindNames(
    { ...config, environment: "web", expiresAt: Date.now() + 1000 },
    {
      sdk: f.sdk,
      mount,
      signal: abort.signal,
      onStatus: (s) => statuses.push(s.stage),
    },
  );
  expect(result.stage).toBe("bound");
  expect(f.calls).toEqual(["agentConfig", "checkSession", "mount", "bind"]);
  await vi.advanceTimersByTimeAsync(1001);
  expect(statuses.at(-1)).toBe("expired");
  expect(f.element.remove).toHaveBeenCalled();
  abort.abort();
});

test("checkSession失败不得挂载，迟到update不能复活已清理元素", async () => {
  const f = fixture(),
    abort = new AbortController();
  const openData = f.sdk.openData()!;
  openData.checkSession = (input) => input.fail();
  f.sdk.openData = () => openData;
  const mount = vi.fn(async () => [f.element]);
  expect(
    (
      await bindNames(
        { ...config, environment: "web" },
        { sdk: f.sdk, mount, signal: abort.signal },
      )
    ).stage,
  ).toBe("error");
  expect(mount).not.toHaveBeenCalled();
  abort.abort();
});

test("初始化中超时或卸载后晚ready不继续agentConfig，新scope要求刷新", async () => {
  vi.resetModules();
  const isolated = await import("../src/features/contacts/wecom-sdk");
  vi.useFakeTimers();
  const f = fixture(),
    abort = new AbortController(),
    mount = vi.fn(async () => [f.element]);
  const pending = isolated.bindNames(config, {
    sdk: f.sdk,
    mount,
    signal: abort.signal,
  });
  await vi.advanceTimersByTimeAsync(10001);
  expect((await pending).stage).toBe("timeout");
  f.ready();
  await Promise.resolve();
  expect(f.calls).toEqual(["config"]);
  expect(mount).not.toHaveBeenCalled();
  expect(
    (
      await isolated.bindNames(
        { ...config, corpId: "new-corp" },
        { sdk: f.sdk, mount, signal: abort.signal },
      )
    ).stage,
  ).toBe("reload_required");
  abort.abort();
});

test("卸载中agentConfig成功不挂载元素", async () => {
  vi.resetModules();
  const isolated = await import("../src/features/contacts/wecom-sdk");
  const f = fixture(),
    abort = new AbortController();
  let success!: () => void;
  f.sdk.wx.agentConfig = (input) => {
    success = input.success;
  };
  const mount = vi.fn(async () => [f.element]);
  const pending = isolated.bindNames(
    { ...config, environment: "web" },
    { sdk: f.sdk, mount, signal: abort.signal },
  );
  abort.abort();
  success();
  expect((await pending).stage).toBe("cancelled");
  expect(mount).not.toHaveBeenCalled();
});

test("挂载触发的自动绑定错误也被观察，不能随后宣称bound", async () => {
  const f = fixture(),
    abort = new AbortController();
  const status = await bindNames(
    { ...config, environment: "web" },
    {
      sdk: f.sdk,
      signal: abort.signal,
      mount: async () => {
        f.events.error?.();
        return [f.element];
      },
    },
  );
  expect(status.stage).toBe("error");
  expect(f.calls).not.toContain("bind");
  abort.abort();
});
