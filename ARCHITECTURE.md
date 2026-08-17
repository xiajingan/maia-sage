# Sage 架构

> Sage 是 Maia 的统一管理与配置入口，服务端 API 是权限和状态的唯一裁决者。

## 1. 定位

Sage 是 Vue 3 管理 SPA，覆盖租户/成员/权限、账号/联系人、终端、内容、插件/Action/Workflow、任务、会话、报表和内嵌 Iris Chat。Sage 不承载领域状态机、不直连数据库、不保存长期凭据，也不以隐藏按钮替代服务端授权。

## 2. 前端结构

按 feature 组织：`governance`、`accounts`、`contacts`、`terminals`、`assets`、`automation`、`tasks`、`conversations`、`reports`、`chat`。每个 feature 分 UI、query/state、generated API client、route/permission meta；共享层仅放设计系统、认证会话、错误呈现和遥测。

浏览器只访问同源 Ingress 的 `/api/*`；Ingress 只做 TLS、CORS、限流和精确路由，内部服务仍为 ClusterIP。Sage 作为 OIDC 公共客户端使用授权码 + PKCE，access token 仅存内存并以 Bearer 发送，不使用不存在的 BFF/HttpOnly 应用会话。每个服务自行校验 issuer/audience/签名/过期和 tenant/principal claims，并依据 Mud `principal_epoch/status` 及撤销事件拒绝已禁用身份；租户切换必须重新授权取得新 token。浏览器不持有服务身份。

各服务 OpenAPI 是机器真源，Release Manifest 固定规格版本和生成 client；客户端按服务分包，error/event wire schema 也由对应服务契约拥有。CI 检测破坏变更并运行消费者契约，消费者迁移后按登记版本删除旧 client，禁止手写重复 DTO。服务返回 capability/permission 供界面解释操作，但服务端始终重新授权。

权限 UI 明示 Creator、直接 Owner、有效 Own 来源、User 和关联实体权限；默认 Own scope，Use 必须显式切换。列表、详情和导出请求/结果都携带并显示实际 scope 与权限来源；导出由服务端重新鉴权。Owner 移交收集原因且不改变 Entity Link，User 授权不产生管理权。

## 3. 交互原则

创建/发布/移交/删除/取消/回放等操作先展示影响预览。一般领域变更的确认记录由动作所属服务签发和消费；凡最终产生外部 Action/Workflow 副作用，Stem 是 Confirmation 的唯一签发者和入队消费者，Sage/Iris/Mint/Tea 只传递 `confirmation_id`。确认绑定租户、操作者、动作、目标、参数/资源/计划版本摘要、有效期、单次 token 和幂等键；换参或过期必须重批。

长任务订阅服务权威 EventLog 的单调 cursor；断线用 Last-Event-ID 恢复，游标过期先加载权威快照，轮询只作同状态机的降级。服务端终态覆盖本地 query cache，重复/乱序事件按序号忽略；错误统一显示分类、影响、恢复动作和关联 ID。

Action 编辑遵循 Plugin→Action→Step/Operation，Workflow 编辑遵循节点→依赖/分支→子流程，发布遵循 draft→validated→staged→published→deprecated→archived；页面只编排所属服务暴露的 Command，不另建状态机。终端绑定、运行配置、灰度和回滚均展示服务端版本与影响快照。

### 3.1 产品信息架构

| 工作区 | 核心对象 | 主要用户任务 |
|---|---|---|
| Governance | Tenant、Member、ManagerGroup、Role、Owner/User | 建组织、授权、移交、审计 |
| Data Assets | Account、Contact/Group、Content | 授权账号、同步对象、管理内容版本 |
| Automation Studio | Plugin、Resource、Action、Workflow | 设计、校验、发布、灰度、回滚 |
| Runtime | Terminal、Task、Todo、Execution、Proof | 注册终端、创建任务、处置异常、验证结果 |
| Conversation | Conversation、ReplyPolicy/Draft/Outcome | 检索会话、审核回复、下钻执行 |
| Operations | Metrics、Alert、Audit、Report | 看新鲜度、异常、趋势和证据 |
| Agent | AgentConversation、Plan、Approval | 对话委托、确认、查看报告 |

页面模型只组合 read model，不承担跨服务事务。跨模块操作先请求服务端 impact preview，返回 `preview_id/version/expires_at/affected_entities/warnings/required_confirmation`，提交必须带同一版本。

### 3.2 前端领域模型和状态

Server state 使用 query cache，以 resource version/cursor 更新；编辑草稿使用局部 form state；长 Run 使用 EventLog projection；用户身份/tenant 是独立 session state。禁止把四类状态塞入全局 store。路由 meta 声明 required capability，但只能优化体验，不能授权。

### 3.3 可维护性、性能和安全

- generated client 按服务隔离，禁止跨 feature 导入内部 store；共享组件没有业务请求。
- 大列表统一 cursor、虚拟滚动和服务端筛选；Dashboard 先显示 freshness，不让慢分析阻塞治理页面。
- CSP、Trusted Types、依赖 SCA、输出编码和敏感字段遮罩；token 仅内存，刷新/撤销路径 E2E。
- 每个高风险 Command 覆盖预览过期、换参、重复点击、401/403、部分失败和重连。

产品路线：S0 导航/身份/设计系统 → S1 治理/权限 → S2 终端与资产 → S3 Automation Studio → S4 Task/Proof → S5 Conversation/Tea → S6 Iris Chat → S7 数据运营。后续阶段不得通过前端 Mock 绕过未完成后端契约。

## 4. 部署与质量

静态产物构建一次，以 OCI/Helm 经 Ingress 发布。容器启动时只把通过 Schema 校验的公共 API base、OIDC issuer/client、版本写入独立 `/runtime-config.json`，设 no-store/CSP 并关联 Release Manifest；Secret 永不进入文件或 bundle，配置无效则 readiness 失败。质量覆盖类型、组件、契约、可访问性和 Playwright E2E；Test 使用真实后端验证租户隔离、token/身份撤销、Own/Use 导出、拒绝、高风险确认、断流恢复和任务闭环。

迁移以 `maia-sage-v0.1.0` 切换按服务生成的 client、Iris SSE EventLog 和 Stem Confirmation 引用，并迁移 route/query cache key；Test 消费者契约和 E2E 通过后，`maia-sage-v0.2.0` 删除手写 DTO、旧确认组件、旧 WS Chat 和旧状态适配器，不保留双协议。
