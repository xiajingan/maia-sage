import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const data = readFileSync(
  new URL("../vendor/maia-mud-client-0.5.0.tgz", import.meta.url),
);
if (
  createHash("sha256").update(data).digest("hex") !==
  "53c119750398d610c92a6d4df2c6a6bfbde009a7216fa6a6b22dcd9b2e46500f"
)
  throw new Error("client制品摘要不匹配");
const lock = readFileSync(
  new URL("../pnpm-lock.yaml", import.meta.url),
  "utf8",
);
if (
  !lock.includes(
    "sha512-FCny8NAoCImz4vhZ5XaOAw5U8/wKLts1YuJ15GLRlw9LYjufrNN7mKwpV0FGXtYWWjl+zpz3FC931HqyhJr+dA==",
  )
)
  throw new Error("client完整性未锁定");
const client = await import("maia-mud-client");
for (const key of [
  "createClient",
  "getSession",
  "listMembers",
  "logout",
  "listTerminals",
  "getTerminal",
  "issueTerminalActivation",
  "createWecomInstallOperation",
  "getWecomInstallOperation",
  "completeWecomInstallOperation",
  "listChannelAppInstances",
  "listContacts",
  "requestContactSync",
  "getContactSync",
])
  if (typeof client[key] !== "function") throw new Error("client导出缺失");
console.log("maia-mud-client@0.5.0 SHA256、锁完整性与公开导出通过");
