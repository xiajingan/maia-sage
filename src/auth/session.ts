import { shallowReactive } from "vue";
import type {
  GetSessionResponse,
  IssueTerminalActivationResponse,
  ListMembersResponse,
  ListTerminalsResponse,
} from "maia-mud-client";
export type Credentials = {
  accessToken: string;
  idToken: string;
  subject: string;
  expiresAt: number;
  returnPath?: string;
};
export interface Oidc {
  signIn(
    restore?: boolean,
    options?: { sameSessionOnly: boolean },
  ): Promise<void>;
  callback(url: string): Promise<Credentials>;
  clear(preserveAuthorizationState?: boolean): void;
}
const recoveryBlockedKey = "sage.auth.recovery-blocked";
export const LOGOUT_TIMEOUT_MS = 10_000;
export interface Api {
  session(token: string): Promise<GetSessionResponse>;
  members(token: string, workspaceId: string): Promise<ListMembersResponse>;
  issueTerminalActivation(
    token: string,
    signal: AbortSignal,
  ): Promise<IssueTerminalActivationResponse>;
  listTerminals(
    token: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<ListTerminalsResponse>;
  logout(
    input: {
      idTokenHint: string;
      logoutRequestId: string;
    },
    signal?: AbortSignal,
  ): Promise<void>;
}
export type Phase =
  | "signed-out"
  | "authenticating"
  | "loading"
  | "ready"
  | "error"
  | "degraded"
  | "forbidden"
  | "logout-pending"
  | "logout-unknown";
export type SessionState = {
  phase: Phase;
  session?: GetSessionResponse;
  members?: ListMembersResponse;
  message?: string;
  requestId?: string;
  canReload?: boolean;
  canLogout: boolean;
};
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public requestId?: string,
    public recovery?: string,
  ) {
    super("请求未完成");
  }
}
export function createSessionController({
  oidc,
  api,
  now = Date.now,
}: {
  oidc: Oidc;
  api: Api;
  now?: () => number;
}) {
  const state = shallowReactive<SessionState>({
    phase: "signed-out",
    canLogout: false,
  });
  // A non-secret UX intent shared by this origin, never an authorization fact.
  let recoveryBlocked = false;
  function blockRecovery(blocked: boolean) {
    recoveryBlocked = blocked;
    try {
      if (blocked) localStorage.setItem(recoveryBlockedKey, "true");
      else localStorage.removeItem(recoveryBlockedKey);
    } catch {
      recoveryBlocked = true;
    }
  }
  function isRecoveryBlocked() {
    try {
      return (
        recoveryBlocked || localStorage.getItem(recoveryBlockedKey) !== null
      );
    } catch {
      return true;
    }
  }
  let restoring = false;
  let epoch = 0;
  let credentials: Credentials | undefined;
  const reset = (phase: Phase, preserveReadOnly = false) => {
    state.phase = phase;
    if (!preserveReadOnly) {
      state.session = undefined;
      state.members = undefined;
    }
    state.message = undefined;
    state.requestId = undefined;
    state.canReload = Boolean(credentials);
    state.canLogout = Boolean(credentials);
  };
  async function callback(url: string) {
    const current = ++epoch;
    restoring = false;
    activeLogout?.abort();
    operation = undefined;
    pending = false;
    credentials = undefined;
    reset("authenticating");
    try {
      const result = await oidc.callback(url);
      if (current !== epoch) return;
      if (
        !Number.isSafeInteger(result.expiresAt) ||
        result.expiresAt <= now() + 5_000
      )
        throw new Error("登录凭据到期信息无效");
      credentials = result;
      await readSession(false);
      if (current === epoch) {
        if (state.session) return result.returnPath;
        blockRecovery(true);
      }
    } catch {
      if (current === epoch) {
        credentials = undefined;
        blockRecovery(true);
        oidc.clear();
        reset("error");
        state.message = "登录未完成，请重新登录。";
      }
    }
  }
  function load() {
    return readSession(true);
  }
  async function readSession(allowRecovery: boolean) {
    if (
      !credentials ||
      state.phase === "loading" ||
      (allowRecovery && state.phase === "authenticating")
    )
      return;
    const current = epoch;
    const auth = credentials;
    if (auth.expiresAt <= now() + 5_000) {
      await expired(allowRecovery);
      return;
    }
    reset("loading");
    try {
      const session = await api.session(auth.accessToken);
      if (current !== epoch) return;
      if (session.user.id !== auth.subject) {
        fail(new ApiFailure(401), false);
        return;
      }
      if (auth.expiresAt <= now() + 5_000) {
        await expired(allowRecovery);
        return;
      }
      state.session = session;
      try {
        const members = await api.members(
          auth.accessToken,
          session.rootWorkspace.id,
        );
        if (current !== epoch) return;
        state.members = members;
        state.phase = "ready";
      } catch (error) {
        if (current !== epoch) return;
        if (expiredUnauthorized(error, auth)) await expired(allowRecovery);
        else fail(error, true);
      }
    } catch (error) {
      if (current !== epoch) return;
      if (expiredUnauthorized(error, auth)) await expired(allowRecovery);
      else fail(error, false);
    }
  }
  function expiredUnauthorized(error: unknown, auth: Credentials) {
    // The dispatch margin is not evidence that an in-flight 401 is expiry.
    return (
      error instanceof ApiFailure &&
      error.status === 401 &&
      now() >= auth.expiresAt
    );
  }
  async function expired(allowRecovery: boolean) {
    if (allowRecovery) await signIn(true, { sameSessionOnly: true });
    else {
      credentials = undefined;
      blockRecovery(true);
      oidc.clear();
      reset("error");
      state.message = "登录未完成，请重新登录。";
    }
  }
  function fail(error: unknown, partial: boolean) {
    const status = error instanceof ApiFailure ? error.status : 0;
    const requestId = error instanceof ApiFailure ? error.requestId : undefined;
    if (status === 401 || status === 403 || status === 404) {
      blockRecovery(true);
      ++epoch;
      credentials = undefined;
      oidc.clear();
      reset(status === 401 ? "signed-out" : "forbidden");
      state.message =
        status === 401
          ? "登录已失效，请重新登录。"
          : "当前账号已无权访问此工作空间。";
    } else {
      state.members = undefined;
      state.phase = partial ? "degraded" : "error";
      state.message = partial
        ? "成员信息暂时不可用，工作空间资料仍可查看。"
        : "暂时无法读取工作空间，请稍后重试。";
    }
    state.requestId = requestId;
  }
  async function withAccess<T>(
    signal: AbortSignal,
    request: (token: string) => Promise<T>,
    invalidateForbidden = false,
  ): Promise<T | undefined> {
    const current = epoch;
    const session = state.session;
    const auth = credentials;
    const isCurrent = () =>
      !signal.aborted && current === epoch && state.session === session;
    if (!auth || !session || !isCurrent() || state.phase === "authenticating")
      return;
    if (auth.expiresAt <= now() + 5_000) {
      await signIn(true, { sameSessionOnly: true });
      return; // A top-level navigation must never dispatch the original action.
    }
    try {
      const result = await request(auth.accessToken);
      if (isCurrent()) return result;
    } catch (error) {
      if (!isCurrent()) return;
      if (expiredUnauthorized(error, auth)) {
        await expired(true);
        return; // The already sent request may have committed. Never replay it.
      }
      if (
        error instanceof ApiFailure &&
        (error.status === 401 || (invalidateForbidden && error.status === 403))
      )
        fail(error, false);
      else throw error;
    }
  }
  function issueTerminalActivation(signal: AbortSignal) {
    return withAccess(
      signal,
      (token) => api.issueTerminalActivation(token, signal),
      true,
    );
  }
  function listTerminals(cursor: string | undefined, signal: AbortSignal) {
    return withAccess(
      signal,
      (token) => api.listTerminals(token, cursor, signal),
      true,
    );
  }
  let operation:
    | {
        input: { idTokenHint: string; logoutRequestId: string };
        created: number;
        epoch: number;
      }
    | undefined;
  let pending = false;
  let activeLogout: AbortController | undefined;
  async function signIn(
    restore = false,
    options?: { sameSessionOnly: boolean },
  ) {
    if (state.phase === "authenticating" && (restore || !restoring)) return;
    const current = ++epoch;
    if (restore && isRecoveryBlocked()) {
      credentials = undefined;
      oidc.clear();
      reset("signed-out");
      return;
    }
    restoring = restore;
    if (!restore) {
      credentials = undefined;
      blockRecovery(false);
    }
    activeLogout?.abort();
    operation = undefined;
    pending = false;
    oidc.clear();
    try {
      // Capture the current stable path before synchronous session watchers navigate home.
      const navigation = oidc.signIn(restore, options);
      // Keep only the existing read-only view until pagehide saves its original references.
      // The epoch and authenticating guard prevent business dispatch or late writes.
      reset("authenticating", restore);
      await navigation;
    } catch {
      if (current === epoch) {
        credentials = undefined;
        if (restore) blockRecovery(true);
        reset("error");
        state.message = "无法打开登录页，请重试。";
      }
    }
  }
  async function logout() {
    if (pending) return;
    const idTokenHint = credentials?.idToken;
    blockRecovery(true);
    ++epoch;
    credentials = undefined;
    oidc.clear();
    reset("signed-out");
    if (!idTokenHint) return;
    operation = {
      input: {
        idTokenHint,
        logoutRequestId: crypto.randomUUID(),
      },
      created: Date.now(),
      epoch,
    };
    await retryLogout();
  }
  async function retryLogout() {
    const op = operation;
    if (!op || pending) return;
    if (Date.now() - op.created > 600000) {
      operation = undefined;
      reset("signed-out");
      state.message = "本机已退出，撤销核实窗口已结束。请重新登录。";
      return;
    }
    pending = true;
    state.phase = "logout-pending";
    const abort = new AbortController();
    activeLogout = abort;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new ApiFailure(0));
      }, LOGOUT_TIMEOUT_MS);
    });
    try {
      await Promise.race([api.logout(op.input, abort.signal), timeout]);
      if (op.epoch === epoch) {
        operation = undefined;
        reset("signed-out");
        state.message = "已退出登录。";
      }
    } catch {
      if (op.epoch === epoch) {
        state.phase = "logout-unknown";
        state.message = "本机已退出，会话撤销待核实。请重试核实。";
      }
    } finally {
      clearTimeout(timer);
      if (activeLogout === abort) activeLogout = undefined;
      if (op.epoch === epoch) pending = false;
    }
  }
  function dispose() {
    ++epoch;
    credentials = undefined;
    activeLogout?.abort();
    operation = undefined;
    pending = false;
    oidc.clear(true);
    reset("signed-out");
  }
  return {
    state,
    signIn,
    callback,
    load,
    logout,
    retryLogout,
    dispose,
    listTerminals,
    issueTerminalActivation,
    withAccess,
  };
}
