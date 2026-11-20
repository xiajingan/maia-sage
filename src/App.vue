<script setup lang="ts">
import { clearNameReturn } from "./features/contacts/name-context";
import { ref, watch, onBeforeUnmount, computed } from "vue";
import type { createSessionController } from "./auth/session";
import type { WecomApi, NameApi } from "./api/mud";
import WecomWorkspace from "./features/wecom/WecomWorkspace.vue";
import ContactWorkspace from "./features/contacts/ContactWorkspace.vue";
import PersonalWorkspace from "./features/governance/PersonalWorkspace.vue";
import TerminalWorkspace from "./features/terminals/TerminalWorkspace.vue";
const props = defineProps<{
  controller?: ReturnType<typeof createSessionController>;
  bootError?: boolean;
  api?: WecomApi & Partial<NameApi>;
  wecomNamesEnabled?: boolean;
}>();
const path = ref(
  typeof globalThis.location === "undefined"
    ? "/"
    : globalThis.location.pathname,
);
const contactsRoute = computed(() =>
  /^\/workspaces\/([1-9]\d*)\/channel-app-instances\/([1-9]\d*)\/contacts$/.exec(
    path.value,
  ),
);
const installRoute = computed(() =>
  /^\/workspaces\/([1-9]\d*)\/wecom(?:\/install-operations\/([1-9]\d*))?$/.exec(
    path.value,
  ),
);
function signIn() {
  clearNameReturn();
  void props.controller?.signIn();
}
function navigate(target: string) {
  path.value = target;
  if (typeof globalThis.history !== "undefined")
    globalThis.history.pushState(null, "", target);
}
function normalizeBusinessUrl() {
  if (
    (contactsRoute.value || installRoute.value) &&
    (globalThis.location.search || globalThis.location.hash)
  )
    globalThis.history.replaceState(null, "", globalThis.location.pathname);
}
function onPopState() {
  path.value = globalThis.location.pathname;
  normalizeBusinessUrl();
}
function focusMain() {
  globalThis.document.getElementById("main")?.focus();
}
if (typeof globalThis.window !== "undefined") {
  globalThis.window.addEventListener("popstate", onPopState);
  globalThis.window.addEventListener("hashchange", onPopState);
  normalizeBusinessUrl();
}
onBeforeUnmount(() => {
  if (typeof globalThis.window !== "undefined")
    globalThis.window.removeEventListener("popstate", onPopState);
  if (typeof globalThis.window !== "undefined")
    globalThis.window.removeEventListener("hashchange", onPopState);
});
function wecomPath() {
  return `/workspaces/${props.controller?.state.session?.rootWorkspace.id}/wecom`;
}
function operationPath(id: string) {
  const target = `${wecomPath()}/install-operations/${id}`;
  path.value = target;
  if (typeof globalThis.history !== "undefined")
    globalThis.history.replaceState(null, "", target);
}
function contactsPath(instanceId: string) {
  navigate(
    `/workspaces/${props.controller?.state.session?.rootWorkspace.id}/channel-app-instances/${instanceId}/contacts`,
  );
}
watch(
  () => props.controller?.state.session,
  (value, previous) => {
    if (previous && value !== previous) navigate("/");
  },
  { flush: "sync" },
);
</script>
<template>
  <a
    href="#main"
    class="skip"
    @click.prevent="focusMain"
  >跳到主要内容</a>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        <span
          class="brand-mark"
          aria-hidden="true"
        >M</span><span>Maia</span>
      </div>
      <button
        v-if="controller?.state.canLogout"
        @click="
          clearNameReturn();
          controller.logout();
        "
      >
        退出登录
      </button><span
        v-else
        class="muted"
      >个人办公空间</span>
    </div>
  </header>
  <main
    id="main"
    tabindex="-1"
  >
    <section
      v-if="bootError"
      class="panel landing"
      role="alert"
    >
      <h1>暂时无法打开 Maia</h1>
      <p>运行配置缺失或无效，请联系管理员核对后重新打开。</p>
    </section>
    <template v-else-if="controller">
      <nav
        v-if="controller.state.session"
        class="workspace-nav"
        aria-label="工作空间"
      >
        <button
          :aria-current="path === '/' ? 'page' : undefined"
          @click="navigate('/')"
        >
          个人工作空间
        </button>
        <button
          :aria-current="path === '/terminals' ? 'page' : undefined"
          @click="navigate('/terminals')"
        >
          终端
        </button>
        <button
          v-if="api"
          :aria-current="installRoute || contactsRoute ? 'page' : undefined"
          @click="navigate(wecomPath())"
        >
          企业微信接入
        </button>
      </nav>
      <ContactWorkspace
        v-if="contactsRoute && api && controller.state.session"
        :key="path"
        :wecom-names-enabled="wecomNamesEnabled"
        :api="api"
        :session="controller"
        :workspace-id="contactsRoute[1]!"
        :instance-id="contactsRoute[2]!"
        @back="navigate(wecomPath())"
      />
      <WecomWorkspace
        v-else-if="installRoute && api && controller.state.session"
        :key="installRoute[1]"
        :api="api"
        :session="controller"
        :workspace-id="installRoute[1]!"
        :operation-id="installRoute[2]"
        @operation="operationPath"
        @contacts="contactsPath"
      />
      <TerminalWorkspace
        v-else-if="path === '/terminals' && controller.state.session"
        :controller="controller"
      />
      <PersonalWorkspace
        v-else-if="
          controller.state.session || controller.state.phase === 'loading'
        "
        :state="controller.state"
        @reload="controller.load()"
      />
      <section
        v-else
        class="panel landing"
        :aria-busy="
          ['authenticating', 'logout-pending'].includes(controller.state.phase)
        "
      >
        <template v-if="controller.state.phase === 'authenticating'">
          <h1>正在连接你的工作空间</h1>
          <p role="status">
            正在安全验证登录身份…
          </p>
        </template>
        <template v-else-if="controller.state.phase === 'logout-pending'">
          <h1>本机已退出</h1>
          <p role="status">
            正在核实原会话已撤销…
          </p>
          <div>
            <button @click="signIn">
              重新登录
            </button>
          </div>
        </template>
        <template v-else-if="controller.state.phase === 'logout-unknown'">
          <h1>本机已退出</h1>
          <p role="status">
            {{ controller.state.message }}
          </p>
          <div class="actions">
            <button
              class="primary"
              @click="controller.retryLogout()"
            >
              重试核实退出
            </button><button @click="signIn">
              重新登录
            </button>
          </div>
        </template>
        <template v-else-if="controller.state.phase === 'forbidden'">
          <h1>无法访问此工作空间</h1>
          <p role="alert">
            {{ controller.state.message }}
          </p>
          <div>
            <button
              class="primary"
              @click="signIn"
            >
              使用其他账号登录
            </button>
          </div>
        </template>
        <template v-else-if="controller.state.phase === 'error'">
          <h1>暂时无法进入工作空间</h1>
          <p role="alert">
            {{ controller.state.message }}
          </p>
          <p
            v-if="controller.state.requestId"
            class="muted"
          >
            关联编号：{{ controller.state.requestId }}
          </p>
          <div class="actions">
            <button
              v-if="controller.state.canReload"
              class="primary"
              @click="controller.load()"
            >
              重试读取
            </button><button @click="signIn">
              重新登录
            </button>
          </div>
        </template>
        <template v-else>
          <h1>你的个人工作空间</h1>
          <p>登录后直接进入自己的空间，你是这里的唯一管理者。</p>
          <p
            v-if="controller.state.message"
            role="status"
          >
            {{ controller.state.message }}
          </p>
          <div>
            <button
              class="primary"
              @click="signIn"
            >
              登录或注册
            </button>
          </div>
          <p class="muted">
            账号与密码将在 Maia 认证页面填写。
          </p>
        </template>
      </section>
      <p
        v-if="
          controller.state.requestId &&
            ['forbidden', 'signed-out'].includes(controller.state.phase)
        "
        class="footnote"
      >
        关联编号：{{ controller.state.requestId }}
      </p>
    </template>
  </main>
</template>
