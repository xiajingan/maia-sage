# maia-sage

Vue 3 管理 SPA，当前实现 US-001 的登录会话与个人工作空间：通过 Mud 的 OIDC 授权码/PKCE登录，读取服务端空间与本人管理者信息。注册和密码交互在Mud认证页完成。

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
```

`preview`使用同样的进程配置接口，复用已构建dist；运行时公开配置不会写入dist。独立E2E可设置SAGE_PORT=16443、独立SAGE_PUBLIC_CONFIG和SAGE_MUD_TARGET=http://127.0.0.1:11600，不覆盖demo配置。公开文件仅含issuer/clientId/redirectUri/apiBaseUrl/version，URL必须与进程公开HTTPS同源。

浏览器检查使用本机Chrome与临时独立上下文，默认输出安全截图到 `/tmp/maia-sage-ui`。可用 `SAGE_CHROME`、`SAGE_BROWSER_ORIGIN`、`SAGE_SCREENSHOTS` 指定测试路径和地址。脚本会在实际本地Mud注册新账号，不重置DB。真实主路径与route故障注入分开记录，不保存token/密码/trace/HAR。

## 阅读入口

- [本工程架构](ARCHITECTURE.md)、[总仓规则](../PROJECT_RULES.md)、[工程规则](PROJECT_RULES.md)
- [认证与会话技术方案](docs/tech/authentication.md)
- [TC-SAGE-001](docs/test-cases/TC-SAGE-001.md) 与 [用例索引](docs/test-cases/index.md)
- [独立界面原型](docs/prototypes/personal-workspace.html)：直接打开；`pnpm prototype`从同一token/布局生成，`pnpm check:prototype`检查同步。

此片完成不代表共享Test/生产上线，也不代表US-001全部AC已验收；真实终端隔离随US-009补验。
