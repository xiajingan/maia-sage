import { test, expect, vi } from "vitest";
import { createMudApi } from "../src/api/mud";
// TC-SAGE-001
test("真实生成client消费owner schema，拒绝错误role与未知响应且无需Function", async () => {
  const original = globalThis.Function;
  try {
    globalThis.Function = (() => {
      throw new Error("CSP");
    }) as unknown as FunctionConstructor;
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValueOnce(
      Response.json({
        rootWorkspace: { id: "1", name: "个人工作空间" },
        user: { id: "2", loginName: "lili" },
        membership: { role: "owner" },
        accessContextVersion: "1",
      }),
    );
    await expect(
      createMudApi("https://localhost").session("access"),
    ).rejects.toThrow();
    fetch.mockResolvedValueOnce(Response.json({ status: "revoked" }));
    await expect(
      createMudApi("https://localhost").logout({
        idTokenHint: "hint",
        logoutRequestId: "abcdefghijk_abcdefghijk",
      }),
    ).resolves.toBeUndefined();
  } finally {
    globalThis.Function = original;
    vi.restoreAllMocks();
  }
});
// TC-SAGE-001
test("退出传递AbortSignal给真实生成client，可终止未返回的网络请求", async () => {
  let observed: AbortSignal | undefined;
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => {
      observed = (input as Request).signal;
      return new Promise((_, reject) => {
        observed?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    });
  try {
    const abort = new AbortController();
    const pending = createMudApi("https://localhost").logout(
      { idTokenHint: "test-hint", logoutRequestId: "abcdefghijklmnopqrstuv" },
      abort.signal,
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    abort.abort();
    expect(observed?.aborted).toBe(true);
    await expect(pending).rejects.toThrow();
  } finally {
    vi.restoreAllMocks();
  }
});

// TC-SAGE-001 — real generated client and native AbortSignal timeout, no immediate rejection fixture.
test("恢复后的session与members读取十秒未返回即终止，不误报401", async () => {
  const timeouts = vi.spyOn(AbortSignal, "timeout");
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => {
      const signal = (input as Request).signal;
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });
  try {
    const api = createMudApi("https://localhost");
    const pending = Promise.allSettled([
      api.session("synthetic"),
      api.members("synthetic", "1"),
    ]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(timeouts.mock.calls).toEqual([[10_000], [10_000]]);
    const results = await pending;
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason.status).not.toBe(401);
    }
  } finally {
    vi.restoreAllMocks();
  }
}, 15_000);
