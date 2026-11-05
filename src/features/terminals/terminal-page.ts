import { ref, shallowRef } from "vue";
import type {
  IssueTerminalActivationResponse,
  ListTerminalsResponse,
} from "maia-mud-client";
import { ApiFailure, type createSessionController } from "../../auth/session";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 60;
const MAX_ACTIVATION_LIFETIME_MS = 600_000;
const ACTIVATION_PROPAGATION_MS = 30_000;

export function createTerminalPage(
  api: Pick<
    ReturnType<typeof createSessionController>,
    "issueTerminalActivation" | "listTerminals"
  >,
) {
  const lifetime = new AbortController();
  const result = shallowRef<ListTerminalsResponse>();
  const loading = ref(false);
  const listError = shallowRef<{ requestId?: string }>();
  const cursor = ref<string>();
  const pollingPaused = ref(false);
  let poll: ReturnType<typeof setTimeout> | undefined;
  let remaining = MAX_POLLS;
  let activationDeadline = 0;
  let activationReads = 0;

  function schedule() {
    if (lifetime.signal.aborted) return;
    const windowLeft = activationDeadline - Date.now();
    if (windowLeft > 0 && activationReads > 0) {
      activationReads--;
      poll = setTimeout(
        () => void read(),
        Math.min(POLL_INTERVAL_MS, windowLeft),
      );
    } else if (remaining > 0) {
      remaining--;
      poll = setTimeout(() => void read(), POLL_INTERVAL_MS);
    } else {
      pollingPaused.value = true;
    }
  }

  async function read() {
    if (loading.value || lifetime.signal.aborted) return;
    loading.value = true;
    pollingPaused.value = false;
    try {
      const page = await api.listTerminals(cursor.value, lifetime.signal);
      if (!page || lifetime.signal.aborted) return;
      result.value = page;
      listError.value = undefined;
    } catch (error) {
      if (lifetime.signal.aborted) return;
      listError.value = {
        requestId: error instanceof ApiFailure ? error.requestId : undefined,
      };
    } finally {
      loading.value = false;
      schedule();
    }
  }

  async function refresh(target: string | null = cursor.value ?? null) {
    if (loading.value) return;
    clearTimeout(poll);
    const next = target ?? undefined;
    if (next !== cursor.value) {
      result.value = undefined;
      listError.value = undefined;
      cursor.value = next;
    }
    remaining = MAX_POLLS;
    await read();
  }

  const activation = shallowRef<IssueTerminalActivationResponse>();
  const activationError = shallowRef<{ requestId?: string }>();
  const activationExpired = ref(false);
  const issuing = ref(false);
  let issuance: AbortController | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function clearActivation() {
    clearTimeout(expiry);
    activation.value = undefined;
  }

  function closeActivation() {
    issuance?.abort();
    issuance = undefined;
    issuing.value = false;
    clearActivation();
    activationExpired.value = false;
    activationError.value = undefined;
  }

  async function issue() {
    if (issuing.value || lifetime.signal.aborted) return;
    closeActivation();
    const request = new AbortController();
    issuance = request;
    issuing.value = true;
    try {
      const issued = await api.issueTerminalActivation(request.signal);
      if (!issued || request.signal.aborted) return;
      const milliseconds = Date.parse(issued.expiresAt) - Date.now();
      if (!Number.isFinite(milliseconds)) throw new ApiFailure(0);
      if (milliseconds <= 0) {
        activationExpired.value = true;
        return;
      }
      activation.value = issued;
      const duration =
        Math.min(milliseconds, MAX_ACTIVATION_LIFETIME_MS) +
        ACTIVATION_PROPAGATION_MS;
      activationDeadline = Math.max(activationDeadline, Date.now() + duration);
      activationReads = Math.ceil(
        (activationDeadline - Date.now()) / POLL_INTERVAL_MS,
      );
      remaining = 0;
      clearTimeout(poll);
      void read();
      expiry = setTimeout(() => {
        clearActivation();
        activationExpired.value = true;
      }, milliseconds);
    } catch (error) {
      if (!request.signal.aborted)
        activationError.value = {
          requestId: error instanceof ApiFailure ? error.requestId : undefined,
        };
    } finally {
      if (issuance === request) issuing.value = false;
    }
  }

  function dispose() {
    lifetime.abort();
    clearTimeout(poll);
    closeActivation();
    result.value = undefined;
    listError.value = undefined;
  }

  return {
    result,
    loading,
    listError,
    pollingPaused,
    cursor,
    refresh,
    activation,
    activationError,
    activationExpired,
    issuing,
    issue,
    closeActivation,
    dispose,
  };
}
