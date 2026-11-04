<script setup lang="ts">
import type { SessionState } from "../../auth/session";
defineProps<{ state: SessionState }>();
defineEmits<{ reload: [] }>();
</script>
<template>
  <section class="intro">
    <h1>{{ state.session?.rootWorkspace.name ?? "个人工作空间" }}</h1>
    <p>属于你自己的办公空间。在这里查看成员与自己的身份。</p>
    <div
      v-if="state.session"
      class="context"
    >
      <span class="pill">{{ state.session.user.loginName }} · 本人</span>
      <span class="pill">管理者</span>
    </div>
  </section>
  <section
    class="panel"
    aria-labelledby="members-title"
    :aria-busy="state.phase === 'loading'"
  >
    <div class="panel-heading">
      <h2 id="members-title">
        空间成员
      </h2>
      <button
        :disabled="state.phase === 'loading'"
        @click="$emit('reload')"
      >
        刷新成员
      </button>
    </div>
    <template v-if="state.phase === 'loading'">
      <div
        role="status"
        class="notice"
      >
        正在确认工作空间与成员…
      </div>
      <div
        class="skeleton"
        aria-hidden="true"
      />
    </template>
    <div
      v-else-if="state.phase === 'degraded'"
      role="status"
      class="notice warning"
    >
      <p>{{ state.message }}</p>
      <p
        v-if="state.requestId"
        class="muted"
      >
        关联编号：{{ state.requestId }}
      </p>
      <div>
        <button @click="$emit('reload')">
          重新读取成员
        </button>
      </div>
    </div>
    <template v-else-if="state.members">
      <div
        v-if="state.members.items.length"
        class="table-scroll"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">
                成员
              </th>
              <th scope="col">
                角色
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="member in state.members.items"
              :key="member.userId"
            >
              <td>
                <span class="member-name">{{ member.loginName }}</span><span
                  v-if="member.userId === state.session?.user.id"
                  class="self"
                >本人</span>
              </td>
              <td class="role">
                {{ member.role === "manager" ? "管理者" : member.role }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-else
        class="notice"
      >
        <h2>暂未读取到成员</h2>
        <p>当前尚未读取到成员记录。刷新以核对当前空间。</p>
        <div>
          <button @click="$emit('reload')">
            重新读取成员
          </button>
        </div>
      </div>
    </template>
  </section>
  <p class="footnote">
    个人空间由首次成功登录自动建立，无需另行设置组织或角色。
  </p>
</template>
