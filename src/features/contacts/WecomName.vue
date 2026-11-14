<script setup lang="ts">
import type { NameComponentConfig } from "./wecom-sdk";
defineProps<{
  reference?: NameComponentConfig["references"][number];
  corpId?: string;
  active: boolean;
}>();
</script>
<template>
  <span>
    <ww-open-data
      v-if="active && reference && corpId"
      :key="`${corpId}:${reference.userId}`"
      type="userName"
      :openid="reference.userId"
      :corpid="corpId"
    />
    <span
      v-else
      class="muted"
    >姓名暂不可展示</span>
  </span>
</template>
