import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const data = readFileSync(
  new URL("../vendor/maia-mud-client-0.2.0.tgz", import.meta.url),
);
if (
  createHash("sha256").update(data).digest("hex") !==
  "3de661e6b5097189c3fa15b85a045e05de23cc538a7f3a1c3f18c4baef2a8bc1"
)
  throw new Error("client制品摘要不匹配");
const lock = readFileSync(
  new URL("../pnpm-lock.yaml", import.meta.url),
  "utf8",
);
if (
  !lock.includes(
    "sha512-P0xgm1EwfPE0umjm1/bxUvyRJmj5MDAuwr39GmJ+baqGkK9tPbmwVBiCPSGx6ekwPIANblxF18WzIjZ7CzfI5Q==",
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
])
  if (typeof client[key] !== "function") throw new Error("client导出缺失");
console.log("maia-mud-client@0.2.0 SHA256、锁完整性与公开导出通过");
