<script setup lang="ts">
import { ref, watch } from "vue";
import type { createSessionController } from "./auth/session";
import PersonalWorkspace from "./features/governance/PersonalWorkspace.vue";
import TerminalWorkspace from "./features/terminals/TerminalWorkspace.vue";
const props = defineProps<{
  controller?: ReturnType<typeof createSessionController>;
  bootError?: boolean;
}>();
const terminals = ref(false);
watch(
  () => props.controller?.state.session,
  () => {
    terminals.value = false;
  },
  { flush: "sync" },
);
</script>
<template>
  <a
    href="#main"
    class="skip"
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
        @click="controller.logout()"
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
          :aria-current="terminals ? undefined : 'page'"
          @click="terminals = false"
        >
          个人工作空间
        </button>
        <button
          :aria-current="terminals ? 'page' : undefined"
          @click="terminals = true"
        >
          终端
        </button>
      </nav>
      <TerminalWorkspace
        v-if="terminals && controller.state.session"
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
            <button @click="controller.signIn()">
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
            </button><button @click="controller.signIn()">
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
              @click="controller.signIn()"
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
            </button><button @click="controller.signIn()">
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
              @click="controller.signIn()"
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
