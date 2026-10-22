# Sage 架构

**当前 Profile**：`simple-layered`

> Sage 是 Maia 的统一管理与配置入口，服务端 API 是权限和状态的唯一裁决者。

## 1. 定位

Sage 是 Vue 3 管理 SPA，覆盖根 Workspace 切换、Workspace 树/成员/权限、账号/联系人、终端、内容、插件/Action/Workflow、任务、会话、报表和内嵌 Iris Chat。Sage 不承载领域状态机、不直连数据库、不保存长期凭据，也不以隐藏按钮替代服务端授权。

Sage 不依赖 Seed 的服务端公共包。前端通用能力由 Sage 自身前端基础层管理，服务交互只消费各后端发布的 OpenAPI/事件契约，不通过服务端 adapter 形成间接依赖。

## 2. 前端结构

按 feature 组织：`governance`、`accounts`、`contacts`、`terminals`、`assets`、`automation`、`tasks`、`conversations`、`reports`、`chat`。每个 feature 分 UI、query/state、generated API client、route/permission meta；共享层仅放设计系统、认证会话、错误呈现和遥测。

浏览器只访问同源 Ingress 的 `/api/*`；Ingress 只做 TLS、CORS、限流和精确路由，内部服务仍为 ClusterIP。Sage 作为 OIDC 公共客户端使用授权码 + PKCE，access token 仅存内存并以 Bearer 发送，不使用不存在的 BFF/HttpOnly 应用会话。每个服务自行校验 issuer/audience/签名/过期和根 Workspace（`tenant_id`）/User claims，并依据 Mud 的 User 状态与撤销事件拒绝已禁用身份；切换根 Workspace 必须重新授权取得新 token。浏览器不持有服务身份。

各服务 OpenAPI 是机器真源，Release Manifest 固定规格版本和生成 client；客户端按服务分包，error/event wire schema 也由对应服务契约拥有。CI 检测破坏变更并运行消费者契约，禁止手写重复 DTO。服务返回当前 User 对目标的有效 Own/Use 及权限来源供界面解释操作，但服务端始终重新授权。

权限语义以 Maia 主仓库 `USER_STORIES.md#21-权限模型`（§2.1.2～§2.1.6）为准。权限 UI 明示 Creator、Owner 节点、使用范围、有效 Own/Use 来源（Owner 节点、直接或继承的 `manager`、命中的使用范围元素）和关联实体权限；创建时明确 Owner 节点（`manager` 创建的资源实体固定归属当前所在 Workspace，界面不能选择下级 Workspace，服务端拒绝将下级 Workspace 作为创建归属的请求；`member` 落到所选 Workspace 下的本人个人节点，默认当前 Workspace）；创建与编辑时展示按业务类型写入的默认使用范围，只提供该类型允许的写法，可选 Workspace 与 User 限于设置者所属 Workspace 或其下级及其中的 User；默认 Own scope，Use 必须显式切换。Account 页按 Own/Use 区分责任视图（可叫停）与运营视图；任务进度与统计标注全量/切片口径，切片只显示切片进度百分比；能力要求只显示兼容性。列表、详情和导出请求/结果都携带并显示实际 scope 与权限来源；导出由服务端重新鉴权。主动移交 Owner 收集原因且不改变 Entity Link；成员 U 离开 W 后，界面按资源服务返回的事实将原 W/U 数据展示为归属 W，显示自动归属变更审计，无需人工移交；仅停用而未撤销成员关系不触发归属变更。使用范围不产生管理权，调整使用范围仅限有效 Own 并审计。

## 3. 交互原则

创建/发布/移交/删除/取消/回放等操作先展示影响预览。一般领域变更的确认记录由动作所属服务签发和消费；凡最终产生外部 Action/Workflow 副作用，Stem 是 Confirmation 的唯一签发者和入队消费者，Sage/Iris/Mint/Tea 只传递 `confirmation_id`。确认绑定根 Workspace、操作者、动作、目标、参数/资源/计划版本摘要、有效期、单次 token 和幂等键；换参或过期必须重批。

长任务订阅服务权威 EventLog 的单调 cursor；断线用 Last-Event-ID 恢复，游标过期先加载权威快照，轮询只作同状态机的降级。服务端终态覆盖本地 query cache，重复/乱序事件按序号忽略；错误统一显示分类、影响、恢复动作和关联 ID。

Action 编辑遵循 Plugin→Action→Step/Operation，Workflow 编辑遵循节点→依赖/分支→子流程，发布遵循 draft→validated→staged→published→deprecated→archived；页面只编排所属服务暴露的 Command，不另建状态机。终端绑定、运行配置、灰度和回滚均展示服务端版本与影响快照。

### 3.1 产品信息架构

| 工作区 | 核心对象 | 主要用户任务 |
|---|---|---|
| Governance | 根 Workspace、Workspace 树/Membership（`manager`/`member`）、User、AppInstance、Creator/Owner/使用范围 | 切换根 Workspace、管理 Workspace 树与成员角色、使用范围、移交、审计；用户池/身份源/应用与凭据仅对根 Workspace 管理者开放 |
| Data Assets | Account、Contact/Group、Content | 授权账号、同步对象、管理内容版本 |
| Automation Studio | Plugin、Resource、Action、Workflow | 设计、校验、发布、灰度、回滚 |
| Runtime | Terminal、Task、Todo、Execution、Proof | 注册终端、创建任务、处置异常、验证结果 |
| Conversation | Conversation、ReplyPolicy/Draft/Outcome | 检索会话、审核回复、下钻执行 |
| Operations | Metrics、Alert、Audit、Report | 看新鲜度、异常、趋势和证据 |
| Agent | AgentConversation、Plan、Approval | 对话委托、确认、查看报告 |

页面模型只组合 read model，不承担跨服务事务。跨模块操作先请求服务端 impact preview，返回 `preview_id/version/expires_at/affected_entities/warnings/required_confirmation`，提交必须带同一版本。

### 3.2 前端领域模型和状态

Server state 使用 query cache，以 resource version/cursor 更新；编辑草稿使用局部 form state；长 Run 使用 EventLog projection；用户身份/当前根 Workspace 是独立 session state。禁止把四类状态塞入全局 store。路由 meta 声明所需 Own/Use 或根 Workspace 管理者入口，但只能优化体验，不能授权。

### 3.3 可维护性、性能和安全

- generated client 按服务隔离，禁止跨 feature 导入内部 store；共享组件没有业务请求。
- 大列表统一 cursor、虚拟滚动和服务端筛选；Dashboard 先显示 freshness，不让慢分析阻塞治理页面。
- CSP、Trusted Types、依赖 SCA、输出编码和敏感字段遮罩；token 仅内存，刷新/撤销路径 E2E。
- 每个高风险 Command 覆盖预览过期、换参、重复点击、401/403、部分失败和重连。

## 4. 部署与质量

静态产物构建一次，以 OCI/Helm 经 Ingress 发布。容器启动时只把通过 Schema 校验的公共 API base、OIDC issuer/client、版本写入独立 `/runtime-config.json`，设 no-store/CSP 并关联 Release Manifest；Secret 永不进入文件或 bundle，配置无效则 readiness 失败。质量覆盖类型、组件、契约、可访问性和 Playwright E2E；Test 使用真实后端验证根 Workspace 隔离、token/身份撤销、Own/Use 导出、拒绝、高风险确认、断流恢复和任务闭环。
