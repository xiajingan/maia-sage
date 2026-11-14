<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import type { WecomApi } from "../../api/mud";
import type { createSessionController } from "../../auth/session";
import { createContactPage } from "./contact-page";
const props = defineProps<{
  api: WecomApi;
  session: ReturnType<typeof createSessionController>;
  workspaceId: string;
  instanceId: string;
}>();
const { state, select, refresh, requestSync, retrySync, querySync, dispose } =
  createContactPage({ api: props.api, session: props.session });
const availability = {
  available: "可获取",
  not_authorized: "未获准",
  not_returned: "未返回",
  pending_verification: "待核对",
};
const relation = {
  active: "当前可访问",
  departed: "已确认离职",
  inaccessible: "当前不可访问",
  pending_verification: "待核对",
};
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
  <section class="intro">
    <h1>内部联系人</h1>
    <p>仅展示当前空间此企微实例允许访问的资料。联系人不自动成为 Maia 成员。</p>
    <div class="context">
      <span class="pill">企微实例 {{ instanceId }}</span>
    </div>
  </section>
  <section
    class="panel"
    aria-labelledby="contacts-title"
    :aria-busy="state.loading"
  >
    <div class="panel-heading terminal-heading">
      <h2 id="contacts-title">
        当前授权范围
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
    <div
      v-if="state.page"
      class="notice"
    >
      <p
        v-if="state.page.accessState !== 'active'"
        role="status"
      >
        {{
          state.page.accessState === "disabled"
            ? "此实例已停止访问。"
            : "授权范围待核对，当前空列表不代表全量为零。"
        }}
      </p>
      <p
        v-if="state.page.safeReason"
        class="warning"
      >
        {{ reason(state.page.safeReason) }}
      </p>
      <p class="muted">
        最近可信时间：{{ date(state.page.lastTrustedAt) }} · 范围版本：{{
          state.page.scopeVersion
        }}
      </p>
      <p v-if="!state.page.items.length && state.page.accessState === 'active'">
        当前页暂无可展示的联系人。请核对同步覆盖，或刷新当前范围。
      </p>
    </div>
    <div
      v-if="state.page?.items.length"
      class="table-scroll"
      tabindex="0"
      role="region"
      aria-label="联系人资料，可横向滚动"
    >
      <table class="contacts-table">
        <thead>
          <tr>
            <th scope="col">
              姓名展示
            </th>
            <th scope="col">
              成员标识（来源命名空间）
            </th>
            <th scope="col">
              职位
            </th>
            <th scope="col">
              头像资料
            </th>
            <th scope="col">
              访问状态与可信时间
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
              <slot
                name="contact-name"
                :contact-id="contact.id"
                :instance-id="instanceId"
                :scope-version="state.page.scopeVersion"
                :cursor="state.cursor"
              >
                <span class="muted">姓名暂不可展示</span>
              </slot>
            </td>
            <td>
              {{ contact.sourceId }}<br><span class="muted">{{
                contact.sourceNamespace
              }}</span>
            </td>
            <td>
              {{
                contact.positionAvailability === "available"
                  ? (contact.position ?? "未返回")
                  : availability[contact.positionAvailability]
              }}
            </td>
            <td>{{ availability[contact.avatarAvailability] }}</td>
            <td>
              {{ relation[contact.state] }}<br><span class="muted">{{
                date(contact.lastTrustedAt)
              }}</span>
              <p
                v-if="contact.safeReason"
                class="muted"
              >
                {{ reason(contact.safeReason) }}
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div
      v-if="state.page"
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
  <section
    v-if="!state.forbidden"
    class="panel feature-section"
    aria-labelledby="sync-title"
    :aria-busy="state.syncing"
  >
    <div class="panel-heading terminal-heading">
      <h2 id="sync-title">
        联系人同步
      </h2>
      <button
        v-if="
          session.state.session?.membership.role === 'manager' &&
            state.page?.accessState === 'active' &&
            !state.unknownSync
        "
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
      <p class="muted">
        同步、官方姓名展示、存档和终端条件分别核对。
      </p>
    </div>
  </section>
</template>
