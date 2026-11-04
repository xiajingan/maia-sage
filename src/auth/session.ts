import { shallowReactive } from "vue";
import type { GetSessionResponse, ListMembersResponse } from "maia-mud-client";
export type Credentials = {
  accessToken: string;
  idToken: string;
  subject: string;
};
export interface Oidc {
  signIn(restore?: boolean): Promise<void>;
  callback(url: string): Promise<Credentials>;
  clear(preserveAuthorizationState?: boolean): void;
}
export interface Api {
  session(token: string): Promise<GetSessionResponse>;
  members(token: string, workspaceId: string): Promise<ListMembersResponse>;
  logout(input: {
    idTokenHint: string;
    logoutRequestId: string;
  }): Promise<void>;
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
};
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public requestId?: string,
  ) {
    super("请求未完成");
  }
}
export function createSessionController({
  oidc,
  api,
}: {
  oidc: Oidc;
  api: Api;
}) {
  const state = shallowReactive<SessionState>({ phase: "signed-out" });
  let epoch = 0;
  let credentials: Credentials | undefined;
  const reset = (phase: Phase) => {
    state.phase = phase;
    state.session = undefined;
    state.members = undefined;
    state.message = undefined;
    state.requestId = undefined;
    state.canReload = Boolean(credentials);
  };
  async function callback(url: string) {
    const current = ++epoch;
    operation = undefined;
    pending = false;
    credentials = undefined;
    reset("authenticating");
    try {
      const result = await oidc.callback(url);
      if (current !== epoch) return;
      credentials = result;
      await load();
    } catch {
      if (current === epoch) {
        credentials = undefined;
        oidc.clear();
        reset("error");
        state.message = "登录未完成，请重新登录。";
      }
    }
  }
  async function load() {
    if (!credentials || state.phase === "loading") return;
    const current = epoch;
    const auth = credentials;
    reset("loading");
    try {
      const session = await api.session(auth.accessToken);
      if (current !== epoch) return;
      if (session.user.id !== auth.subject) throw new ApiFailure(401);
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
        if (current === epoch) fail(error, true);
      }
    } catch (error) {
      if (current === epoch) fail(error, false);
    }
  }
  function fail(error: unknown, partial: boolean) {
    const status = error instanceof ApiFailure ? error.status : 0;
    const requestId = error instanceof ApiFailure ? error.requestId : undefined;
    if (status === 401 || status === 403 || status === 404) {
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
  let operation:
    | {
        input: { idTokenHint: string; logoutRequestId: string };
        created: number;
        epoch: number;
      }
    | undefined;
  let pending = false;
  async function signIn(restore = false) {
    if (state.phase === "authenticating") return;
    const current = ++epoch;
    credentials = undefined;
    operation = undefined;
    pending = false;
    oidc.clear();
    reset("authenticating");
    try {
      await oidc.signIn(restore);
    } catch {
      if (current === epoch) {
        reset("error");
        state.message = "无法打开登录页，请重试。";
      }
    }
  }
  async function logout() {
    if (pending) return;
    const idTokenHint = credentials?.idToken;
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
    try {
      await api.logout(op.input);
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
      if (op.epoch === epoch) pending = false;
    }
  }
  function dispose() {
    ++epoch;
    credentials = undefined;
    operation = undefined;
    pending = false;
    oidc.clear(true);
    reset("signed-out");
  }
  return { state, signIn, callback, load, logout, retryLogout, dispose };
}
