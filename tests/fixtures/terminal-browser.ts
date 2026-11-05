import { createApp } from "vue";
import App from "../../src/App.vue";
import { createMudApi } from "../../src/api/mud";
import { createSessionController } from "../../src/auth/session";
import "../../src/styles/tokens.css";
import "../../src/styles/workspace.css";

const controller = createSessionController({
  oidc: {
    signIn: async () => {},
    callback: async () => ({
      subject: "2",
      accessToken: "browser-fixture",
      idToken: "browser-fixture",
    }),
    clear: () => {},
  },
  api: createMudApi(window.location.origin),
});
createApp(App, { controller }).mount("#app");
void controller.callback("browser-fixture");
