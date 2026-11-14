import { createApp } from "vue";
import App from "./App.vue";
import { loadRuntimeConfig } from "./config";
import { businessReturnPath, createOidc } from "./auth/oidc";
import { createMudApi } from "./api/mud";
import { createSessionController } from "./auth/session";
import "./styles/tokens.css";
import "./styles/workspace.css";
async function boot() {
  const callback =
    location.pathname === "/auth/callback" ? location.href : undefined;
  if (callback) history.replaceState(null, "", "/");
  try {
    const config = await loadRuntimeConfig();
    const api = createMudApi(config.apiBaseUrl);
    const controller = createSessionController({
      oidc: createOidc(config),
      api,
    });
    createApp(App, { controller, api }).mount("#app");
    window.addEventListener("pagehide", () => controller.dispose());
    if (callback) {
      const target = businessReturnPath(
        await controller.callback(callback),
        location.origin,
      );
      if (target) {
        history.replaceState(null, "", target);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    } else {
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      if (navigation?.type === "reload") await controller.signIn(true);
    }
  } catch {
    createApp(App, { bootError: true }).mount("#app");
  }
}
void boot();
