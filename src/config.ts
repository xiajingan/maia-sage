import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
const RuntimeSchema = Type.Object(
  {
    issuer: Type.String(),
    clientId: Type.Literal("sage"),
    redirectUri: Type.String(),
    apiBaseUrl: Type.String(),
    version: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type RuntimeConfig = Static<typeof RuntimeSchema>;
export function parseRuntimeConfig(
  value: unknown,
  origin: string,
): RuntimeConfig {
  if (!Check(RuntimeSchema, value)) throw new Error("运行配置无效");
  if (
    value.apiBaseUrl !== origin ||
    value.issuer !== origin + "/api/mud/auth" ||
    value.redirectUri !== origin + "/auth/callback" ||
    new URL(origin).protocol !== "https:"
  )
    throw new Error("运行配置无效");
  return value;
}
export async function loadRuntimeConfig() {
  const response = await fetch("/runtime-config.json", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("无法读取运行配置");
  return parseRuntimeConfig(await response.json(), window.location.origin);
}
