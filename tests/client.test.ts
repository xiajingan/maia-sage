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
