import { Check } from "typebox/value";
import {
  InstallViewSchema,
  InstallRecoveryInputSchema,
} from "maia-mud-client/schemas";
import { shallowReactive, watch } from "vue";
import type {
  CreateWecomInstallOperationData,
  GetWecomInstallOperationResponse,
  GetWecomInstallRecoveryResponse,
  GetWecomInstallRecoverySourceResponse,
  CreateWecomInstallRecoveryData,
  ListChannelAppInstancesResponse,
} from "maia-mud-client";
import { MudNotFound, type WecomApi } from "../../api/mud";
import { ApiFailure, type createSessionController } from "../../auth/session";
type Session = ReturnType<typeof createSessionController>;
type Operation =
  GetWecomInstallOperationResponse | GetWecomInstallRecoveryResponse;
type RecoveryInput = CreateWecomInstallRecoveryData["body"];
type RecoveryPending = { sourceId: string; input: RecoveryInput };
type StartInput = CreateWecomInstallOperationData["body"];
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const STORAGE_KEY = "sage.wecom.install";
function browserStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
export function createWecomPage({
  api,
  session,
  storage = browserStorage(),
  writeClipboard = (text: string) => navigator.clipboard.writeText(text),
}: {
  api: WecomApi;
  session: Session;
  storage?: StoragePort;
  writeClipboard?: (text: string) => Promise<void>;
}) {
  const state = shallowReactive<{
    operation?: Operation;
    kind?: "install" | "recovery";
    source?: GetWecomInstallRecoverySourceResponse;
    unknownRecovery: boolean;
    launchExpired: boolean;
    handoffFallback: boolean;
    handoffMessage?: string;
    operationId?: string;
    instances?: ListChannelAppInstancesResponse;
    busy: boolean;
    listBusy: boolean;
    message?: string;
    listError?: string;
    requestId?: string;
    forbidden: boolean;
    unknownStart: boolean;
    mustQuery: boolean;
    instanceCursor?: string;
  }>({
    unknownRecovery: false,
    launchExpired: false,
    handoffFallback: false,
    busy: false,
    listBusy: false,
    forbidden: false,
    unknownStart: false,
    mustQuery: false,
  });
  let launchTimer: ReturnType<typeof setTimeout> | undefined;
  let abort = new AbortController();
  let disposed = false;
  let pending: StartInput | undefined;
  let recoveryPending: RecoveryPending | undefined;
  let createdRecoveryKey: string | undefined;
  let bound = session.state.session;
  let listCursor: string | undefined;
  let missingSavedOperation: string | undefined;
  let needsListConfirmation = false;
  function save() {
    try {
      storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({
          workspaceId: bound?.rootWorkspace.id,
          operationId: state.operationId,
          pending,
          kind: state.kind,
          recoveryPending,
          sourceId:
            state.operation && "sourceOperationId" in state.operation
              ? state.operation.sourceOperationId
              : recoveryPending?.sourceId,
          sourceRowVersion:
            state.operation && "sourceRowVersion" in state.operation
              ? state.operation.sourceRowVersion
              : recoveryPending?.input.rowVersion,
          clientRequestId: createdRecoveryKey,
          mustQuery: state.mustQuery,
        }),
      );
      return Boolean(storage);
    } catch {
      return false;
    }
  }
  function clear() {
    clearTimeout(launchTimer);
    state.launchExpired = false;
    state.handoffFallback = false;
    state.handoffMessage = undefined;
    abort.abort();
    abort = new AbortController();
    state.operation = undefined;
    state.source = undefined;
    state.kind = undefined;
    state.unknownRecovery = false;
    recoveryPending = undefined;
    createdRecoveryKey = undefined;
    state.instances = undefined;
    state.busy = false;
    state.listBusy = false;
    state.message = undefined;
    state.listError = undefined;
    state.requestId = undefined;
    state.unknownStart = false;
    state.mustQuery = false;
    state.instanceCursor = undefined;
    listCursor = undefined;
    missingSavedOperation = undefined;
    needsListConfirmation = false;
    state.operationId = undefined;
    pending = undefined;
  }
  const stop = watch(
    () =>
      [
        session.state.session,
        session.state.phase === "authenticating",
      ] as const,
    ([current, authenticating]) => {
      if (authenticating || current !== bound) {
        clear();
        bound = current;
        state.forbidden = false;
      }
    },
    { flush: "sync" },
  );
  function allowed() {
    return (
      !disposed &&
      !state.forbidden &&
      session.state.phase !== "authenticating" &&
      Boolean(bound) &&
      bound === session.state.session
    );
  }
  function fail(error: unknown, list = false) {
    if (error instanceof ApiFailure && [403, 404].includes(error.status)) {
      const originalPending = pending;
      const originalOperation = state.mustQuery ? state.operationId : undefined;
      clear();
      pending = originalPending;
      state.unknownStart = Boolean(pending);
      state.operationId = originalOperation;
      state.mustQuery = Boolean(originalOperation);
      state.forbidden = true;
      try {
        if (!pending && !state.mustQuery) storage?.removeItem(STORAGE_KEY);
      } catch {
        /* Optional storage. */
      }
      state.message = "当前无权访问此企微接入，请核对工作空间与权限。";
      return;
    }
    if (list) state.listError = "暂时无法读取企微实例，请重试。";
    else
      state.message = state.operationId
        ? "结果待核实，请查询原操作。"
        : "发起结果待核实，请核对原发起请求。";
    state.requestId = error instanceof ApiFailure ? error.requestId : undefined;
  }
  async function execute(
    request: (
      token: string,
      signal: AbortSignal,
    ) => Promise<Operation | undefined>,
    restoringKnownReference = false,
  ) {
    if (!allowed() || state.busy) return;
    const signal = abort.signal;
    state.busy = true;
    state.handoffFallback = false;
    state.handoffMessage = undefined;
    state.message = undefined;
    state.requestId = undefined;
    try {
      const result = await session.withAccess(signal, (token) =>
        request(token, signal),
      );
      if (!result || signal.aborted || !allowed()) return;
      missingSavedOperation = undefined;
      if (state.operationId !== result.operationId && !recoveryPending)
        createdRecoveryKey = undefined;
      state.kind = "sourceOperationId" in result ? "recovery" : "install";
      state.operation = result;
      clearTimeout(launchTimer);
      state.handoffFallback = false;
      state.handoffMessage = undefined;
      state.launchExpired = result.expiresAt <= Date.now();
      if (!state.launchExpired && result.launch)
        launchTimer = setTimeout(
          () => {
            state.launchExpired = true;
            state.handoffFallback = false;
            state.handoffMessage = undefined;
            if (state.operation === result)
              state.operation = { ...result, launch: null };
          },
          Math.min(result.expiresAt - Date.now(), 2_147_483_647),
        );
      if (state.kind === "recovery") {
        state.source = undefined;
        if (recoveryPending)
          createdRecoveryKey = recoveryPending.input.clientRequestId;
        recoveryPending = undefined;
        state.unknownRecovery = false;
      }
      state.operationId = result.operationId;
      pending = undefined;
      state.unknownStart = false;
      state.mustQuery = result.nextAction === "query_original";
      save();
    } catch (error) {
      if (!signal.aborted && allowed()) {
        if (
          restoringKnownReference &&
          error instanceof ApiFailure &&
          error.status === 404 &&
          state.operationId &&
          !pending &&
          !state.mustQuery
        ) {
          // A rejected saved operation is not proof of current Workspace access.
          missingSavedOperation = state.operationId;
          await refreshInstances();
          return;
        }
        if (!(
          error instanceof ApiFailure && [403, 404].includes(error.status)
        )) {
          state.unknownStart = !state.operationId;
          state.mustQuery = Boolean(state.operationId);
          save();
        }
        fail(error);
      }
    } finally {
      if (!signal.aborted) state.busy = false;
    }
  }
  async function start(mode: StartInput["mode"]) {
    if (
      !allowed() ||
      state.busy ||
      needsListConfirmation ||
      session.state.session?.membership.role !== "manager" ||
      state.operationId ||
      recoveryPending ||
      pending
    )
      return;
    state.kind = "install";
    pending = { mode, clientRequestId: crypto.randomUUID() };
    save();
    await retryStart();
  }
  async function retryStart() {
    const input = pending;
    const workspaceId = bound?.rootWorkspace.id;
    if (!input || !workspaceId || state.operationId) return;
    await execute((token, signal) =>
      api.createWecomInstallOperation(token, workspaceId, input, signal),
    );
  }
  function authorizationUrl() {
    const op = state.operation;
    if (
      !allowed() ||
      state.launchExpired ||
      state.mustQuery ||
      state.unknownRecovery ||
      op?.nextAction !== "authorize" ||
      !op.launch ||
      op.expiresAt <= Date.now()
    )
      return;
    try {
      const url = new URL(op.launch.url);
      return url.protocol === "https:" ? op.launch.url : undefined;
    } catch {
      return;
    }
  }
  async function copyIdentityLink() {
    const op = state.operation;
    const url = authorizationUrl();
    if (
      !url ||
      op?.launch?.kind !== "member" ||
      !(
        state.kind === "recovery" ||
        op.safeReason === "administrator_identity_required"
      )
    )
      return;
    try {
      await writeClipboard(url);
      if (state.operation === op && authorizationUrl() === url) {
        state.handoffFallback = false;
        state.handoffMessage = "链接已复制，请在手机企业微信内打开。";
      }
    } catch {
      if (state.operation === op && authorizationUrl() === url) {
        state.handoffFallback = true;
        state.handoffMessage = "复制失败，请选择下方只读链接手工复制。";
      }
    }
  }
  async function readOperation(
    token: string,
    id: string,
    signal: AbortSignal,
  ): Promise<Operation | undefined> {
    let result: Operation;
    if (state.kind === "recovery")
      result = await api.getWecomInstallRecovery(token, id, signal);
    else if (state.kind === "install")
      result = await api.getWecomInstallOperation(token, id, signal);
    else {
      try {
        result = await api.getWecomInstallRecovery(token, id, signal);
      } catch (error) {
        if (!(error instanceof MudNotFound)) throw error;
        const legacy = await session.withAccess(signal, (freshToken) =>
          api.getWecomInstallOperation(freshToken, id, signal),
        );
        if (!legacy) return;
        result = legacy;
      }
    }
    if (signal.aborted || !allowed()) return result;
    if (!("sourceOperationId" in result) && result.phase === "expired") {
      const sourceId = result.operationId;
      const source = await session.withAccess(signal, (freshToken) =>
        api.getWecomInstallRecoverySource(
          freshToken,
          sourceId,
          undefined,
          signal,
        ),
      );
      if (!source) return;
      if (!signal.aborted && allowed()) state.source = source;
      if (source.recovery && !recoveryPending) return source.recovery;
    } else state.source = undefined;
    return result;
  }
  async function recover() {
    if (
      !allowed() ||
      state.busy ||
      recoveryPending ||
      state.mustQuery ||
      bound?.membership.role !== "manager"
    )
      return;
    const op = state.operation;
    if (!op) return;
    const sourceId =
      "sourceOperationId" in op
        ? op.sourceOperationId
        : state.source?.sourceOperationId;
    if (
      !sourceId ||
      !(op.nextAction === "recover" || state.source?.nextAction === "recover")
    )
      return;
    const rowVersion =
      "sourceOperationId" in op
        ? op.sourceRowVersion
        : state.source!.rowVersion;
    createdRecoveryKey = undefined;
    recoveryPending = {
      sourceId,
      input: { rowVersion, clientRequestId: crypto.randomUUID() },
    };
    state.unknownRecovery = true;
    if (!save()) {
      state.message = "无法保存核验请求，请恢复浏览器存储后重试。";
      recoveryPending = undefined;
      state.unknownRecovery = false;
      return;
    }
    await submitRecovery();
  }
  async function submitRecovery() {
    const original = recoveryPending;
    if (!original) return;
    await execute(async (token, signal) => {
      try {
        return await api.createWecomInstallRecovery(
          token,
          original.sourceId,
          original.input,
          signal,
        );
      } catch (error) {
        if (!(error instanceof ApiFailure && error.status === 409)) throw error;
        // A conflicting key never becomes an alias for another round.
        if (signal.aborted || !allowed()) throw error;
        recoveryPending = undefined;
        createdRecoveryKey = undefined;
        state.unknownRecovery = false;
        save();
        const source = await session.withAccess(signal, (freshToken) =>
          api.getWecomInstallRecoverySource(
            freshToken,
            original.sourceId,
            undefined,
            signal,
          ),
        );
        if (!source) return;
        if (!signal.aborted && allowed()) state.source = source;
        if (source.recovery) return source.recovery;
        return state.operation!;
      }
    });
  }
  async function retryRecovery(allowRetry = true) {
    const original = recoveryPending;
    if (!original || state.busy || !allowed()) return;
    let notCreated = false;
    await execute(async (token, signal) => {
      const source = await api.getWecomInstallRecoverySource(
        token,
        original.sourceId,
        original.input.clientRequestId,
        signal,
      );
      if (source.recovery) return source.recovery;
      notCreated = true;
      return undefined;
    });
    if (allowRetry && notCreated && allowed() && recoveryPending === original) {
      state.unknownRecovery = true;
      // Only this explicit retry may resend the exact original body/key.
      await submitRecovery();
    }
  }
  async function query() {
    if (recoveryPending) {
      await retryRecovery(false);
      return;
    }
    const id = state.operationId;
    if (id) await execute((token, signal) => readOperation(token, id, signal));
  }
  async function resume(id?: string) {
    if (disposed || !bound || bound !== session.state.session) return;
    if (!id) {
      // A list navigation cancels the old view, but never discards unknown writes.
      const originalPending = pending;
      const originalRecovery = recoveryPending;
      const originalKind = state.kind;
      const originalOperation =
        state.mustQuery || originalRecovery ? state.operationId : undefined;
      clear();
      pending = originalPending;
      recoveryPending = originalRecovery;
      state.kind = originalKind;
      state.unknownRecovery = Boolean(originalRecovery);
      state.unknownStart = Boolean(pending);
      state.operationId = originalOperation;
      state.mustQuery = Boolean(originalOperation);
      state.forbidden = false;
      needsListConfirmation = true;
    } else if (!allowed()) return;
    let restoringKnownReference = false;
    if (id && Check(InstallViewSchema.properties.operationId, id)) {
      if (id !== state.operationId) clear();
      state.operationId = id;
    }
    try {
      const saved: unknown = JSON.parse(
        storage?.getItem(STORAGE_KEY) ?? "null",
      );
      if (
        saved &&
        typeof saved === "object" &&
        "workspaceId" in saved &&
        saved.workspaceId === bound.rootWorkspace.id
      ) {
        const matchingRoute =
          !id || ("operationId" in saved && id === saved.operationId);
        if (
          matchingRoute &&
          "kind" in saved &&
          ["install", "recovery"].includes(String(saved.kind))
        )
          state.kind = saved.kind as "install" | "recovery";
        if (
          matchingRoute &&
          state.kind === "recovery" &&
          "clientRequestId" in saved &&
          typeof saved.clientRequestId === "string" &&
          saved.clientRequestId.length > 0 &&
          saved.clientRequestId.length <= 128
        )
          createdRecoveryKey = saved.clientRequestId;
        if (
          matchingRoute &&
          "recoveryPending" in saved &&
          saved.recoveryPending &&
          typeof saved.recoveryPending === "object" &&
          "sourceId" in saved.recoveryPending &&
          Check(
            InstallViewSchema.properties.operationId,
            saved.recoveryPending.sourceId,
          ) &&
          "input" in saved.recoveryPending &&
          Check(InstallRecoveryInputSchema, saved.recoveryPending.input)
        ) {
          recoveryPending = {
            sourceId: saved.recoveryPending.sourceId as string,
            input: saved.recoveryPending.input as RecoveryInput,
          };
          state.unknownRecovery = true;
        }
        if (
          "operationId" in saved &&
          typeof saved.operationId === "string" &&
          Check(InstallViewSchema.properties.operationId, saved.operationId)
        ) {
          if (
            (!id && !pending && !state.operationId) ||
            id === saved.operationId
          ) {
            state.operationId = saved.operationId;
            // Legacy records cannot prove that no complete request was left unknown.
            state.mustQuery =
              state.mustQuery ||
              !("mustQuery" in saved && saved.mustQuery === false);
            restoringKnownReference = !id && !state.mustQuery;
          }
        } else if (
          !id &&
          !state.operationId &&
          "pending" in saved &&
          saved.pending &&
          typeof saved.pending === "object" &&
          "clientRequestId" in saved.pending &&
          typeof saved.pending.clientRequestId === "string" &&
          saved.pending.clientRequestId.length > 0 &&
          saved.pending.clientRequestId.length <= 128 &&
          "mode" in saved.pending &&
          ["admin", "member"].includes(String(saved.pending.mode))
        ) {
          pending = {
            clientRequestId: saved.pending.clientRequestId,
            mode: saved.pending.mode as StartInput["mode"],
          };
          state.unknownStart = true;
        }
      }
    } catch {
      /* Invalid recovery references grant no access. */
    }
    const operationId = state.operationId;
    if (operationId)
      await execute(
        (token, signal) => readOperation(token, operationId, signal),
        restoringKnownReference,
      );
  }
  async function complete() {
    const op = state.operation;
    if (op?.nextAction !== "complete" || state.mustQuery) return;
    await execute((token, signal) => {
      // Persist uncertainty before dispatch; failed storage must not leave a stale false marker.
      state.mustQuery = true;
      if (!save()) throw new Error("无法保存原操作核对标记");
      return (
        state.kind === "recovery"
          ? api.completeWecomInstallRecovery
          : api.completeWecomInstallOperation
      )(token, op.operationId, { rowVersion: op.rowVersion }, signal);
    });
  }
  function newOperation() {
    if (
      recoveryPending ||
      state.mustQuery ||
      state.source?.nextAction === "recover" ||
      !["start_new"].includes(state.operation?.nextAction ?? "") ||
      state.busy
    )
      return;
    clear();
    state.operationId = undefined;
    pending = undefined;
    state.message = undefined;
    try {
      storage?.removeItem(STORAGE_KEY);
    } catch {
      /* Optional storage. */
    }
  }
  async function refreshInstances(cursor: string | undefined = listCursor) {
    cursor = cursor || undefined;
    const workspaceId = bound?.rootWorkspace.id;
    if (!workspaceId || !allowed() || state.listBusy) return;
    if (cursor !== listCursor) state.instances = undefined;
    listCursor = cursor;
    state.instanceCursor = cursor;
    const signal = abort.signal;
    state.listBusy = true;
    state.listError = undefined;
    try {
      const result = await session.withAccess(signal, (token) =>
        api.listChannelAppInstances(token, workspaceId, cursor, signal),
      );
      if (result && !signal.aborted && allowed()) {
        state.instances = result;
        needsListConfirmation = false;
        if (
          missingSavedOperation &&
          state.operationId === missingSavedOperation &&
          !pending &&
          !state.mustQuery
        ) {
          state.operation = undefined;
          state.operationId = undefined;
          missingSavedOperation = undefined;
          state.message = "原接入记录已不可访问，已返回当前空间的接入列表。";
          try {
            storage?.removeItem(STORAGE_KEY);
          } catch {
            /* Optional storage; the denied operation is never submitted again automatically. */
          }
        }
      }
    } catch (error) {
      if (!signal.aborted && allowed()) fail(error, true);
    } finally {
      if (!signal.aborted) state.listBusy = false;
    }
  }
  function dispose() {
    disposed = true;
    clear();
    stop();
  }
  return {
    state,
    start,
    retryStart,
    recover,
    authorizationUrl,
    copyIdentityLink,
    retryRecovery,
    resume,
    query,
    complete,
    newOperation,
    refreshInstances,
    dispose,
  };
}
export type WecomPageController = ReturnType<typeof createWecomPage>;
