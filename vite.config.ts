import { defineConfig, type ProxyOptions, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { parseRuntimeConfig } from "./src/config.ts";
const port = Number(process.env.SAGE_PORT ?? 15443);
const origin = `https://localhost:${port}`;
const configPath = process.env.SAGE_PUBLIC_CONFIG;
const config = configPath
  ? parseRuntimeConfig(JSON.parse(readFileSync(configPath, "utf8")), origin)
  : undefined;
const certPath = process.env.SAGE_TLS_CERT;
const keyPath = process.env.SAGE_TLS_KEY;
const https =
  certPath && keyPath
    ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
    : undefined;
const middleware: Plugin = {
  name: "public-runtime-config",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/runtime-config.json") return next();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.statusCode = config ? 200 : 503;
      res.end(JSON.stringify(config ?? { message: "运行配置不可用" }));
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/runtime-config.json") return next();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.statusCode = config ? 200 : 503;
      res.end(JSON.stringify(config ?? { message: "运行配置不可用" }));
    });
  },
};
const proxy: Record<string, ProxyOptions> = {
  "/api/mud": {
    target: process.env.SAGE_MUD_TARGET ?? "http://127.0.0.1:11500",
    changeOrigin: false,
    headers: {
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": `localhost:${port}`,
    },
  },
};
const headers = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
};
export default defineConfig({
  plugins: [vue(), middleware],
  server: {
    port,
    strictPort: true,
    https,
    proxy,
    headers,
    fs: { strict: true, allow: [process.cwd()] },
  },
  preview: {
    port,
    strictPort: true,
    https,
    proxy,
    headers: {
      ...headers,
      "Content-Security-Policy": headers["Content-Security-Policy"].replace(
        "style-src 'self' 'unsafe-inline'",
        "style-src 'self'",
      ),
    },
  },
  build: { target: "es2023" },
});
