<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import type { createSessionController } from "../../auth/session";
import { createTerminalPage } from "./terminal-page";

const props = defineProps<{
  controller: ReturnType<typeof createSessionController>;
}>();
const {
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
} = createTerminalPage(props.controller);
const dialog = useTemplateRef("dialog");
const connection = { online: "在线", offline: "离线", unknown: "待确认" };
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function addTerminal() {
  dialog.value?.showModal();
  void issue();
}

function closeDialog() {
  closeActivation();
  dialog.value?.close();
}

onMounted(() => void refresh());
onBeforeUnmount(dispose);
</script>

<template>
  <section class="intro">
    <h1>终端</h1>
    <p>接入装有 Celt 的 Windows 电脑，查看连接、版本和本机能力。</p>
  </section>
  <section
    class="panel"
    aria-labelledby="terminals-title"
  >
    <div class="panel-heading terminal-heading">
      <h2 id="terminals-title">
        已接入终端
      </h2>
      <button
        class="primary"
        @click="addTerminal"
      >
        添加终端
      </button>
    </div>
    <div
      v-if="loading && !result && !listError"
      class="notice"
      role="status"
    >
      正在读取终端…
    </div>
    <div
      v-if="loading && !result && !listError"
      class="skeleton"
      aria-hidden="true"
    />
    <div
      v-if="listError"
      class="notice warning"
      role="alert"
    >
      <p>
        {{
          result
            ? "暂时无法刷新终端，以下显示上次读取的状态。"
            : "暂时无法读取终端，请重试。"
        }}
      </p>
      <p
        v-if="listError.requestId"
        class="muted"
      >
        关联编号：{{ listError.requestId }}
      </p>
    </div>
    <div
      v-if="result?.items.length"
      class="terminal-list"
    >
      <article
        v-for="terminal in result.items"
        :key="terminal.terminalId"
        class="terminal-card"
        :data-terminal-id="terminal.terminalId"
      >
        <div class="terminal-title">
          <h3>{{ terminal.hostname }}</h3>
          <span class="pill">已激活</span>
        </div>
        <dl class="terminal-facts">
          <div>
            <dt>连接状态</dt>
            <dd>{{ connection[terminal.connection] }}</dd>
          </div>
          <div>
            <dt>最后在线</dt>
            <dd>
              <time
                v-if="terminal.lastSeenAt"
                :datetime="terminal.lastSeenAt"
              >{{ dateFormat.format(new Date(terminal.lastSeenAt)) }}</time>
              <template v-else>
                待确认
              </template>
            </dd>
          </div>
          <div>
            <dt>Celt 版本</dt>
            <dd>{{ terminal.celtVersion ?? "待确认" }}</dd>
          </div>
          <div>
            <dt>Windows 版本</dt>
            <dd>{{ terminal.windowsVersion ?? "待确认" }}</dd>
          </div>
          <div>
            <dt>本机能力</dt>
            <dd v-if="terminal.capabilities.length">
              <ul class="terminal-capabilities">
                <li
                  v-for="capability in terminal.capabilities"
                  :key="capability"
                >
                  {{
                    capability === "wecom.send_message"
                      ? "发送文本消息"
                      : capability
                  }}
                </li>
              </ul>
            </dd>
            <dd v-else>
              {{
                terminal.connection === "unknown" ? "待确认" : "暂无已上报能力"
              }}
            </dd>
          </div>
        </dl>
        <p
          v-if="terminal.connection !== 'unknown' && !terminal.eligible"
          class="notice warning terminal-eligibility"
        >
          当前不能执行任务。<template v-if="terminal.minimumCeltVersion">
            最低 Celt 版本为 {{ terminal.minimumCeltVersion }}。
          </template>
        </p>
      </article>
    </div>
    <div
      v-else-if="result && !listError"
      class="notice"
    >
      <p>暂无终端。选择“添加终端”开始接入。</p>
    </div>
    <p
      v-if="pollingPaused && result && !listError"
      class="notice muted"
      role="status"
    >
      自动刷新已暂停，当前显示上次读取的状态。可手动刷新终端。
    </p>
    <div class="notice terminal-actions">
      <button
        :disabled="loading"
        @click="refresh()"
      >
        刷新终端
      </button>
      <button
        v-if="cursor"
        :disabled="loading"
        @click="refresh(null)"
      >
        返回首页
      </button>
      <button
        v-if="result?.nextCursor"
        :disabled="loading"
        @click="refresh(result.nextCursor)"
      >
        下一页
      </button>
    </div>
    <p
      v-if="result?.nextCursor"
      class="notice muted"
    >
      新接入的终端显示在列表末尾，可翻页查看。
    </p>
  </section>

  <dialog
    ref="dialog"
    class="panel terminal-dialog"
    aria-labelledby="terminal-dialog-title"
    @cancel.prevent="closeDialog"
  >
    <div class="notice">
      <h2 id="terminal-dialog-title">
        添加终端
      </h2>
      <p>在要接入的电脑上打开 Celt，并输入这个一次性激活码。</p>
      <p
        v-if="issuing"
        role="status"
      >
        正在生成激活码…
      </p>
      <template v-if="activation">
        <output
          class="activation-code"
          aria-label="一次性激活码"
        >{{
          activation.code
        }}</output>
        <p>
          过期时间
          <time :datetime="activation.expiresAt">{{
            dateFormat.format(new Date(activation.expiresAt))
          }}</time>
        </p>
        <p class="muted">
          请妥善保管。关闭此对话框后将清除这里显示的激活码。
        </p>
      </template>
      <div
        v-if="activationExpired || activationError"
        role="alert"
      >
        <p>
          {{
            activationExpired
              ? "激活码已过期，请重新生成。"
              : "暂时无法生成激活码，请重试。"
          }}
        </p>
        <p
          v-if="activationError?.requestId"
          class="muted"
        >
          关联编号：{{ activationError.requestId }}
        </p>
      </div>
      <div class="terminal-actions">
        <button
          autofocus
          @click="closeDialog"
        >
          关闭
        </button>
        <button
          v-if="activationExpired || activationError"
          class="primary"
          @click="issue"
        >
          重新生成
        </button>
      </div>
    </div>
  </dialog>
</template>
