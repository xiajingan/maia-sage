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
  let pending: RequestContactSyncData["body"] | undefined;
  let readGeneration = 0;
  function clear() {
    abort.abort();
    abort = new AbortController();
    readGeneration++;
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
        generation !== readGeneration
      )
        return;
      state.page =
        result.accessState === "active" ? result : { ...result, items: [] };
      state.sync = result.sync ?? undefined;
    } catch (error) {
      if (!signal.aborted && allowed() && generation === readGeneration)
        fail(error);
    } finally {
      if (!signal.aborted && generation === readGeneration)
        state.loading = false;
    }
  }
  function acceptSync(result: GetContactSyncResponse) {
    state.sync = result;
    if (result.scopeVersion !== state.page?.scopeVersion) {
      state.page = undefined;
      state.cursor = undefined;
      readGeneration++;
      state.loading = false;
    }
  }
  async function requestSync() {
    if (
      !allowed() ||
      state.syncing ||
      session.state.session?.membership.role !== "manager" ||
      state.page?.accessState !== "active"
    )
      return;
    if (!pending) pending = { clientRequestId: crypto.randomUUID() };
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
    const input = pending;
    const id = state.instanceId!;
    const signal = abort.signal;
    state.syncing = true;
    state.syncMessage = undefined;
    try {
      const result = await session.withAccess(signal, (token) =>
        api.requestContactSync(token, id, input, signal),
      );
      if (result && !signal.aborted && allowed()) {
        acceptSync(result);
        pending = undefined;
        state.unknownSync = false;
      }
    } catch (error) {
      if (!signal.aborted && allowed()) {
        state.unknownSync = true;
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
    state.syncing = true;
    try {
      const result = await session.withAccess(signal, (token) =>
        api.getContactSync(token, state.instanceId!, sync.syncId, signal),
      );
      if (result && !signal.aborted && allowed()) {
        acceptSync(result);
        state.syncMessage = undefined;
      }
    } catch (error) {
      if (!signal.aborted && allowed()) fail(error, true);
    } finally {
      if (!signal.aborted) state.syncing = false;
    }
  }
  function dispose() {
    disposed = true;
    clear();
    stop();
  }
  return { state, select, refresh, requestSync, retrySync, querySync, dispose };
}
export type ContactPageController = ReturnType<typeof createContactPage>;
