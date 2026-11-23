import type {
  GetNameComponentConfigResponse,
  GetBoundNameComponentConfigResponse,
} from "maia-mud-client";
export type NameComponentConfig =
  GetNameComponentConfigResponse | GetBoundNameComponentConfigResponse;
type NameSetupStep = "load" | "config" | "agentConfig" | "checkSession";
type ConfigRejection = "signature" | "domain" | "permission" | "rejected";
export type NameRenderStatus = {
  stage:
    | NameSetupStep
    | "browser_session_unavailable"
    | "bound"
    | "update"
    | "error"
    | "expired"
    | "invalid"
    | "cancelled"
    | "timeout"
    | "reload_required";
  failedAt?: NameSetupStep | "bind";
  configIssue?: ConfigRejection | "timeout";
  realNameVerified: false;
};
type Callbacks = { success: () => void; fail: () => void };
interface Wx {
  config(input: {
    beta: true;
    debug: false;
    appId: string;
    timestamp: number;
    nonceStr: string;
    signature: string;
    jsApiList: string[];
  }): void;
  ready(callback: () => void): void;
  error(callback: (response?: unknown) => void): void;
  agentConfig(
    input: Callbacks & {
      corpid: string;
      agentid: string;
      timestamp: number;
      nonceStr: string;
      signature: string;
      jsApiList: string[];
    },
  ): void;
}
interface OpenData {
  bind(element: Element): void;
  checkSession?(input: Callbacks): void;
  on?(event: "error" | "update", callback: () => void): void;
  off?(event: "error" | "update", callback: () => void): void;
}
export interface WecomSdk {
  wx: Wx;
  openData(): OpenData | undefined;
}
const scripts = [
  "https://res.wx.qq.com/open/js/jweixin-1.2.0.js",
  "https://open.work.weixin.qq.com/wwopen/js/jwxwork-1.0.0.js",
] as const;
type OpenDataWindow = Window & { WWOpenData?: OpenData };
const readOpenData = () => (window as OpenDataWindow).WWOpenData;
function loadScript(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.referrerPolicy = "origin";
    script.async = false;
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error("load"));
    }, 10000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error("load"));
    };
    document.head.append(script);
  });
}
let loaded: Promise<WecomSdk> | undefined;
export function loadWecomSdk(): Promise<WecomSdk> {
  return (loaded ??= (async () => {
    for (const src of scripts) await loadScript(src);
    const globals = window as unknown as { wx?: Wx; WWOpenData?: OpenData };
    if (!globals.wx || typeof globals.wx.agentConfig !== "function")
      throw new Error("load");
    return { wx: globals.wx, openData: () => globals.WWOpenData };
  })());
}
function usesNativeAndroidOpenData() {
  const ua = globalThis.navigator?.userAgent ?? "";
  const version = /\bwxwork\/(\d+)\.(\d+)\.(\d+)/i.exec(ua);
  if (!/\bAndroid\b/i.test(ua) || !version) return false;
  const major = Number(version[1]),
    minor = Number(version[2]),
    patch = Number(version[3]);
  return major > 3 || (major === 3 && (minor > 0 || patch >= 24));
}
let handledRegistrationFailures: WeakSet<object> | undefined;
function handleDetachedRegistrationFailure(reason: unknown) {
  if (!reason || typeof reason !== "object") return;
  if (!handledRegistrationFailures) {
    const failures = new WeakSet<object>();
    // SDK 2.4.4 also starts configuration from register() without returning its
    // Promise. initOpenData observes the same failure. Only suppress that exact rejection.
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason as unknown;
      if (reason && typeof reason === "object" && failures.delete(reason))
        event.preventDefault();
    });
    handledRegistrationFailures = failures;
  }
  handledRegistrationFailures.add(reason);
}
export interface NameBinding {
  elements?: Element[];
  mount?: () => Promise<Element[]>;
  unmount?: () => void;
  signal: AbortSignal;
  onStatus?(status: NameRenderStatus): void;
  sdk?: WecomSdk;
}
function classifyConfigRejection(response: unknown): ConfigRejection {
  const message =
    response &&
    typeof response === "object" &&
    "errMsg" in response &&
    typeof response.errMsg === "string"
      ? response.errMsg.slice(0, 200)
      : "";
  if (/\binvalid signature\b/i.test(message)) return "signature";
  if (/\binvalid url domain\b/i.test(message)) return "domain";
  if (/\b(?:permission denied|fail_nopermission)\b/i.test(message))
    return "permission";
  return "rejected";
}
// wx has global callbacks without an unregister API. Serialize init; an interrupted
// config/agentConfig must reload before reusing that global SDK for another scope.
let initializing = false;
let uncertain = false;
let nativeRegistrationStarted = false;
export async function bindNames(
  input: NameComponentConfig,
  binding: NameBinding,
): Promise<NameRenderStatus> {
  const { signal } = binding;
  let elements = binding.elements ?? [];
  let stage: NameRenderStatus["stage"] = "load";
  let stepInProgress: NonNullable<NameRenderStatus["failedAt"]> = "load";
  let configRejection: ConfigRejection | undefined;
  const report = (
    next: NameRenderStatus["stage"],
    failedAt?: NameRenderStatus["failedAt"],
  ): NameRenderStatus => {
    stage = next;
    const configIssue =
      failedAt === "config"
        ? next === "timeout"
          ? "timeout"
          : configRejection
        : undefined;
    const status: NameRenderStatus = {
      stage,
      ...(failedAt ? { failedAt } : {}),
      ...(configIssue ? { configIssue } : {}),
      realNameVerified: false,
    };
    if (!signal.aborted) binding.onStatus?.(status);
    return status;
  };
  if (signal.aborted) return { stage: "cancelled", realNameVerified: false };
  if (uncertain || initializing) return report("reload_required");
  let retired = false;
  const current = () =>
    !retired &&
    !signal.aborted &&
    input.expiresAt > Date.now() &&
    input.pageUrl === location.href;
  if (!current())
    return report(input.expiresAt <= Date.now() ? "expired" : "invalid");
  if (
    elements.some(
      (element) =>
        !element.isConnected ||
        element.getAttribute("corpid") !== input.corpId ||
        element.getAttribute("type") !== "userName" ||
        !input.references.some(
          (ref) => ref.userId === element.getAttribute("openid"),
        ),
    )
  )
    return report("invalid");
  let openData: OpenData | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    if (retired || signal.aborted) return;
    if (current()) report("update");
    else {
      report(input.expiresAt <= Date.now() ? "expired" : "invalid");
      cleanup();
    }
  };
  const error = () => {
    if (!signal.aborted && !retired) report("error", "bind");
    cleanup();
  };
  function cleanup() {
    retired = true;
    clearTimeout(expiry);
    try {
      openData?.off?.("error", error);
      openData?.off?.("update", update);
    } catch {
      /* A failing provider cleanup must not keep the elements mounted. */
    }
    signal.removeEventListener("abort", cleanup);
    // The framework owns its nodes. Request v-if removal without reading content.
    if (binding.unmount) binding.unmount();
    else for (const element of elements) element.remove();
  }
  async function step(
    next: Exclude<NameSetupStep, "load">,
    start: (callbacks: Callbacks) => void,
    failureReason = "error",
  ) {
    if (!current()) throw new Error(signal.aborted ? "cancelled" : "expired");
    stepInProgress = next;
    report(next);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (reason?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        if (reason) reject(new Error(reason));
        else resolve();
      };
      const cancel = () => finish("cancelled");
      const timer = setTimeout(
        () => finish("timeout"),
        Math.min(10000, Math.max(1, input.expiresAt - Date.now())),
      );
      signal.addEventListener("abort", cancel, { once: true });
      try {
        start({ success: () => finish(), fail: () => finish(failureReason) });
      } catch {
        finish("error");
      }
    });
    if (!current()) throw new Error(signal.aborted ? "cancelled" : "expired");
  }
  initializing = true;
  try {
    report("load");
    if (
      !binding.sdk &&
      input.environment === "member" &&
      usesNativeAndroidOpenData()
    ) {
      // The official SDK caches agent configuration by URL, even if register
      // receives a new signature for that URL. A fresh document clears the cache.
      if (nativeRegistrationStarted) return report("reload_required");
      const sdk = await import("@wecom/jssdk");
      await loadScript(scripts[1]);
      await step("agentConfig", ({ success, fail }) => {
        nativeRegistrationStarted = true;
        sdk.register({
          corpId: input.corpId,
          agentId: input.agentId,
          onAgentConfigFail: handleDetachedRegistrationFailure,
          getAgentConfigSignature: (url) => {
            if (!current() || url !== input.pageUrl) throw new Error("invalid");
            return {
              timestamp: input.timestamp,
              nonceStr: input.nonceStr,
              signature: input.agentSignature,
            };
          },
        });
        void sdk.initOpenData().then(success, fail);
      });
      openData = readOpenData();
    } else {
      const sdk = binding.sdk ?? (await loadWecomSdk());
      if (input.environment === "member")
        await step("config", (callbacks) => {
          sdk.wx.config({
            beta: true,
            debug: false,
            appId: input.corpId,
            nonceStr: input.nonceStr,
            timestamp: input.timestamp,
            signature: input.corpSignature,
            jsApiList: [],
          });
          sdk.wx.ready(callbacks.success);
          sdk.wx.error((response) => {
            configRejection = classifyConfigRejection(response);
            callbacks.fail();
          });
        });
      await step("agentConfig", (callbacks) =>
        sdk.wx.agentConfig({
          ...callbacks,
          corpid: input.corpId,
          agentid: input.agentId,
          nonceStr: input.nonceStr,
          timestamp: input.timestamp,
          signature: input.agentSignature,
          jsApiList: [],
        }),
      );
      openData = sdk.openData();
    }
    stepInProgress = "bind";
    if (!openData || typeof openData.bind !== "function")
      throw new Error("error");
    if (openData.checkSession || "source" in input)
      await step(
        "checkSession",
        (callbacks) => {
          if (openData!.checkSession) openData!.checkSession(callbacks);
          else callbacks.fail();
        },
        "source" in input ? "browser_session_unavailable" : "error",
      );
    stepInProgress = "bind";
    if (!current()) throw new Error("expired");
    // Old clients may lack on/off; only subscribe when both lifecycle operations exist.
    if (openData.on && openData.off) {
      openData.on("error", error);
      openData.on("update", update);
    }
    signal.addEventListener("abort", cleanup, { once: true });
    expiry = setTimeout(() => {
      report("expired");
      cleanup();
    }, input.expiresAt - Date.now());
    if (binding.mount) elements = await binding.mount();
    if (retired) {
      cleanup();
      return { stage, realNameVerified: false };
    }
    if (!current()) throw new Error(signal.aborted ? "cancelled" : "expired");
    if (
      elements.some(
        (element) =>
          !element.isConnected ||
          element.getAttribute("corpid") !== input.corpId ||
          element.getAttribute("type") !== "userName" ||
          !input.references.some(
            (ref) => ref.userId === element.getAttribute("openid"),
          ),
      )
    )
      throw new Error("error");
    for (const element of elements) {
      if (!current()) break;
      openData.bind(element);
    }
    return retired ? { stage, realNameVerified: false } : report("bound");
  } catch (failure) {
    const interruptedGlobal = ["load", "config", "agentConfig"].includes(stage);
    if (interruptedGlobal) uncertain = true;
    cleanup();
    const reason = failure instanceof Error ? failure.message : "error";
    if (interruptedGlobal && (reason === "error" || reason === "load"))
      return report("reload_required", stepInProgress);
    if (reason === "cancelled" || reason === "expired") return report(reason);
    return report(
      reason === "timeout" || reason === "browser_session_unavailable"
        ? reason
        : "error",
      stepInProgress,
    );
  } finally {
    initializing = false;
  }
}
