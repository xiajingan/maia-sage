import { OidcClient, WebStorageStateStore } from "oidc-client-ts";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { RuntimeConfig } from "../config";
import type { Oidc } from "./session";
export async function verifyIdentity(
  token: string,
  config: RuntimeConfig,
  nonce: string,
  keys: JWTVerifyGetKey,
) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: config.issuer,
    audience: config.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["iss", "aud", "exp", "sub", "sid", "nonce"],
  });
  if (
    payload.nonce !== nonce ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    typeof payload.sid !== "string" ||
    !payload.sid
  )
    throw new Error("身份验证失败");
  return payload.sub;
}
const prefix = "sage.oidc.";
export function createOidc(config: RuntimeConfig): Oidc {
  const store = new WebStorageStateStore({ prefix, store: sessionStorage });
  // OidcClient deliberately has no UserManager/UserStore: responses never persist tokens.
  const client = new OidcClient({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid",
    loadUserInfo: false,
    stateStore: store,
    staleStateAgeInSeconds: 600,
    extraQueryParams: {
      claims: JSON.stringify({ id_token: { sid: { essential: true } } }),
    },
  });
  let generation = 0;
  function clear(preserveAuthorizationState = false) {
    ++generation;
    if (preserveAuthorizationState) return;
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  }
  return {
    clear,
    async signIn(restore = false) {
      const current = generation;
      await client.clearStaleState();
      const request = await client.createSigninRequest({
        nonce: crypto.randomUUID(),
        ...(restore ? {} : { prompt: "login" }),
      });
      if (current !== generation) {
        await store.remove(request.state.id);
        return;
      }
      window.location.assign(request.url);
    },
    async callback(url) {
      const current = generation;
      let stateId: string | undefined;
      try {
        const { state } = await client.readSigninResponseState(url);
        stateId = state.id;
        if (
          !state.nonce ||
          Date.now() / 1000 - state.created > 600 ||
          state.authority !== config.issuer ||
          state.client_id !== config.clientId ||
          state.redirect_uri !== config.redirectUri
        )
          throw new Error("登录状态已失效");
        const response = await client.processSigninResponse(url);
        if (!response.id_token || !response.access_token)
          throw new Error("缺少登录凭据");
        const metadata = await client.metadataService.getMetadata();
        if (
          !metadata.jwks_uri ||
          new URL(metadata.jwks_uri).origin !== config.apiBaseUrl
        )
          throw new Error("身份密钥地址无效");
        const subject = await verifyIdentity(
          response.id_token,
          config,
          state.nonce,
          createRemoteJWKSet(new URL(metadata.jwks_uri)),
        );
        if (current !== generation) throw new Error("登录已取消");
        return {
          accessToken: response.access_token,
          idToken: response.id_token,
          subject,
        };
      } finally {
        if (stateId)
          await store.remove(
            stateId,
          ); /* Only remove the original operation, never a new login's state. */
      }
    },
  };
}
