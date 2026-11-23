<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  watch,
  ref,
  nextTick,
} from "vue";
import type { WecomApi, NameApi } from "../../api/mud";
import type { createSessionController } from "../../auth/session";
import { createContactPage } from "./contact-page";
import WecomName from "./WecomName.vue";
import ContactAvatar from "./ContactAvatar.vue";
import {
  createNameContextController,
  readNameReturn,
  clearNameReturn,
} from "./name-context";
import { bindNames, type NameRenderStatus } from "./wecom-sdk";
const props = defineProps<{
  api: WecomApi & Partial<NameApi>;
  wecomNamesEnabled?: boolean;
  session: ReturnType<typeof createSessionController>;
  workspaceId: string;
  instanceId: string;
}>();
const emit = defineEmits<{ back: [] }>();
const {
  state,
  select,
  refresh,
  refreshAfterScopeChange,
  canRequestSync,
  requestSync,
  retrySync,
  querySync,
  dispose,
} = createContactPage({ api: props.api, session: props.session });
const names =
  props.wecomNamesEnabled &&
  props.api.createNameContext &&
  props.api.getNameContext &&
  props.api.completeNameContext &&
  props.api.getNameComponentConfig
    ? createNameContextController({
        api: props.api as WecomApi & NameApi,
        session: props.session,
        onScopeChange: refreshAfterScopeChange,
      })
    : undefined;
const useBoundNames = computed(() =>
  Boolean(
    state.page?.currentUserWecomBound &&
    props.api.getBoundNameComponentConfig &&
    !/MicroMessenger/i.test(globalThis.navigator.userAgent),
  ),
);
const namesMounted = ref(false),
  nameStatus = ref<NameRenderStatus>();
const nameStage = computed(() => nameStatus.value?.stage);
const memberFailureMessages = {
  load: "企微姓名组件的脚本未能加载或初始化。",
  config: "企微姓名组件未能完成企业配置核验。",
  agentConfig: "企微姓名组件未能完成应用配置核验。",
  checkSession: "企微姓名组件的会话未通过核验。",
  bind: "企微姓名组件未能绑定到当前联系人列表。",
} satisfies Record<NonNullable<NameRenderStatus["failedAt"]>, string>;
const memberNameStatus = computed(() => {
  if (!names || !/MicroMessenger/i.test(globalThis.navigator.userAgent))
    return undefined;
  const op = names.state.operation;
  if (op && op.environment !== "member") return undefined;
  const status = nameStatus.value;
  if (status?.failedAt) return memberFailureMessages[status.failedAt];
  if (op?.phase === "completed" && !names.state.config)
    return names.state.busy
      ? "姓名授权已完成，正在核对并读取组件配置…"
      : "姓名授权已完成，页面尚未取得组件配置。";
  if (status?.stage === "reload_required")
    return "请刷新当前页面，再核对企微姓名展示。";
  if (
    names.state.config &&
    (!status ||
      ["load", "config", "agentConfig", "checkSession"].includes(status.stage))
  )
    return "姓名授权已完成，正在准备企微姓名组件…";
  if (!op && !names.state.busy && !names.state.pendingCreate)
    return "此页尚未读取姓名授权结果。若已完成授权，请回到发起授权的页面核对。";
  return undefined;
});
const contactTable = ref<globalThis.HTMLElement>();
const instanceLoaded = ref(false);
let binding: globalThis.AbortController | undefined;
let renewal: ReturnType<typeof globalThis.setTimeout> | undefined;
function stopNames() {
  globalThis.clearTimeout(renewal);
  binding?.abort();
  binding = undefined;
  namesMounted.value = false;
}
watch(
  () => [state.page, state.cursor, state.loading] as const,
  async ([page, cursor, loading]) => {
    stopNames();
    if (page) instanceLoaded.value = true;
    if (!names) return;
    if (loading) {
      names.suspend();
      return;
    }
    if (!page || page.accessState !== "active") {
      names.select();
      return;
    }
    names.select({
      workspaceId: props.workspaceId,
      instanceId: props.instanceId,
      scopeVersion: page.scopeVersion,
      cursor,
    });
    const saved = readNameReturn();
    if (saved && saved.returnPath === globalThis.location.pathname)
      await names.resume(saved);
    else if (names.state.operation) await names.query();
    else if (
      useBoundNames.value &&
      page.items.length &&
      !names.state.pendingCreate
    )
      await names.loadBoundConfig();
  },
  { flush: "sync" },
);
watch(
  () => names?.state.config,
  async (config) => {
    stopNames();
    nameStatus.value = undefined;
    if (!config) return;
    const current = new globalThis.AbortController();
    binding = current;
    await nextTick();
    if (current.signal.aborted) return;
    await bindNames(config, {
      signal: current.signal,
      unmount: () => {
        if (binding === current) namesMounted.value = false;
      },
      mount: async () => {
        if (current.signal.aborted) return [];
        namesMounted.value = true;
        await nextTick();
        if (current.signal.aborted) return [];
        return Array.from(
          contactTable.value?.querySelectorAll("ww-open-data") ?? [],
        );
      },
      onStatus: (status) => {
        if (current.signal.aborted) return;
        if (status.stage === "bound" && "source" in config && names) {
          // Recheck the same page before this grant ends. Its SDK expiry remains armed
          // while the request is in flight and each replacement rechecks the PC session.
          const remaining = config.expiresAt - Date.now();
          const lead = Math.min(10000, remaining / 4);
          renewal = globalThis.setTimeout(
            () => {
              if (!current.signal.aborted) void names.loadBoundConfig(config);
            },
            Math.max(1000, remaining - lead),
          );
        }
        if (
          [
            "browser_session_unavailable",
            "error",
            "expired",
            "invalid",
            "timeout",
            "reload_required",
          ].includes(status.stage)
        ) {
          namesMounted.value = false;
          // A slow renewal may outlive the old signature. A provider failure,
          // however, invalidates any outstanding renewal for that binding.
          if (status.stage !== "expired") {
            globalThis.clearTimeout(renewal);
            if ("source" in config && names?.state.busy) names.suspend();
          }
        }
        nameStatus.value = status;
      },
    });
  },
  { flush: "sync" },
);
function authorizeNames() {
  void names?.start(
    /MicroMessenger/i.test(globalThis.navigator.userAgent) ? "member" : "web",
  );
}
function receiveNameResult(event: globalThis.MessageEvent) {
  void names?.receive(event);
}
function loginForNames() {
  clearNameReturn();
  names?.recreate();
  void props.session.signIn();
}
function reloadNames() {
  names?.saveReturn();
  globalThis.window.location.reload();
}
onMounted(() =>
  globalThis.window.addEventListener("message", receiveNameResult),
);
onBeforeUnmount(() => {
  stopNames();
  names?.dispose();
  globalThis.window.removeEventListener("message", receiveNameResult);
});
const phases = {
  planned: "等待同步",
  running: "同步中",
  completed: "同步已完成",
  partial: "部分完成",
  failed: "同步失败",
  interrupted: "同步已中断",
};
const coverage = {
  pending: "覆盖待核对",
  partial: "覆盖不完整",
  complete: "当前范围覆盖完整",
};
const date = (value: number) =>
  value ? new Date(value).toLocaleString("zh-CN") : "尚未建立可信记录";
