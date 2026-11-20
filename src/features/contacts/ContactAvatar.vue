<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{ url?: string | null }>();
const failedUrl = ref<string>();
const image = computed(() => {
  if (!props.url || typeof globalThis.location === "undefined") return null;
  try {
    const url = new globalThis.URL(props.url);
    // The current site policy serves only same-origin user images.
    if (
      url.origin !== globalThis.location.origin ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.href === failedUrl.value
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
});
function onImageError(event: globalThis.Event) {
  const target = event.currentTarget as globalThis.HTMLImageElement;
  failedUrl.value = target.src;
}
</script>

<template>
  <span
    class="directory-avatar"
    aria-hidden="true"
  >
    <img
      v-if="image"
      :key="image"
      :src="image"
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="onImageError"
    >
    <span
      v-else
      class="avatar-placeholder"
    />
  </span>
</template>

<style scoped>
.directory-avatar {
  display: grid;
  place-items: center;
  width: var(--control-height);
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 50%;
  background: var(--color-soft);
  color: var(--color-muted);
}

.directory-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  display: grid;
  justify-items: center;
  gap: var(--line-thin);
}

.avatar-placeholder::before,
.avatar-placeholder::after {
  content: "";
  background: currentColor;
}

.avatar-placeholder::before {
  width: var(--space-2);
  aspect-ratio: 1;
  border-radius: 50%;
}

.avatar-placeholder::after {
  width: var(--space-4);
  height: var(--space-2);
  border-radius: var(--radius-pill) var(--radius-pill) var(--radius-control)
    var(--radius-control);
}
</style>
