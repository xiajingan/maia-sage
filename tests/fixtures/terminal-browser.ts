import { createApp } from "vue";
import App from "../../src/App.vue";
import { createMudApi } from "../../src/api/mud";
import { createSessionController } from "../../src/auth/session";
import "../../src/styles/tokens.css";
import "../../src/styles/workspace.css";

const api = createMudApi(window.location.origin);
// This fixture advances terminal timers past five minutes; auth expiry has its own suite.
const authNow = Date.now();
const controller = createSessionController({
  now: () => authNow,
  oidc: {
    signIn: async () => {},
    callback: async () => ({
      subject: "2",
      expiresAt: authNow + 300_000,
      accessToken: "browser-fixture",
      idToken: "browser-fixture",
    }),
    clear: () => {},
  },
  api,
});
createApp(App, { controller, api }).mount("#app");
void controller.callback("browser-fixture");
