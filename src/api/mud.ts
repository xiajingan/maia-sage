import {
  createClient,
  createNameContext,
  getNameContext,
  completeNameContext,
  getNameComponentConfig,
  type CreateNameContextData,
  type CreateNameContextResponse,
  type GetNameContextData,
  type GetNameContextResponse,
  type CompleteNameContextData,
  type CompleteNameContextResponse,
  type GetNameComponentConfigData,
  type GetNameComponentConfigResponse,
  createWecomInstallOperation,
  getWecomInstallOperation,
  completeWecomInstallOperation,
  listChannelAppInstances,
  listContacts,
  requestContactSync,
  getContactSync,
  type CreateWecomInstallOperationData,
  type CreateWecomInstallOperationResponse,
  type GetWecomInstallOperationResponse,
  type CompleteWecomInstallOperationData,
  type CompleteWecomInstallOperationResponse,
  type ListChannelAppInstancesResponse,
  type ListContactsResponse,
  type RequestContactSyncData,
  type RequestContactSyncResponse,
  type GetContactSyncResponse,
  getSession,
  listMembers,
  issueTerminalActivation,
  listTerminals,
  type IssueTerminalActivationResponse,
  type ListTerminalsResponse,
  logout,
  type GetSessionResponse,
  type ListMembersResponse,
} from "maia-mud-client";
import {
  NameContextViewSchema,
  NameComponentConfigSchema,
  InstallViewSchema,
  ChannelInstancesViewSchema,
  ContactPageSchema,
  SyncViewSchema,
  SessionViewSchema,
  MembersViewSchema,
  LogoutViewSchema,
  ErrorViewSchema,
  ActivationViewSchema,
  TerminalErrorViewSchema,
  TerminalPageSchema,
} from "maia-mud-client/schemas";
import { Check } from "typebox/value";
import type { TSchema } from "typebox";
import { ApiFailure, LOGOUT_TIMEOUT_MS, type Api } from "../auth/session";
const REQUEST_TIMEOUT_MS = 10_000;

