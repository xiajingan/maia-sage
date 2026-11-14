import { shallowReactive, watch } from "vue";
import type {
  CreateNameContextResponse,
  GetNameComponentConfigResponse,
} from "maia-mud-client";
import { Check } from "typebox/value";
import { NameContextViewSchema } from "maia-mud-client/schemas";
import type { NameApi } from "../../api/mud";
import { ApiFailure, type createSessionController } from "../../auth/session";
import { businessReturnPath } from "../../auth/oidc";

export type NameSelection = {
  workspaceId: string;
  instanceId: string;
  scopeVersion: string;
  cursor?: string;
};
type Session = ReturnType<typeof createSessionController>;
type Operation = CreateNameContextResponse;
const returnKey = "sage.wecom.name-return";
const navigationEvent = "maia:preserve-name-navigation";
// main calls this synchronously before disposing its in-memory session on pagehide.
export function prepareNameNavigation() {
  window.dispatchEvent(new Event(navigationEvent));
}
export type NameReturn = {
  operationId: string;
  instanceId: string;
  returnPath: string;
  expiresAt: number;
};
export function clearNameReturn() {
  try {
    sessionStorage.removeItem(returnKey);
  } catch {
    /* Optional non-secret storage. */
  }
}
export function readNameReturn(): NameReturn | undefined {
  try {
    const raw: unknown = JSON.parse(
      sessionStorage.getItem(returnKey) ?? "null",
    );
    if (
      !raw ||
      typeof raw !== "object" ||
      Object.keys(raw).sort().join() !==
        "expiresAt,instanceId,operationId,returnPath"
    )
      return;
    const value = raw as NameReturn;
    if (
      !Check(NameContextViewSchema.properties.operationId, value.operationId) ||
      !Check(NameContextViewSchema.properties.instanceId, value.instanceId) ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= Date.now() ||
      value.expiresAt > Date.now() + 300000 ||
      businessReturnPath(value.returnPath, location.origin) !==
        value.returnPath ||
      !value.returnPath.endsWith(
        `/channel-app-instances/${value.instanceId}/contacts`,
      )
    )
      return;
    return value;
  } catch {
    return;
  }
}
// The result is only a wake-up signal. All authorization facts come from authenticated Mud calls.
export function handleNameResult(): NameReturn | undefined {
  const url = new URL(location.href);
  const id = url.searchParams.get("operationId");
  history.replaceState(null, "", "/wecom/name-context-result");
  if (!Check(NameContextViewSchema.properties.operationId, id)) return;
  if (window.opener) {
    window.opener.postMessage({ operationId: id }, location.origin);
    return;
  }
  const saved = readNameReturn();
  if (saved?.operationId === id) return saved;
}

