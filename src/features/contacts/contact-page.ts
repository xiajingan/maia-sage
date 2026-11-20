import { shallowReactive, watch } from "vue";
import type {
  ListContactsResponse,
  GetContactSyncResponse,
  RequestContactSyncData,
} from "maia-mud-client";
import type { WecomApi } from "../../api/mud";
import { ApiFailure, type createSessionController } from "../../auth/session";
export function createContactPage({
  api,
  session,
}: {
  api: WecomApi;
  session: ReturnType<typeof createSessionController>;
}) {
  const state = shallowReactive<{
    page?: ListContactsResponse;
    sync?: GetContactSyncResponse;
    loading: boolean;
    syncing: boolean;
    forbidden: boolean;
    message?: string;
    syncMessage?: string;
    requestId?: string;
    cursor?: string;
    instanceId?: string;
    workspaceId?: string;
    unknownSync: boolean;
  }>({ loading: false, syncing: false, forbidden: false, unknownSync: false });
  let abort = new AbortController();
  let disposed = false;
  // A recheck confirms its original request, not a replacement page summary.
  let pending:
    | { input: RequestContactSyncData["body"]; factsGeneration: number }
    | undefined;
  let readGeneration = 0;
  let acceptedFactsGeneration = 0;
  let invalidatedScopeVersion: string | undefined;
  function clear() {
    abort.abort();
    abort = new AbortController();
    readGeneration++;
    acceptedFactsGeneration++;
    invalidatedScopeVersion = undefined;
    state.page = undefined;
    state.sync = undefined;
    state.loading = false;
    state.syncing = false;
    state.message = undefined;
    state.syncMessage = undefined;
    state.requestId = undefined;
    state.cursor = undefined;
    state.unknownSync = false;
    pending = undefined;
  }
  const stop = watch(
    () => session.state.session,
    () => {
      clear();
      state.instanceId = undefined;
      state.workspaceId = undefined;
    },
    { flush: "sync" },
  );
  function allowed() {
    return (
      !disposed &&
      !state.forbidden &&
      !!state.instanceId &&
      session.state.session?.rootWorkspace.id === state.workspaceId
    );
  }
  function fail(error: unknown, sync = false) {
    if (error instanceof ApiFailure && [403, 404].includes(error.status)) {
      clear();
      state.forbidden = true;
      state.message = "当前无权读取此实例的联系人，请核对工作空间与权限。";
      return;
    }
    if (sync) state.syncMessage = "同步结果待核实，请核对原同步请求。";
    else {
      state.page = undefined;
      state.message =
        "暂时无法读取联系人，已停止显示旧资料。请重试核对当前权限。";
    }
    state.requestId = error instanceof ApiFailure ? error.requestId : undefined;
  }
  async function select(workspaceId: string, instanceId: string) {
    clear();
    state.forbidden = false;
    state.workspaceId = workspaceId;
    state.instanceId = instanceId;
    if (!allowed()) {
      state.forbidden = true;
      state.message = "当前工作空间与联系人入口不匹配。";
      return;
    }
    await refresh();
  }
  async function refresh(cursor: string | undefined = state.cursor) {
    cursor = cursor || undefined;
    if (!allowed() || state.loading) return;
    const signal = abort.signal;
    const generation = ++readGeneration;
    const factsGeneration = acceptedFactsGeneration;
    const id = state.instanceId!;
    state.loading = true;
    state.message = undefined;
    state.requestId = undefined;
    state.page = undefined;
    state.cursor = cursor;
    try {
      const result = await session.withAccess(signal, (token) =>
        api.listContacts(token, id, cursor, signal),
      );
      if (
        !result ||
        signal.aborted ||
        !allowed() ||
        generation !== readGeneration ||
        factsGeneration !== acceptedFactsGeneration
      )
        return;
      if (
        result.accessState === "active" &&
        result.scopeVersion === invalidatedScopeVersion
      ) {
        state.message =
          "授权范围已变化，尚未取得更新后的联系人。请刷新联系人重试。";
        return;
      }
      acceptedFactsGeneration++;
      state.page =
        result.accessState === "active" ? result : { ...result, items: [] };
      state.sync = result.sync ?? undefined;
    } catch (error) {
      if (
        !signal.aborted &&
        allowed() &&
        generation === readGeneration &&
        factsGeneration === acceptedFactsGeneration
      )
        fail(error);
    } finally {
      if (!signal.aborted && generation === readGeneration)
        state.loading = false;
    }
  }
  function refreshAfterScopeChange(previousVersion: string) {
    if (!allowed() || state.page?.scopeVersion !== previousVersion) return;
    invalidatedScopeVersion = previousVersion;
    acceptedFactsGeneration++;
    state.sync = undefined;
    state.syncMessage = undefined;
    // The old cursor belongs to the invalidated scope.
    return refresh("");
  }
  function acceptSync(result: GetContactSyncResponse) {
    // Only an answer based on the still-current facts reaches this boundary.
    acceptedFactsGeneration++;
    state.sync = result;
    // A different scope makes these rows incompatible; it does not imply ordering.
    if (result.scopeVersion !== state.page?.scopeVersion) {
      state.page = undefined;
      state.cursor = undefined;
      readGeneration++;
      state.loading = false;
    }
  }
  function canRequestSync() {
    if (
      !allowed() ||
      session.state.session?.membership.role !== "manager"
    )
      return false;
    return (
      state.page?.accessState === "active" ||
      (state.page?.accessState === "pending_verification" &&
        state.page.safeReason === "provider_invalid_response" &&
        state.sync?.phase === "failed" &&
        state.sync.safeReason === "provider_invalid_response")
    );
  }
  async function requestSync() {
    if (state.syncing || !canRequestSync()) return;
    if (!pending)
      pending = {
        input: { clientRequestId: crypto.randomUUID() },
        factsGeneration: acceptedFactsGeneration,
      };
    await retrySync();
  }
  async function retrySync() {
    if (
      !allowed() ||
      state.syncing ||
      !pending ||
      session.state.session?.membership.role !== "manager"
    )
      return;
    const { input, factsGeneration } = pending;
    const requestFactsGeneration = acceptedFactsGeneration;
    const id = state.instanceId!;
    const signal = abort.signal;
    state.syncing = true;
    state.syncMessage = undefined;
    try {
      const result = await session.withAccess(signal, (token) =>
        api.requestContactSync(token, id, input, signal),
      );
      if (result && !signal.aborted && allowed()) {
        if (factsGeneration === acceptedFactsGeneration) acceptSync(result);
        pending = undefined;
        state.unknownSync = false;
      }
    } catch (error) {
      if (!signal.aborted && allowed()) {
        state.unknownSync = true;
        if (requestFactsGeneration === acceptedFactsGeneration)
          fail(error, true);
      }
    } finally {
      if (!signal.aborted) state.syncing = false;
    }
  }
  async function querySync() {
    const sync = state.sync;
    if (!sync || !allowed() || state.syncing) return;
    const signal = abort.signal;
    const factsGeneration = acceptedFactsGeneration;
    state.syncing = true;
    try {
      const result = await session.withAccess(signal, (token) =>
        api.getContactSync(token, state.instanceId!, sync.syncId, signal),
      );
      if (
        result &&
        !signal.aborted &&
        allowed() &&
        factsGeneration === acceptedFactsGeneration
      ) {
        acceptSync(result);
        state.syncMessage = undefined;
      }
    } catch (error) {
      if (
        !signal.aborted &&
        allowed() &&
        factsGeneration === acceptedFactsGeneration
      )
        fail(error, true);
    } finally {
      if (!signal.aborted) state.syncing = false;
    }
  }
  function dispose() {
    disposed = true;
    clear();
    stop();
  }
  return {
    state,
    select,
    refresh,
    refreshAfterScopeChange,
    canRequestSync,
    requestSync,
    retrySync,
    querySync,
    dispose,
  };
}
export type ContactPageController = ReturnType<typeof createContactPage>;
