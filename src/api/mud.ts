import {
  createClient,
  getSession,
  listMembers,
  logout,
  type GetSessionResponse,
  type ListMembersResponse,
} from "maia-mud-client";
import {
  SessionViewSchema,
  MembersViewSchema,
  LogoutViewSchema,
  ErrorViewSchema,
} from "maia-mud-client/schemas";
import { Check } from "typebox/value";
import type { TSchema } from "typebox";
import { ApiFailure, LOGOUT_TIMEOUT_MS, type Api } from "../auth/session";
export function createMudApi(baseUrl: string): Api {
  const client = createClient({ baseUrl });
  function read<T>(
    result: { data?: unknown; error?: unknown; response?: Response },
    schema: TSchema,
  ): T {
    if (!result.response?.ok) {
      const error = result.error;
      throw new ApiFailure(
        result.response?.status ?? 0,
        Check(ErrorViewSchema, error) ? error.requestId : undefined,
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