export function createNameContextController({
  api,
  session,
}: {
  api: NameApi;
  session: Session;
}) {
  const state = shallowReactive<{
    operation?: Operation;
    config?: GetNameComponentConfigResponse;
    busy: boolean;
    message?: string;
    blocked: boolean;
    requiresLogin?: boolean;
  }>({ busy: false, blocked: false });
  let selection: NameSelection | undefined;
  let abort = new AbortController();
  let epoch = 0;
  let popup: Window | null = null;
  let requestId: string | undefined;
  let leaving = false;
  const markLeaving = () => {
    leaving = true;
  };
  if (typeof window !== "undefined")
    window.addEventListener?.(navigationEvent, markLeaving);
  let expiry: ReturnType<typeof setTimeout> | undefined;
  function clear() {
    ++epoch;
    abort.abort();
    abort = new AbortController();
    clearTimeout(expiry);
    popup?.close();
    popup = null;
    state.operation = undefined;
    state.config = undefined;
    state.busy = false;
    state.message = undefined;
    state.blocked = false;
    state.requiresLogin = false;
    requestId = undefined;
  }
  function select(value?: NameSelection) {
    const retain =
      value &&
      selection &&
      value.workspaceId === selection.workspaceId &&
      value.instanceId === selection.instanceId &&
      value.scopeVersion === selection.scopeVersion;
    if (selection && !retain && !leaving) clearNameReturn();
    const op = retain ? state.operation : undefined;
    clear();
    selection = value;
    if (op) accept(op, abort.signal);
  }
  const stopSession = watch(
    () => session.state.session,
    () => select(undefined),
    { flush: "sync" },
  );
  function suspend() {
    ++epoch;
    abort.abort();
    abort = new AbortController();
    state.config = undefined;
    state.busy = false;
  }
  function dispose() {
    stopSession();
    if (!leaving) clearNameReturn();
    if (typeof window !== "undefined")
      window.removeEventListener?.(navigationEvent, markLeaving);
    clear();
    selection = undefined;
  }
  function valid() {
    return (
      selection &&
      session.state.session?.rootWorkspace.id === selection.workspaceId
    );
  }
  async function run(
    work: (
      token: string,
      signal: AbortSignal,
      selected: NameSelection,
    ) => Promise<void>,
    onFailure?: (error: unknown) => void,
  ) {
    if (!valid() || !selection || state.busy) return;
    const generation = epoch,
      signal = abort.signal,
      selected = selection;
    state.busy = true;
    try {
      await session.withAccess(signal, async (token) => {
        await work(token, signal, selected);
      });
    } catch (error) {
      if (generation !== epoch || signal.aborted) return;
      state.config = undefined;
      state.message =
        error instanceof ApiFailure && error.recovery
          ? error.recovery
          : "姓名暂不可展示，请核对当前权限、原 Maia 会话与企业，再重试原操作。";
      if (
        error instanceof ApiFailure &&
        [401, 403, 404, 410].includes(error.status)
      )
        state.blocked = true;
      onFailure?.(error);
    } finally {
      if (generation === epoch) state.busy = false;
    }
  }
  function accept(op: Operation, signal: AbortSignal) {
    if (signal.aborted || !valid() || op.instanceId !== selection?.instanceId)
      return false;
    if (
      state.operation &&
      (op.operationId !== state.operation.operationId ||
        BigInt(op.rowVersion) < BigInt(state.operation.rowVersion))
    )
      return false;
    state.operation = op;
    saveReturn();
    state.message =
      op.safeReason === "login_configuration_unavailable"
        ? "普通浏览器姓名授权尚未配置，请联系管理员核对登录授权应用。"
        : ["restricted", "failed", "expired"].includes(op.phase)
          ? "姓名暂不可展示，请核对当前企业与授权条件后重新建立上下文。"
          : undefined;
    clearTimeout(expiry);
    expiry = setTimeout(
      () => {
        state.config = undefined;
        state.blocked = true;
        state.message = "姓名授权已过期，请重新建立上下文。";
      },
      Math.max(0, op.expiresAt - Date.now()),
    );
    return true;
  }
  async function query(restoring = false) {
    const op = state.operation;
    if (!op || state.blocked) return;
    let claimConfirmed = false;
    await run(
      async (token, signal, selected) => {
        let value = await api.getNameContext(
          token,
          { path: { id: selected.instanceId, operationId: op.operationId } },
          signal,
        );
        if (!accept(value, signal)) return;
        if (value.nextAction === "complete") {
          value = await api.completeNameContext(
            token,
            {
              path: { id: selected.instanceId, operationId: op.operationId },
              body: { rowVersion: value.rowVersion },
            },
            signal,
          );
          if (!accept(value, signal)) return;
        }
        claimConfirmed = true;
        if (
          value.nextAction !== "use_component" ||
          value.expiresAt <= Date.now()
        )
          return;
        const config = await api.getNameComponentConfig(
          token,
          {
            path: { id: selected.instanceId },
            body: {
              operationId: value.operationId,
              pageKey: "instance_contacts",
              limit: 20,
              ...(selected.cursor ? { cursor: selected.cursor } : {}),
            },
          },
          signal,
        );
        if (signal.aborted || !valid()) return;
        if (
          config.operationId !== value.operationId ||
          config.instanceId !== selected.instanceId ||
          config.scopeVersion !== selected.scopeVersion ||
          config.pageUrl !== window.location.href ||
          config.expiresAt <= Date.now()
        )
          throw new ApiFailure(403);
        state.config = config;
      },
      (error) => {
        if (
          restoring &&
          !claimConfirmed &&
          error instanceof ApiFailure &&
          [401, 403, 404].includes(error.status)
        ) {
          state.requiresLogin = true;
          clearNameReturn();
          state.message =
            "无法恢复原 Maia 会话中的姓名授权。请先重新登录 Maia，再建立新的姓名上下文。";
        }
      },
    );
  }
  async function start(environment: "member" | "web") {
    if (!valid() || state.busy || Boolean(state.operation)) return;
    const generation = epoch;
    // Open synchronously in the user's click; network awaits must not consume popup permission.
    if (environment === "web") popup = window.open("about:blank", "_blank");
    requestId ??= crypto.randomUUID();
    await run(async (token, signal, selected) => {
      const value = await api.createNameContext(
        token,
        {
          path: { id: selected.instanceId },
          body: {
            clientRequestId: requestId!,
            pageKey: "instance_contacts",
            environment,
          },
        },
        signal,
      );
      accept(value, signal);
    });
    if (generation !== epoch) return;
    if (state.operation?.nextAction === "authorize") openAuthorization(false);
    else {
      popup?.close();
      popup = null;
    }
  }
  function openAuthorization(allowOpen = true) {
    const op = state.operation;
    if (
      !op ||
      state.busy ||
      op.nextAction !== "authorize" ||
      !op.authorizationUrl ||
      !valid() ||
      op.expiresAt <= Date.now()
    )
      return;
    let url: URL;
    try {
      url = new URL(op.authorizationUrl);
    } catch {
      state.message = "姓名授权入口无效，请联系管理员核对配置。";
      return;
    }
    const endpoint =
      op.environment === "web"
        ? "https://login.work.weixin.qq.com/wwlogin/sso/login"
        : "https://open.weixin.qq.com/connect/oauth2/authorize";
    if (
      url.username ||
      url.password ||
      url.origin + url.pathname !== endpoint
    ) {
      state.message = "姓名授权入口无效，请联系管理员核对配置。";
      return;
    }
    if (op.environment === "web") {
      if (!popup && allowOpen) popup = window.open("about:blank", "_blank");
      if (popup) popup.location.replace(url.href);
      else state.message = "浏览器阻止了授权窗口，请点击“打开姓名授权”重试。";
    } else {
      const returnPath = businessReturnPath(
        window.location.href,
        window.location.origin,
      );
      if (!returnPath) return;
      if (!saveReturn()) {
        state.message =
          "无法保存本次页面授权关联，请允许当前标签页的会话存储后重试。";
        return;
      }
      window.location.assign(url.href);
    }
  }
  async function receive(event: {
    origin: string;
    source: unknown;
    data: unknown;
  }) {
    const data = event.data;
    if (
      !popup ||
      event.source !== popup ||
      event.origin !== window.location.origin ||
      !data ||
      typeof data !== "object" ||
      Object.keys(data).join() !== "operationId" ||
      !("operationId" in data) ||
      data.operationId !== state.operation?.operationId
    )
      return;
    await query();
  }
  async function resume(saved: NameReturn) {
    if (
      !selection ||
      saved.instanceId !== selection.instanceId ||
      saved.returnPath !== window.location.pathname ||
      saved.expiresAt <= Date.now()
    )
      return;
    state.operation = {
      operationId: saved.operationId,
      instanceId: saved.instanceId,
      rowVersion: "1",
      environment: "member",
      expiresAt: saved.expiresAt,
      phase: "awaiting_verification",
      nextAction: "wait",
      authorizationUrl: null,
      safeReason: null,
    };
    clearNameReturn();
    await query(true);
  }
  function saveReturn() {
    const op = state.operation;
    if (!op || !selection || !valid() || typeof sessionStorage === "undefined")
      return;
    const returnPath = businessReturnPath(
      window.location.href,
      window.location.origin,
    );
    if (
      !returnPath ||
      !returnPath.endsWith(`/channel-app-instances/${op.instanceId}/contacts`)
    )
      return;
    try {
      sessionStorage.setItem(
        returnKey,
        JSON.stringify({
          operationId: op.operationId,
          instanceId: op.instanceId,
          returnPath,
          expiresAt: Math.min(op.expiresAt, Date.now() + 300000),
        } satisfies NameReturn),
      );
      return true;
    } catch {
      return false;
    }
  }
  function recreate() {
    const selected = selection;
    clear();
    selection = selected;
    if (typeof sessionStorage !== "undefined") clearNameReturn();
  }
  return {
    state,
    select,
    start,
    query,
    receive,
    openAuthorization,
    resume,
    recreate,
    saveReturn,
    suspend,
    dispose,
  };
}
export type NameContextController = ReturnType<
  typeof createNameContextController
>;
