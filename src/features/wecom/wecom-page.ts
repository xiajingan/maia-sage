import { Check } from "typebox/value";
import { InstallViewSchema } from "maia-mud-client/schemas";
import { shallowReactive, watch } from "vue";
import type {
  CreateWecomInstallOperationData,
  GetWecomInstallOperationResponse,
  ListChannelAppInstancesResponse,
} from "maia-mud-client";
import type { WecomApi } from "../../api/mud";
import { ApiFailure, type createSessionController } from "../../auth/session";
type Session = ReturnType<typeof createSessionController>;
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
}: {
  api: WecomApi;
  session: Session;
  storage?: StoragePort;
}) {
  const state = shallowReactive<{
    operation?: GetWecomInstallOperationResponse;
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
    busy: false,
    listBusy: false,
    forbidden: false,
    unknownStart: false,
    mustQuery: false,
  });
  let abort = new AbortController();
  let disposed = false;
  let pending: StartInput | undefined;
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
          mustQuery: state.mustQuery,
        }),
      );
      return Boolean(storage);
    } catch {
      return false;
    }
  }
  function clear() {
    abort.abort();
    abort = new AbortController();
    state.operation = undefined;
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
    () => session.state.session,
    () => {
      clear();
      bound = session.state.session;
      state.forbidden = false;
    },
    { flush: "sync" },
  );
  function allowed() {
    return (
      !disposed &&
      !state.forbidden &&
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
    ) => Promise<GetWecomInstallOperationResponse>,
    restoringKnownReference = false,
  ) {
    if (!allowed() || state.busy) return;
    const signal = abort.signal;
    state.busy = true;
    state.message = undefined;
    state.requestId = undefined;
    try {
      const result = await session.withAccess(signal, (token) =>
        request(token, signal),
      );
      if (!result || signal.aborted || !allowed()) return;
      missingSavedOperation = undefined;
      state.operation = result;
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
      pending
    )
      return;
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
  async function query() {
    const id = state.operationId;
    if (id)
      await execute((token, signal) =>
        api.getWecomInstallOperation(token, id, signal),
      );
  }
  async function resume(id?: string) {
    if (disposed || !bound || bound !== session.state.session) return;
    if (!id) {
      // A list navigation cancels the old view, but never discards unknown writes.
      const originalPending = pending;
      const originalOperation = state.mustQuery ? state.operationId : undefined;
      clear();
      pending = originalPending;
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
        (token, signal) =>
          api.getWecomInstallOperation(token, operationId, signal),
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
      return api.completeWecomInstallOperation(
        token,
        op.operationId,
        { rowVersion: op.rowVersion },
        signal,
      );
    });
  }
  function newOperation() {
    if (
      !["start_new"].includes(state.operation?.nextAction ?? "") ||
      state.busy
    )
      return;
    state.operation = undefined;
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
    resume,
    query,
    complete,
    newOperation,
    refreshInstances,
    dispose,
  };
}
export type WecomPageController = ReturnType<typeof createWecomPage>;
