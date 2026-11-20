import { shallowReactive, watch } from "vue";
import type { CreateNameContextResponse } from "maia-mud-client";
import { Check } from "typebox/value";
import { NameContextViewSchema } from "maia-mud-client/schemas";
import type { NameComponentConfig } from "./wecom-sdk";
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
type KnownNameReturn = {
  operationId: string;
  instanceId: string;
  returnPath: string;
  expiresAt: number;
};
type PendingNameReturn = {
  kind: "pending-create";
  clientRequestId: string;
  environment: "member" | "web";
  userId: string;
  workspaceId: string;
  instanceId: string;
  scopeVersion: string;
  returnPath: string;
  expiresAt: number;
};
export type NameReturn = KnownNameReturn | PendingNameReturn;
function storedNameReturn(): { value?: NameReturn; unresolved: boolean } {
  try {
    const raw = sessionStorage.getItem(returnKey);
    if (raw === null) return { unresolved: false };
    const value = readNameReturn();
    return { value, unresolved: !value || "kind" in value };
  } catch {
    return { unresolved: true };
  }
}
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
    if (!raw || typeof raw !== "object") return;
    const value = raw as NameReturn;
    const pending = "kind" in value;
    const fields = pending
      ? "clientRequestId,environment,expiresAt,instanceId,kind,returnPath,scopeVersion,userId,workspaceId"
      : "expiresAt,instanceId,operationId,returnPath";
    if (Object.keys(value).sort().join() !== fields) return;
    if (
      !Check(NameContextViewSchema.properties.instanceId, value.instanceId) ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt > Date.now() + 300000 ||
      (!pending && value.expiresAt <= Date.now()) ||
      businessReturnPath(value.returnPath, location.origin) !==
        value.returnPath ||
      !value.returnPath.endsWith(
        `/channel-app-instances/${value.instanceId}/contacts`,
      )
    )
      return;
    if (pending) {
      if (
        value.kind !== "pending-create" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          value.clientRequestId,
        ) ||
        !["member", "web"].includes(value.environment) ||
        ![value.userId, value.workspaceId, value.scopeVersion].every((id) =>
          Check(NameContextViewSchema.properties.instanceId, id),
        ) ||
        value.returnPath !==
          `/workspaces/${value.workspaceId}/channel-app-instances/${value.instanceId}/contacts`
      )
        return;
    } else if (
      !Check(NameContextViewSchema.properties.operationId, value.operationId)
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
  if (saved && !("kind" in saved) && saved.operationId === id) return saved;
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
    config?: NameComponentConfig;
    busy: boolean;
    message?: string;
    blocked: boolean;
    requiresLogin?: boolean;
    pendingCreate?: boolean;
  }>({ busy: false, blocked: false });
  let selection: NameSelection | undefined;
  let abort = new AbortController();
  let epoch = 0;
  let popup: Window | null = null;
  let requestId: string | undefined;
  let pendingCreate: PendingNameReturn | undefined;
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
    pendingCreate = undefined;
    state.pendingCreate = false;
  }
  function select(value?: NameSelection) {
    const retain =
      value &&
      selection &&
      value.workspaceId === selection.workspaceId &&
      value.instanceId === selection.instanceId &&
      value.scopeVersion === selection.scopeVersion;
    if (selection && !retain && !leaving && !storedNameReturn().unresolved)
      clearNameReturn();
    const op = retain ? state.operation : undefined;
    clear();
    selection = value;
    if (op) accept(op, abort.signal);
    else if (value) restorePending();
  }
  const stopSession = watch(
    () => session.state.session,
    () => {
      if (!session.state.session && !leaving) clearNameReturn();
      select(undefined);
    },
    { flush: "sync" },
  );
  const stopPhase = watch(
    () => session.state.phase,
    (phase) => {
      if (phase === "authenticating") suspend();
    },
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
    stopPhase();
    if (!leaving && !storedNameReturn().unresolved) clearNameReturn();
    if (typeof window !== "undefined")
      window.removeEventListener?.(navigationEvent, markLeaving);
    clear();
    selection = undefined;
  }
  function restorePending() {
    const saved = storedNameReturn();
    if (!saved.unresolved) return;
    state.pendingCreate = true;
    const value = saved.value;
    if (
      !value ||
      !("kind" in value) ||
      !selection ||
      value.userId !== session.state.session?.user.id ||
      value.workspaceId !== selection.workspaceId ||
      value.instanceId !== selection.instanceId ||
      value.scopeVersion !== selection.scopeVersion ||
      value.returnPath !== window.location.pathname ||
      value.expiresAt <= Date.now()
    ) {
      state.blocked = true;
      state.message =
        "原姓名发起结果仍待核对，当前引用已过期、损坏或与账号/范围不符。可放弃本次姓名核验；这只清除本地引用，不撤销服务端历史。";
      return;
    }
    pendingCreate = value;
    requestId = value.clientRequestId;
    state.message = "原姓名发起结果未知，请显式核对原请求；不会自动再次发送。";
  }
  function valid() {
    return (
      selection &&
      session.state.phase !== "authenticating" &&
      session.state.session?.rootWorkspace.id === selection.workspaceId
    );
  }
  async function run(
    work: (signal: AbortSignal, selected: NameSelection) => Promise<void>,
    onFailure?: (error: unknown) => void,
  ) {
    if (!valid() || !selection || state.busy) return;
    const generation = epoch,
      signal = abort.signal,
      selected = selection;
    state.busy = true;
    try {
      await work(signal, selected);
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
    pendingCreate = undefined;
    state.pendingCreate = false;
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
  function applyConfig(config: NameComponentConfig, selected: NameSelection) {
    if (
      config.instanceId !== selected.instanceId ||
      config.scopeVersion !== selected.scopeVersion ||
      config.pageUrl !== window.location.href ||
      config.expiresAt <= Date.now()
    )
      throw new ApiFailure(403);
    state.config = config;
  }

  async function loadBoundConfig(previous?: NameComponentConfig) {
    if (state.operation || state.pendingCreate || previous !== state.config)
      return;
    await run(
      async (signal, selected) => {
        const config = await session.withAccess(signal, (token) =>
          api.getBoundNameComponentConfig(
            token,
            {
              path: { id: selected.instanceId },
              body: {
                pageKey: "instance_contacts",
                limit: 20,
                ...(selected.cursor ? { cursor: selected.cursor } : {}),
              },
            },
            signal,
          ),
        );
        if (!config || signal.aborted || !valid()) return;
        if (previous && config.expiresAt <= previous.expiresAt)
          throw new ApiFailure(403);
        applyConfig(config, selected);
      },
      () => {
        // An explicit browser authorization starts its own gated operation.
        // Preserve any outstanding manual operation for reconciliation.
        if (!state.pendingCreate && !state.operation) state.blocked = false;
      },
    );
  }

  async function query(restoring = false) {
    const op = state.operation;
    if (!op || state.blocked) return;
    let claimConfirmed = false;
    await run(
      async (signal, selected) => {
        let value = await session.withAccess(signal, (token) =>
          api.getNameContext(
            token,
            { path: { id: selected.instanceId, operationId: op.operationId } },
            signal,
          ),
        );
        if (!value || !accept(value, signal)) return;
        if (value.nextAction === "complete") {
          const rowVersion = value.rowVersion;
          const completed = await session.withAccess(signal, (token) =>
            api.completeNameContext(
              token,
              {
                path: { id: selected.instanceId, operationId: op.operationId },
                body: { rowVersion },
              },
              signal,
            ),
          );
          if (!completed || !accept(completed, signal)) return;
          value = completed;
        }
        claimConfirmed = true;
        if (
          value.nextAction !== "use_component" ||
          value.expiresAt <= Date.now()
        )
          return;
        const config = await session.withAccess(signal, (token) =>
          api.getNameComponentConfig(
            token,
            {
              path: { id: selected.instanceId },
              body: {
                operationId: op.operationId,
                pageKey: "instance_contacts",
                limit: 20,
                ...(selected.cursor ? { cursor: selected.cursor } : {}),
              },
            },
            signal,
          ),
        );
        if (!config || signal.aborted || !valid()) return;
        if (config.operationId !== value.operationId) throw new ApiFailure(403);
        applyConfig(config, selected);
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
    restorePending();
    if (state.blocked) return;
    environment = pendingCreate?.environment ?? environment;
    const generation = epoch;
    // Open synchronously in the user's click; network awaits must not consume popup permission.
    if (environment === "web") popup = window.open("about:blank", "_blank");
    requestId ??= crypto.randomUUID();
    await run(async (signal, selected) => {
      const value = await session.withAccess(signal, async (token) => {
        pendingCreate ??= {
          kind: "pending-create",
          clientRequestId: requestId!,
          environment,
          userId: session.state.session!.user.id,
          workspaceId: selected.workspaceId,
          instanceId: selected.instanceId,
          scopeVersion: selected.scopeVersion,
          returnPath: window.location.pathname,
          expiresAt: Date.now() + 300000,
        };
        state.pendingCreate = true;
        if (!saveReturn()) {
          state.blocked = true;
          state.message =
            "无法保存原姓名请求的核对引用，本次未发送。请允许会话存储后放弃本次姓名核验再发起。";
          return;
        }
        return api.createNameContext(
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
      });
      if (value) accept(value, signal);
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
      if (popup?.closed) popup = null;
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
    if ("kind" in saved) {
      restorePending();
      return;
    }
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
    // Keep the original reference until an authenticated result replaces or rejects it.
    await query(true);
  }
  function saveReturn() {
    const op = state.operation;
    if (!selection || !valid() || typeof sessionStorage === "undefined") return;
    if (!op && pendingCreate) {
      try {
        sessionStorage.setItem(returnKey, JSON.stringify(pendingCreate));
        return true;
      } catch {
        return false;
      }
    }
    if (!op) return;
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
    if (state.pendingCreate) return;
    abandon();
  }
  function abandon() {
    const selected = selection;
    clear();
    selection = selected;
    if (typeof sessionStorage !== "undefined") clearNameReturn();
  }
  return {
    state,
    select,
    loadBoundConfig,
    start,
    query,
    receive,
    openAuthorization,
    resume,
    recreate,
    abandon,
    saveReturn,
    suspend,
    dispose,
  };
}
export type NameContextController = ReturnType<
  typeof createNameContextController
>;
