import {
  createClient,
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
const TERMINAL_TIMEOUT_MS = 10_000;

function terminalSignal(signal: AbortSignal) {
  return AbortSignal.any([signal, AbortSignal.timeout(TERMINAL_TIMEOUT_MS)]);
}

export function createMudApi(baseUrl: string): Api {
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
      );
    }
    if (!Check(schema, result.data)) throw new ApiFailure(0);
    return result.data as T;
  }
  return {
    async session(token) {
      return read<GetSessionResponse>(
        await getSession({ client, auth: token }),
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
          signal: terminalSignal(signal),
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
          signal: terminalSignal(signal),
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
