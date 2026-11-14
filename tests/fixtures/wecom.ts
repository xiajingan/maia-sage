import { vi } from "vitest";
import type {
  CreateWecomInstallOperationResponse,
  ListContactsResponse,
  RequestContactSyncResponse,
} from "maia-mud-client";
import { createMudApi } from "../../src/api/mud";
import { createSessionController } from "../../src/auth/session";
export const install: CreateWecomInstallOperationResponse = {
  operationId: "10",
  phase: "awaiting_verification",
  expiresAt: 1900000000000,
  safeReason: "exchange_result_unknown",
  nextAction: "query_original",
  instanceId: null,
  rowVersion: "1",
  launch: null,
};
export const sync: RequestContactSyncResponse = {
  syncId: "40",
  instanceId: "20",
  rowVersion: "1",
  phase: "partial",
  coverage: "partial",
  safeReason: "provider_unavailable",
  lastTrustedAt: 1800000000000,
  scopeVersion: "1",
};
export const contacts: ListContactsResponse = {
  accessState: "active",
  safeReason: null,
  lastTrustedAt: 1800000000000,
  sync,
  items: [
    {
      id: "30",
      sourceNamespace: "wecom.open_userid",
      sourceId: "synthetic-member",
      position: null,
      positionAvailability: "not_authorized",
      avatarUrl: null,
      avatarAvailability: "not_returned",
      lastTrustedAt: 1800000000000,
      state: "active",
      safeReason: null,
    },
  ],
  nextCursor: "second",
  scopeVersion: "1",
};
export async function harness(
  handle: (request: Request) => Response | Promise<Response>,
) {
  const requests: Request[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    if (path.endsWith("/session"))
      return Response.json({
        rootWorkspace: { id: "1", name: "合成个人空间" },
        user: { id: "2", loginName: "synthetic" },
        membership: { role: "manager" },
        accessContextVersion: "1",
      });
    if (path.endsWith("/members"))
      return Response.json({ items: [], nextCursor: null });
    requests.push(request.clone());
    return handle(request);
  });
  const api = createMudApi("https://localhost");
  const session = createSessionController({
    api,
    oidc: {
      signIn: async () => {},
      callback: async () => ({
        subject: "2",
        accessToken: "synthetic-access",
        idToken: "synthetic-id",
      }),
      clear: () => {},
    },
  });
  await session.callback("synthetic-callback");
  return { api, session, requests };
}
export function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
