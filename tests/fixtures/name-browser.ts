// Synthetic browser harness only. Never import this fixture in production.
import { createApp } from "vue";
import App from "../../src/App.vue";
import { createMudApi } from "../../src/api/mud";
import { createSessionController } from "../../src/auth/session";
import { handleNameResult } from "../../src/features/contacts/name-context";
import "../../src/styles/tokens.css";
import "../../src/styles/workspace.css";
if (location.pathname === "/wecom/name-context-result") {
  handleNameResult();
  document.getElementById("app")!.textContent = "合成授权结果已通知原窗口";
} else {
  const api = createMudApi(location.origin);
  const controller = createSessionController({
    api,
    oidc: {
      signIn: async () => {},
      callback: async () => ({
        subject: "2",
        expiresAt: Date.now() + 300_000,
        accessToken: "synthetic-bearer",
        idToken: "synthetic-id",
      }),
      clear: () => {},
    },
  });
  createApp(App, { api, controller, wecomNamesEnabled: true }).mount("#app");
  void controller.callback("synthetic-callback");
}
