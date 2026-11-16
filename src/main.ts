import { createApp } from "vue";
import App from "./App.vue";
import { loadRuntimeConfig } from "./config";
import { businessReturnPath, createOidc } from "./auth/oidc";
import { createMudApi } from "./api/mud";
import { createSessionController } from "./auth/session";
import {
  handleNameResult,
  readNameReturn,
  clearNameReturn,
  prepareNameNavigation,
} from "./features/contacts/name-context";
import "./styles/tokens.css";
import "./styles/workspace.css";
async function boot() {
  const isNameResult = location.pathname === "/wecom/name-context-result";
  const nameReturn = isNameResult ? handleNameResult() : undefined;
  if (isNameResult && !nameReturn) {
    const target = document.getElementById("app");
    if (target)
      target.textContent =
        "姓名授权结果已返回。请回到原 Maia 窗口核对原操作；若已离开原会话，请先登录 Maia 再重新授权。";
    return;
  }
  if (nameReturn) history.replaceState(null, "", nameReturn.returnPath);
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
    createApp(App, {
      controller,
      api,
      wecomNamesEnabled: config.wecomNamesEnabled ?? false,
    }).mount("#app");
    window.addEventListener("pagehide", () => {
      prepareNameNavigation();
      controller.dispose();
    });
    if (callback) {
      const target = businessReturnPath(
        await controller.callback(callback),
        location.origin,
      );
      if (!controller.state.session) clearNameReturn();
      if (target) {
        history.replaceState(null, "", target);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    } else {
      const saved = readNameReturn();
      if (saved && !("kind" in saved) && saved.returnPath !== location.pathname)
        clearNameReturn();
      // Exactly one top-level attempt per ordinary boot. Callback errors never re-enter it.
      await controller.signIn(true, { sameSessionOnly: true });
      if (controller.state.phase !== "authenticating") clearNameReturn();
    }
  } catch {
    createApp(App, { bootError: true }).mount("#app");
  }
}
void boot();