function reason(value: string | null) {
  if (!value) return;
  if (value === "scope_reverification_required")
    return "授权范围需要重新核对，暂不展示联系人资料。";
  if (value === "provider_unavailable")
    return "上游资料暂不可用，当前覆盖仍有缺口。";
  return "当前资料或授权条件尚未完全核实，请核对同步进度与访问状态。";
}
onMounted(() => void select(props.workspaceId, props.instanceId));
onBeforeUnmount(dispose);
</script>
<template>
  <header class="intro instance-context">
    <button
      type="button"
      class="instance-back"
      @click="emit('back')"
    >
      返回企微实例
    </button>
    <h1>企微实例</h1>
    <p
      v-if="instanceLoaded && !state.forbidden"
      class="instance-reference muted"
    >
      实例编号 {{ instanceId }}
    </p>
  </header>
  <section
    class="panel"
    aria-labelledby="contacts-title"
    :aria-busy="state.loading"
  >
    <div class="panel-heading terminal-heading">
      <h2 id="contacts-title">
        内部联系人
      </h2>
      <button
        v-if="!state.forbidden"
        :disabled="state.loading"
        @click="refresh()"
      >
        刷新联系人
      </button>
    </div>
    <div
      v-if="state.loading"
      class="notice"
      role="status"
    >
      正在核对联系人与当前权限…
    </div>
    <div
      v-if="state.loading"
      class="skeleton"
      aria-hidden="true"
    />
    <div
      v-if="state.message"
      class="notice warning"
      role="alert"
    >
      <p>{{ state.message }}</p>
      <p
        v-if="state.requestId"
        class="muted"
      >
        关联编号：{{ state.requestId }}
      </p>
    </div>
    <p
      v-if="state.page?.accessState === 'disabled'"
      class="notice"
      role="status"
    >
      此实例已停止访问。
    </p>
    <p
      v-else-if="state.page?.accessState === 'pending_verification'"
      class="notice"
      role="status"
    >
      联系人暂不可查看，当前空列表不代表全量为零。
    </p>
    <p
      v-else-if="state.page && !state.page.items.length"
      class="notice"
    >
      当前页暂无可展示的联系人。
    </p>
    <div
      v-if="
        names &&
          state.page?.accessState === 'active' &&
          state.page.items.length &&
          !namesMounted
      "
      class="notice"
    >
      <p role="status">
        {{
          names.state.message ??
            memberNameStatus ??
            (names.state.busy
              ? "正在核对姓名展示资格…"
              : nameStage === "browser_session_unavailable"
                ? "当前浏览器的企微姓名展示会话未通过核验。"
                : useBoundNames
                  ? "姓名暂不可展示。"
                  : "姓名暂不可展示，可授权当前企业的姓名展示。")
        }}
      </p>
      <p
        v-if="names.state.message && memberNameStatus"
        class="muted"
      >
        {{ memberNameStatus }}
      </p>
      <p
        v-if="
          nameStage &&
            !memberNameStatus &&
            !['bound', 'update', 'browser_session_unavailable'].includes(
              nameStage,
            )
        "
        class="muted"
      >
        {{
          ["reload_required", "timeout"].includes(nameStage)
            ? "请刷新页面后重新核对姓名展示。"
            : ["error", "invalid", "expired"].includes(nameStage)
              ? "姓名展示未完成，请重新核对当前上下文与授权范围。"
              : "正在准备官方姓名组件…"
        }}
      </p>
      <div class="terminal-actions">
        <button
          v-if="
            !names.state.operation &&
              (!useBoundNames ||
                (!names.state.busy &&
                  (!names.state.config ||
                    nameStage === 'browser_session_unavailable')))
          "
          :disabled="names.state.busy || names.state.blocked"
          @click="authorizeNames"
        >
          {{
            names.state.pendingCreate ? "核对原姓名发起请求" : "授权姓名展示"
          }}
        </button>
        <button
          v-if="names.state.pendingCreate"
          :disabled="names.state.busy"
          @click="names.abandon()"
        >
          放弃本次姓名核验
        </button>
        <button
          v-if="names.state.operation?.nextAction === 'authorize'"
          :disabled="names.state.busy"
          @click="names.openAuthorization()"
        >
          打开姓名授权
        </button>
        <button
          v-if="
            names.state.operation &&
              !names.state.blocked &&
              names.state.operation.nextAction !== 'check_configuration'
          "
          :disabled="names.state.busy"
          @click="
            stopNames();
            names.query();
          "
        >
          核对原姓名授权
        </button>
        <button
          v-if="names.state.requiresLogin"
          @click="loginForNames"
        >
          先登录 Maia
        </button>
        <button
          v-if="
            !names.state.requiresLogin &&
              !names.state.pendingCreate &&
              (names.state.blocked ||
                names.state.operation?.nextAction === 'recreate')
          "
          :disabled="names.state.busy"
          @click="
            stopNames();
            names.recreate();
          "
        >
          重新建立姓名上下文
        </button>
        <button
          v-if="nameStage && ['reload_required', 'timeout'].includes(nameStage)"
          @click="reloadNames"
        >
          刷新页面恢复姓名展示
        </button>
      </div>
    </div>
    <div
      v-if="state.page?.items.length"
      ref="contactTable"
      class="table-scroll"
      role="region"
      aria-label="联系人资料"
    >
      <table class="directory-table">
        <thead>
          <tr>
            <th
              scope="col"
              class="avatar-column"
            >
              头像
            </th>
            <th scope="col">
              姓名
            </th>
            <th scope="col">
              职位
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="contact in state.page.items"
            :key="contact.id"
            :data-contact-id="contact.id"
          >
            <td>
              <ContactAvatar
                :url="
                  contact.avatarAvailability === 'available'
                    ? contact.avatarUrl
                    : null
                "
              />
            </td>
            <td>
              <slot
                name="contact-name"
                :contact-id="contact.id"
                :instance-id="instanceId"
                :scope-version="state.page.scopeVersion"
                :cursor="state.cursor"
              >
                <WecomName
                  :active="namesMounted"
                  :reference="
                    names?.state.config?.references.find(
                      (reference) => reference.contactId === contact.id,
                    )
                  "
                  :corp-id="names?.state.config?.corpId"
                />
              </slot>
            </td>
            <td>
              <template
                v-if="
                  contact.positionAvailability === 'available' &&
                    contact.position
                "
              >
                {{ contact.position }}
              </template>
              <span
                v-else
                class="muted"
                aria-label="暂无职位"
              >—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div
      v-if="state.page && (state.cursor || state.page.nextCursor)"
      class="notice terminal-actions"
    >
      <button
        v-if="state.cursor"
        :disabled="state.loading"
        @click="refresh('')"
      >
        返回联系人首页
      </button><button
        v-if="state.page.nextCursor"
        :disabled="state.loading"
        @click="refresh(state.page.nextCursor ?? undefined)"
      >
        下一页联系人
      </button>
    </div>
  </section>
  <details
    v-if="!state.forbidden"
    class="panel feature-section directory-maintenance"
  >
    <summary>维护与同步</summary>
    <div
      v-if="state.page"
      class="notice"
    >
      <h2>授权与诊断</h2>
      <p
        v-if="
          state.page.currentUserWecomBound &&
            state.page.accessState === 'active'
        "
      >
        当前 Maia 用户已绑定企微身份
      </p>
      <p>
        {{
          state.page.accessState === "active"
            ? "当前授权范围已核实"
            : state.page.accessState === "disabled"
              ? "此实例已停止访问"
              : "当前授权范围待核对"
        }}
      </p>
      <p v-if="state.page.safeReason">
        {{ reason(state.page.safeReason) }}
      </p>
      <p class="muted">
        最近可信时间 {{ date(state.page.lastTrustedAt) }} · 范围版本
        {{ state.page.scopeVersion }}
      </p>
    </div>
    <section
      aria-labelledby="sync-title"
      :aria-busy="state.syncing"
    >
      <div class="panel-heading terminal-heading">
        <h2 id="sync-title">
          联系人同步
        </h2>
        <button
          v-if="canRequestSync() && !state.unknownSync"
          :disabled="
            state.syncing ||
              state.loading ||
              ['planned', 'running'].includes(state.sync?.phase ?? '')
          "
          @click="requestSync()"
        >
          补同步当前范围
        </button>
      </div>
      <div class="notice">
        <p
          v-if="state.syncing"
          role="status"
        >
          正在核对同步结果…
        </p>
        <template v-if="state.sync">
          <h3>{{ phases[state.sync.phase] }}</h3>
          <p>{{ coverage[state.sync.coverage] }}</p>
          <p v-if="state.sync.safeReason">
            {{ reason(state.sync.safeReason) }}
          </p>
          <p class="muted">
            最近可信时间：{{ date(state.sync.lastTrustedAt) }}
          </p>
          <div>
            <button
              :disabled="state.syncing"
              @click="querySync()"
            >
              查询原同步
            </button>
          </div>
        </template>
        <p v-else>
          尚未读取到可信同步记录，不能据此认定全量已完成。
        </p>
        <div
          v-if="state.syncMessage"
          role="alert"
        >
          <p>{{ state.syncMessage }}</p>
          <p
            v-if="state.requestId"
            class="muted"
          >
            关联编号：{{ state.requestId }}
          </p>
        </div>
        <div v-if="state.unknownSync">
          <button
            :disabled="state.syncing"
            @click="retrySync()"
          >
            核对原同步请求
          </button>
        </div>
      </div>
    </section>
  </details>
</template>

<style scoped>
.instance-context {
  display: grid;
  justify-items: start;
  align-content: start;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
}

.instance-context h1 {
  font-family: var(--font-body);
  font-size: var(--text-section);
}

.instance-reference {
  margin-top: var(--space-0);
  overflow-wrap: anywhere;
}

#contacts-title {
  font-family: var(--font-heading);
  font-size: var(--text-title);
}

.instance-back {
  padding: var(--space-1) var(--space-2);
  margin-inline-start: calc(-1 * var(--space-2));
  border-color: transparent;
  background: transparent;
}

.directory-table .avatar-column {
  width: 1%;
  white-space: nowrap;
}

.directory-table th,
.directory-table td {
  vertical-align: middle;
}

.directory-maintenance > summary {
  padding: var(--space-3) var(--space-6);
  color: var(--color-action);
  cursor: pointer;
  font-weight: var(--weight-medium);
}

.directory-maintenance > summary:focus-visible {
  outline-offset: calc(-1 * var(--focus-offset));
}

.directory-maintenance[open] > summary {
  border-bottom: var(--line-thin) solid var(--color-line);
}

@media (max-width: 40rem) {
  .directory-maintenance > summary {
    padding-inline: var(--space-5);
  }
}
</style>