function requestSignal(signal: AbortSignal) {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

export interface WecomApi {
  createWecomInstallOperation(
    token: string,
    workspaceId: string,
    input: CreateWecomInstallOperationData["body"],
    signal: AbortSignal,
  ): Promise<CreateWecomInstallOperationResponse>;
  getWecomInstallOperation(
    token: string,
    id: string,
    signal: AbortSignal,
  ): Promise<GetWecomInstallOperationResponse>;
  completeWecomInstallOperation(
    token: string,
    id: string,
    input: CompleteWecomInstallOperationData["body"],
    signal: AbortSignal,
  ): Promise<CompleteWecomInstallOperationResponse>;
  listChannelAppInstances(
    token: string,
    workspaceId: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<ListChannelAppInstancesResponse>;
  listContacts(
    token: string,
    id: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<ListContactsResponse>;
  requestContactSync(
    token: string,
    id: string,
    input: RequestContactSyncData["body"],
    signal: AbortSignal,
  ): Promise<RequestContactSyncResponse>;
  getContactSync(
    token: string,
    id: string,
    syncId: string,
    signal: AbortSignal,
  ): Promise<GetContactSyncResponse>;
}
export interface NameApi {
  createNameContext(
    token: string,
    input: Pick<CreateNameContextData, "path" | "body">,
    signal: AbortSignal,
  ): Promise<CreateNameContextResponse>;
  getNameContext(
    token: string,
    input: Pick<GetNameContextData, "path">,
    signal: AbortSignal,
  ): Promise<GetNameContextResponse>;
  completeNameContext(
    token: string,
    input: Pick<CompleteNameContextData, "path" | "body">,
    signal: AbortSignal,
  ): Promise<CompleteNameContextResponse>;
  getNameComponentConfig(
    token: string,
    input: Pick<GetNameComponentConfigData, "path" | "body">,
    signal: AbortSignal,
  ): Promise<GetNameComponentConfigResponse>;
}
export function createMudApi(baseUrl: string): Api & WecomApi & NameApi {
  const client = createClient({ baseUrl });
  function read<T>(
    result: { data?: unknown; error?: unknown; response?: Response },
    schema: TSchema,
    errorSchema = ErrorViewSchema as
      typeof ErrorViewSchema | typeof TerminalErrorViewSchema,
  ): T {
    if (!result.response?.ok) {
      const error = result.error;
      throw new ApiFailure(
        result.response?.status ?? 0,
        Check(errorSchema, error) ? error.requestId : undefined,
        Check(ErrorViewSchema, error) ? error.recovery : undefined,
      );
    }
    if (!Check(schema, result.data)) throw new ApiFailure(0);
    return result.data as T;
  }
  return {
    async createNameContext(token, input, signal) {
      return read<CreateNameContextResponse>(
        await createNameContext({
          client,
          auth: token,
          ...input,
          cache: "no-store",
          credentials: "same-origin",
          signal: requestSignal(signal),
        }),
        NameContextViewSchema,
      );
    },
    async getNameContext(token, input, signal) {
      return read<GetNameContextResponse>(
        await getNameContext({
          client,
          auth: token,
          ...input,
          cache: "no-store",
          credentials: "same-origin",
          signal: requestSignal(signal),
        }),
        NameContextViewSchema,
      );
    },
    async completeNameContext(token, input, signal) {
      return read<CompleteNameContextResponse>(
        await completeNameContext({
          client,
          auth: token,
          ...input,
          cache: "no-store",
          credentials: "same-origin",
          signal: requestSignal(signal),
        }),
        NameContextViewSchema,
      );
    },
    async getNameComponentConfig(token, input, signal) {
      return read<GetNameComponentConfigResponse>(
        await getNameComponentConfig({
          client,
          auth: token,
          ...input,
          cache: "no-store",
          credentials: "same-origin",
          signal: requestSignal(signal),
        }),
        NameComponentConfigSchema,
      );
    },
    async createWecomInstallOperation(token, workspaceId, body, signal) {
      return read<CreateWecomInstallOperationResponse>(
        await createWecomInstallOperation({
          client,
          auth: token,
          path: { workspaceId },
          body,
          cache: "no-store",
          credentials: "same-origin",
          signal: requestSignal(signal),
        }),
        InstallViewSchema,
      );
    },
    async getWecomInstallOperation(token, id, signal) {
      return read<GetWecomInstallOperationResponse>(
        await getWecomInstallOperation({
          client,
          auth: token,
          path: { id },
          cache: "no-store",
          credentials: "same-origin",
          signal: requestSignal(signal),
        }),
        InstallViewSchema,
      );
    },
    async completeWecomInstallOperation(token, id, body, signal) {
      return read<CompleteWecomInstallOperationResponse>(
        await completeWecomInstallOperation({
          client,
          auth: token,
          path: { id },
          body,
          cache: "no-store",
          credentials: "same-origin",
          signal: requestSignal(signal),
        }),
        InstallViewSchema,
      );
    },
    async listChannelAppInstances(token, workspaceId, cursor, signal) {
      return read<ListChannelAppInstancesResponse>(
        await listChannelAppInstances({
          client,
          auth: token,
          path: { workspaceId },
          query: { cursor },
          cache: "no-store",
          signal: requestSignal(signal),
        }),
        ChannelInstancesViewSchema,
      );
    },
    async listContacts(token, id, cursor, signal) {
      return read<ListContactsResponse>(
        await listContacts({
          client,
          auth: token,
          path: { id },
          query: { cursor, limit: 20 },
          cache: "no-store",
          signal: requestSignal(signal),
        }),
        ContactPageSchema,
      );
    },
    async requestContactSync(token, id, body, signal) {
      return read<RequestContactSyncResponse>(
        await requestContactSync({
          client,
          auth: token,
          path: { id },
          body,
          cache: "no-store",
          signal: requestSignal(signal),
        }),
        SyncViewSchema,
      );
    },
    async getContactSync(token, id, syncId, signal) {
      return read<GetContactSyncResponse>(
        await getContactSync({
          client,
          auth: token,
          path: { id, syncId },
          cache: "no-store",
          signal: requestSignal(signal),
        }),
        SyncViewSchema,
      );
    },
    async session(token) {
      return read<GetSessionResponse>(
        await getSession({
          client,
          auth: token,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
        SessionViewSchema,
      );
    },
    async members(token, workspaceId) {
      return read<ListMembersResponse>(
        await listMembers({
          client,
          auth: token,
          path: { workspaceId },
          query: { limit: 20 },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
        MembersViewSchema,
      );
    },
    async issueTerminalActivation(token, signal) {
      return read<IssueTerminalActivationResponse>(
        await issueTerminalActivation({
          client,
          auth: token,
          body: {},
          cache: "no-store",
          signal: requestSignal(signal),
        }),
        ActivationViewSchema,
        TerminalErrorViewSchema,
      );
    },
    async listTerminals(token, cursor, signal) {
      return read<ListTerminalsResponse>(
        await listTerminals({
          client,
          auth: token,
          query: { limit: 20, cursor },
          cache: "no-store",
          signal: requestSignal(signal),
        }),
        TerminalPageSchema,
        TerminalErrorViewSchema,
      );
    },
    async logout(input, signal) {
      read(
        await logout({
          client,
          credentials: "same-origin",
          body: input,
          signal: signal ?? AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
        }),
        LogoutViewSchema,
      );
    },
  };
}
