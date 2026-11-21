<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import type { WecomApi } from "../../api/mud";
import type { createSessionController } from "../../auth/session";
import { createWecomPage } from "./wecom-page";
const props = defineProps<{
  api: WecomApi;
  session: ReturnType<typeof createSessionController>;
  workspaceId: string;
  operationId?: string;
}>();
const emit = defineEmits<{
  operation: [id: string];
  contacts: [instanceId: string];
}>();
const page = createWecomPage({ api: props.api, session: props.session });
const { state } = page;
const manager = computed(
  () => props.session.state.session?.membership.role === "manager",
);
const inWorkspace = computed(
  () => props.session.state.session?.rootWorkspace.id === props.workspaceId,
);
const canStartInstallation = computed(page.canStartInstallation);
const showInstallationPanel = computed(
  () =>
    canStartInstallation.value ||
    state.busy ||
    Boolean(state.operationId || state.unknownStart || state.message),
);
const phases = {
  awaiting_authorization: "等待企微授权",
  awaiting_verification: "接入待核对",
  completed: "可信绑定已完成",
  expired: "接入操作已过期",
  restricted: "接入受限",
  failed: "接入未完成",
};
const syncLabels = {
  pending: "等待同步",
  running: "同步中",
  completed: "同步已完成",
  partial: "部分完成",
  failed: "同步失败",
  interrupted: "同步已中断",
  unavailable: "同步暂不可用",
};
const statusLabels = {
  active: "当前可用",
  restricted: "当前受限",
  pending_verification: "等待范围核对",
  disabled: "已停用",
};
const reason = computed(() => {
  switch (state.operation?.safeReason) {
    case "administrator_identity_required":
      return "应用授权已收到，还需在本次操作中核验企业管理员身份。";
    case "scope_reverification_required":
      return "原实例已恢复绑定，授权范围仍需重新核对。";
    case "exchange_result_unknown":
      return "外部授权结果尚未核实，请查询原操作。";
    case "recovery_source_expired":
    case "recovery_source_unavailable":
      return "已保存结果已不可核验，请重新取得可信授权。";
    default:
      if (
        state.source?.safeReason === "recovery_source_expired" ||
        state.source?.safeReason === "recovery_source_unavailable"
      )
        return "已保存结果已不可核验，请重新取得可信授权。";
      return state.operation?.safeReason
        ? "本次接入尚有条件需要核对，请按当前允许的下一步继续。"
        : undefined;
  }
});
const identityRound = computed(
  () =>
    state.operation?.launch?.kind === "member" &&
    (state.kind === "recovery" ||
      state.operation.safeReason === "administrator_identity_required"),
);
const launchUrl = computed(() =>
  identityRound.value || canStartInstallation.value
    ? page.authorizationUrl()
    : undefined,
);
const memberLaunch = computed(() => launchUrl.value && identityRound.value);
const canRecover = computed(
  () =>
    !state.mustQuery &&
    !state.unknownRecovery &&
    (state.operation?.nextAction === "recover" ||
      state.source?.nextAction === "recover"),
);
watch(
  () => state.operation?.operationId,
  (id) => {
    if (id) emit("operation", id);
  },
);
async function resumeRoute(id?: string) {
  if (!inWorkspace.value) return;
  await page.resume(id);
  if (!state.instances && !state.listError) await page.refreshInstances();
}
watch(
  () => props.operationId,
  (id, previous) => {
    if ((id && id !== state.operation?.operationId) || (!id && previous))
      void resumeRoute(id);
  },
);
onMounted(() => resumeRoute(props.operationId));
onBeforeUnmount(page.dispose);
</script>
<template>
  <section class="intro">
    <h1>企业微信接入</h1>
    <div class="context">
      <span class="pill">{{ session.state.session?.rootWorkspace.name }}</span>
    </div>
  </section>
  <section
    v-if="!inWorkspace || state.forbidden"
    class="panel notice warning"
    role="alert"
  >
    <h2>无法访问此接入</h2>
    <p>{{ state.message ?? "请回到当前个人工作空间核对入口。" }}</p>
  </section>
  <template v-else>
    <section
      v-if="showInstallationPanel"
      class="panel"
      aria-labelledby="install-title"
      :aria-busy="state.busy"
    >
      <div class="panel-heading">
        <h2 id="install-title">
          {{ state.operation ? "本次接入结果" : "接入当前空间" }}
        </h2>
      </div>
      <div class="notice">
        <p
          v-if="state.busy"
          role="status"
        >
          正在核对本次接入…
        </p>
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
        <template v-if="state.operation">
          <h3>{{ phases[state.operation.phase] }}</h3>
          <p v-if="reason">
            {{ reason }}
          </p>
          <p class="muted">
            操作编号：{{ state.operation.operationId }} · 到期时间
            <time
              :datetime="new Date(state.operation.expiresAt).toISOString()"
            >{{
              new Date(state.operation.expiresAt).toLocaleString("zh-CN")
            }}</time>
          </p>
          <p v-if="state.operation.phase === 'completed'">
            可信安装绑定已完成。联系人覆盖、存档开通与终端接入需分别核对。
          </p>
          <div class="terminal-actions">
            <button
              v-if="memberLaunch"
              class="primary"
              :disabled="state.busy"
              @click="page.copyIdentityLink()"
            >
              复制管理员身份核验链接
            </button>
            <a
              v-if="launchUrl"
              :href="launchUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="action-link"
            >{{
              state.operation.launch?.kind === "admin"
                ? "打开管理员授权入口"
                : state.operation.safeReason ===
                  "administrator_identity_required"
                  ? "核验管理员身份"
                  : "打开成员扫码入口"
            }}</a>
            <button
              :disabled="state.busy"
              @click="page.query()"
            >
              查询原操作
            </button>
            <button
              v-if="
                state.operation.nextAction === 'complete' && !state.mustQuery
              "
              class="primary"
              :disabled="state.busy"
              @click="page.complete()"
            >
              核对并完成接入
            </button>
            <button
              v-if="canRecover"
              class="primary"
              :disabled="state.busy"
              @click="page.recover()"
            >
              {{
                state.kind === "recovery"
                  ? "重新核验管理员身份"
                  : "使用已保存结果重新核验管理员身份"
              }}
            </button>
            <button
              v-if="state.unknownRecovery"
              :disabled="state.busy"
              @click="page.retryRecovery()"
            >
              核对原核验请求
            </button>
            <button
              v-if="page.canPrepareInstallation()"
              :disabled="state.busy"
              @click="page.newOperation()"
            >
              准备重新发起
            </button>
            <button
              v-if="
                state.operation.instanceId &&
                  !state.instances?.items.some(
                    (instance) =>
                      instance.instanceId === state.operation?.instanceId,
                  )
              "
              :disabled="state.busy"
              @click="emit('contacts', state.operation.instanceId)"
            >
              查看内部联系人
            </button>
          </div>
          <p
            v-if="state.unknownRecovery"
            class="muted"
          >
            查询只核对原请求；选择“核对原核验请求”时，未找到结果才重试相同请求，不会重新安装。
          </p>
          <p
            v-if="state.launchExpired && state.kind === 'recovery'"
            class="muted"
          >
            本轮身份核验已过期，请查询原操作后按当前允许的入口重新核验。
          </p>
          <p
            v-if="canRecover"
            class="muted"
          >
            只重新核验管理员身份，不会重新安装。
          </p>
          <template v-if="memberLaunch">
            <p class="muted">
              保留此电脑页面与当前 Maia
              登录；把此链接交给本次企业管理员，在手机企业微信内打开完成身份核验，无需在手机登录
              Maia。完成后回到此电脑查询原操作。
            </p>
            <p
              v-if="state.handoffMessage"
              role="status"
            >
              {{ state.handoffMessage }}
            </p>
            <label v-if="state.handoffFallback">管理员身份核验链接（只读）<input
              :value="launchUrl"
              readonly
              @focus="($event.target as HTMLInputElement).select()"
            ></label>
          </template>
          <p
            v-else-if="launchUrl"
            class="muted"
          >
            在新窗口完成企微授权后，回到此页查询原操作。刷新此页不会再次提交安装邀请。
          </p>
        </template>
        <template v-else-if="state.operationId">
          <p>
            原操作 {{ state.operationId }} 的当前结果尚未读取，请核对原操作。
          </p>
          <div>
            <button
              v-if="state.unknownRecovery"
              :disabled="state.busy"
              @click="page.retryRecovery()"
            >
              核对原核验请求
            </button>
            <button
              :disabled="state.busy"
              @click="page.query()"
            >
              查询原操作
            </button>
          </div>
        </template>
        <template v-else-if="state.unknownStart">
          <p>正在保留原发起请求，不会自动建立另一次接入。</p>
          <div>
            <button
              v-if="!state.retrySourceId || canStartInstallation"
              :disabled="state.busy"
              @click="page.retryStart()"
            >
              核对原发起请求
            </button>
          </div>
        </template>
        <template v-else-if="canStartInstallation && manager">
          <p>
            使用成员扫码，或由企业管理员授权。接入只作用于当前个人工作空间。
          </p>
          <div class="terminal-actions">
            <button
              class="primary"
              :disabled="state.busy"
              @click="page.start('member')"
            >
              成员扫码接入
            </button><button
              :disabled="state.busy"
              @click="page.start('admin')"
            >
              管理员接入
            </button>
          </div>
        </template>
        <p v-else-if="canStartInstallation">
          只有当前空间管理者可以发起接入。
        </p>
      </div>
    </section>
    <section
      class="panel feature-section"
      aria-labelledby="instances-title"
      :aria-busy="state.listBusy"
    >
      <div class="panel-heading terminal-heading">
        <h2 id="instances-title">
          本空间企微实例
        </h2>
        <button
          :disabled="state.listBusy || state.busy"
          @click="page.refreshInstances()"
        >
          刷新实例
        </button>
      </div>
      <div
        v-if="state.listBusy && !state.instances"
        class="notice"
        role="status"
      >
        正在读取企微实例…
      </div>
      <div
        v-if="state.listBusy && !state.instances"
        class="skeleton"
        aria-hidden="true"
      />
      <p
        v-if="state.listError"
        class="notice warning"
        role="alert"
      >
        {{ state.listError
        }}{{ state.instances ? " 当前保留上次读取的实例状态。" : "" }}
      </p>
      <div
        v-if="state.instances?.items.length"
        class="terminal-list"
      >
        <article
          v-for="instance in state.instances.items"
          :key="instance.instanceId"
          class="terminal-card"
          :data-instance-id="instance.instanceId"
        >
          <div class="terminal-title">
            <h3>企微实例 {{ instance.instanceId }}</h3>
            <span class="pill">{{ statusLabels[instance.status] }}</span>
          </div>
          <dl class="terminal-facts">
            <div>
              <dt>安装</dt>
              <dd>可信绑定已完成</dd>
            </div>
            <div v-if="instance.currentUserWecomBound !== undefined">
              <dt>我的企微身份</dt>
              <dd>
                {{ instance.currentUserWecomBound ? "已绑定" : "未确认绑定" }}
              </dd>
            </div>
            <div>
              <dt>联系人同步</dt>
              <dd>{{ syncLabels[instance.sync] }}</dd>
            </div>
            <div>
              <dt>会话存档</dt>
              <dd>尚未开通</dd>
            </div>
            <div>
              <dt>终端条件</dt>
              <dd>尚未配置</dd>
            </div>
            <div>
              <dt>授权范围</dt>
              <dd>
                {{
                  instance.scope.completeness === "verified"
                    ? "当前范围已核实"
                    : "范围待核对"
                }}
              </dd>
            </div>
            <div>
              <dt>最近可信时间</dt>
              <dd>
                {{
                  instance.scope.lastTrustedAt
                    ? new Date(instance.scope.lastTrustedAt).toLocaleString(
                      "zh-CN",
                    )
                    : "尚未建立可信记录"
                }}
              </dd>
            </div>
          </dl>
          <p class="muted">
            此实例不代表已有可执行账号或 Tea 就绪。
          </p>
          <div class="actions">
            <button @click="emit('contacts', instance.instanceId)">
              查看内部联系人
            </button>
          </div>
        </article>
      </div>
      <p
        v-else-if="state.instances && !state.listError"
        class="notice"
      >
        {{
          state.instanceCursor
            ? "当前页没有更多企微实例。"
            : "当前空间暂无企微实例。"
        }}
      </p>
      <div
        v-if="state.instances?.nextCursor || state.instanceCursor"
        class="notice terminal-actions"
      >
        <button
          v-if="state.instances?.nextCursor"
          :disabled="state.listBusy"
          @click="
            page.refreshInstances(state.instances.nextCursor ?? undefined)
          "
        >
          下一页实例
        </button><button
          :disabled="state.listBusy"
          @click="page.refreshInstances('')"
        >
          返回实例首页
        </button>
      </div>
    </section>
  </template>
</template>
