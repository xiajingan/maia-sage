import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const lock = readFileSync(
  new URL("../pnpm-lock.yaml", import.meta.url),
  "utf8",
);
for (const [version, sha256, sha512] of [
  [
    "0.5.0",
    "53c119750398d610c92a6d4df2c6a6bfbde009a7216fa6a6b22dcd9b2e46500f",
    undefined,
  ],
  [
    "0.6.0",
    "ac92f682e0d37c5c63d62c50169142c2d0473f9c11df153614829e8602878a51",
    "eba6fa69114e6f9b3dc90c00b101aa253f3ff1f35350fadf66e9f96af72e721fecb22b81af4729526a7968c55de27e427d98a91e732813a70916ad77d93ec004",
  ],
  [
    "0.7.0",
    "1bfca737bcb7557ea39806c704b6aaea58e38679ad384a5111deddc699c45633",
    "2476f6897697d00ea129d1002286d3a75e49392cf16ea28a95abf2479e9c38566684d2aefb226527e825422afa6eee4d4f8dfe8b73d3113d1468662337adffe5",
  ],
]) {
  const data = readFileSync(
    new URL(`../vendor/maia-mud-client-${version}.tgz`, import.meta.url),
  );
  if (createHash("sha256").update(data).digest("hex") !== sha256)
    throw new Error("client制品摘要不匹配");
  if (
    sha512 &&
    (createHash("sha512").update(data).digest("hex") !== sha512 ||
      (version === "0.7.0" &&
        !lock.includes(
          `sha512-${Buffer.from(sha512, "hex").toString("base64")}`,
        )))
  )
    throw new Error("client完整性未锁定");
}
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
  "getWecomInstallRecoverySource",
  "createWecomInstallRecovery",
  "getWecomInstallRecovery",
  "completeWecomInstallRecovery",
  "getWecomInstallOperation",
  "completeWecomInstallOperation",
  "listChannelAppInstances",
  "listContacts",
  "requestContactSync",
  "getContactSync",
  "createNameContext",
  "getNameContext",
  "completeNameContext",
  "getNameComponentConfig",
  "getBoundNameComponentConfig",
])
  if (typeof client[key] !== "function") throw new Error("client导出缺失");
const schemas = await import("maia-mud-client/schemas");
for (const key of [
  "BoundNameComponentConfigSchema",
  "InstallViewSchema",
  "InstallRecoveryInputSchema",
  "InstallRecoveryCompleteSchema",
  "InstallRecoverySourceQuerySchema",
  "InstallRecoverySourceViewSchema",
  "InstallRecoveryViewSchema",
])
  if (!schemas[key]) throw new Error("client Schema导出缺失");
console.log(
  "maia-mud-client@0.7.0 SHA256/SHA512、锁完整性、绑定身份组件与恢复 SDK/Schema 校验通过",
);
