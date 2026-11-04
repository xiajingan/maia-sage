import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const data = readFileSync(
  new URL("../vendor/maia-mud-client-0.1.1.tgz", import.meta.url),
);
if (
  createHash("sha256").update(data).digest("hex") !==
  "9741f1f191e6a8539c1444acc354ba9f9ba2edf3c868928458f2dda37d490e88"
)
  throw new Error("client制品摘要不匹配");
const lock = readFileSync(
  new URL("../pnpm-lock.yaml", import.meta.url),
  "utf8",
);
if (
  !lock.includes(
    "sha512-jBx4ZL2QUNNAjvEqCQJVpypCP4OqLywk5mcqx+aQb9/NZuCeGmNw//XMrZzdGwCJJSSYN7cgyGHPR1+2wxg4YQ==",
  )
)
  throw new Error("client完整性未锁定");
const client = await import("maia-mud-client");
for (const key of ["createClient", "getSession", "listMembers", "logout"])
  if (typeof client[key] !== "function") throw new Error("client导出缺失");
console.log("maia-mud-client@0.1.1 SHA256、锁完整性与公开导出通过");
