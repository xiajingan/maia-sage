# maia-sage

Vue 3 管理 SPA。US-001 通过 Mud 的 OIDC 授权码与 PKCE 登录，读取服务端的个人工作空间与本人管理者信息。注册和密码交互在 Mud 认证页完成。US-009 在登录后的终端页生成一次性激活码，并展示本根终端的登记、连接、版本及本机能力。

## 运行与检查

采用总仓精确基线 Node 24.21.0 / pnpm 12.5.1。依赖与制品摘要锁定；安装 `pnpm install --frozen-lockfile`。

本地已备工具链时：

```sh
export PATH=/tmp/maia-us001-runtime/bin:$PATH
export SAGE_PUBLIC_CONFIG=/Users/ws/space/git/maia/deploy/local/.runtime/demo-auth/public-config.json
export SAGE_TLS_CERT=/Users/ws/space/git/maia/deploy/local/.runtime/tls/localhost.crt
export SAGE_TLS_KEY=/Users/ws/space/git/maia/deploy/local/.runtime/tls/localhost.key
export SAGE_PORT=15443
export SAGE_MUD_TARGET=http://127.0.0.1:11500
pnpm dev
```

访问 `https://localhost:15443`。证书不放public；本地浏览器进程可忽略当前自签证书，不改OS信任。没有有效公开配置时显示拒绝就绪页面。

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm check:client
pnpm check:prototype
pnpm build
pnpm preview
pnpm check:browser
pnpm check:terminal-browser
```

`preview`使用同样的进程配置接口，复用已构建dist；运行时公开配置不会写入dist。独立E2E可设置SAGE_PORT=16443、独立SAGE_PUBLIC_CONFIG和SAGE_MUD_TARGET=http://127.0.0.1:11600，不覆盖demo配置。公开文件仅含issuer/clientId/redirectUri/apiBaseUrl/version，URL必须与进程公开HTTPS同源。

读取服务失败时仍可退出。退出核实请求10秒超时后提示待核实，保留原操作供重试；核实中也可重新登录。

浏览器检查使用本机Chrome与临时独立上下文，默认输出安全截图到 `/tmp/maia-sage-ui`。可用 `SAGE_CHROME`、`SAGE_BROWSER_ORIGIN`、`SAGE_SCREENSHOTS` 指定测试路径和地址。脚本会在实际本地Mud注册新账号，不重置DB。真实主路径与route故障注入分开记录，不保存token/密码/trace/HAR。

`pnpm check:terminal-browser` 使用临时本地端口、真实 Chrome 及显式注入的 API 响应验证终端交互。真实 Celt、Mud 和 Stem 链路由总仓测试。

## 阅读入口

- [本工程架构](ARCHITECTURE.md)、[总仓规则](../PROJECT_RULES.md)、[工程规则](PROJECT_RULES.md)
- [认证与会话技术方案](docs/tech/authentication.md)、[终端接入](docs/tech/terminals.md)
- [用例索引](docs/test-cases/index.md)
- [个人工作空间原型](docs/prototypes/personal-workspace.html)、[终端原型](docs/prototypes/terminals.html)可直接打开。`pnpm prototype` 从同一套 token 与布局生成，`pnpm check:prototype` 检查同步。
