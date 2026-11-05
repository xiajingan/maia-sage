import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, test } from "vitest";
import { createMudApi } from "../src/api/mud";
import App from "../src/App.vue";
import { ApiFailure, createSessionController } from "../src/auth/session";
// TC-SAGE-001
test("已认证的读取错误页显示退出操作", async () => {
  const controller = createSessionController({
    oidc: {
      signIn: async () => {},
      callback: async () => ({
        accessToken: "test-access",
        idToken: "test-id",
        subject: "2",
      }),
      clear: () => {},
    },
    api: {
      ...createMudApi("https://localhost"),
      session: async () => {
        throw new ApiFailure(503);
      },
      members: async () => ({ items: [], nextCursor: null }),
      logout: async () => {},
    },
  });
  await controller.callback("callback");
  const html = await renderToString(createSSRApp(App, { controller }));
  expect(html).toContain("暂时无法进入工作空间");
  expect(html).toContain("退出登录");
});
// TC-SAGE-001
test("退出待响应页允许重新登录并使旧退出结果失效", async () => {
  let resolve!: () => void;
  const controller = createSessionController({
    oidc: {
      signIn: async () => {},
      callback: async () => ({
        accessToken: "test-access",
        idToken: "test-id",
        subject: "2",
      }),
      clear: () => {},
    },
    api: {
      ...createMudApi("https://localhost"),
      session: async () => {
        throw new ApiFailure(503);
      },
      members: async () => ({ items: [], nextCursor: null }),
      logout: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  });
  await controller.callback("callback");
  const leaving = controller.logout();
  const html = await renderToString(createSSRApp(App, { controller }));
  expect(html).toContain("正在核实原会话已撤销");
  expect(html).toContain("重新登录");
  await controller.signIn();
  resolve();
  await leaving;
  expect(controller.state.phase).toBe("authenticating");
});
