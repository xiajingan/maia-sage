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
