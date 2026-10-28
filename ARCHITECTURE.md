# Sage 架构

**当前 Profile**：`simple-layered`

Sage 是 Vue 3 管理 SPA 与 Iris Chat 入口。产品见 [Sage 故事](../docs/product/sage/index.md)，事实消费、预览、定义比较及恢复规则只在[管理端契约](../docs/architecture/management-ui-contracts.md)维护。

## 1. 定位与边界

Sage 组合业务所有者的查询/命令/事件，不承载领域状态机、跨服务事务或授权算法。页面范围随获准故事交付，Workflow、回放、客户运维或通用审批平台不因信息架构有分组而启用。

## 2. 前端结构

按 feature 组织 `governance/accounts/contacts/terminals/assets/automation/tasks/conversations/reports/chat`；每个 feature 分 UI、query/state、generated API client 与 route meta。共享层仅放设计系统、认证会话、错误呈现和遥测，组件没有业务请求，禁止跨 feature 引用内部 store。

各服务 OpenAPI/事件 Schema 是机器契约来源，client 按服务分包并锁定发布版本；构建和消费者契约检测不兼容变更，不手写重复 DTO。页面展示有效权限来源、Owner/使用范围及本次操作影响，具体字段和允许写法引用[权限模型](../docs/product/constraints/permission-model.md)，不在前端重建权限图。

浏览器消费同源 `/api/*`，作为 OIDC 公共客户端采用授权码 + PKCE，access token 仅内存并以 Bearer 发送，不持有服务身份或另建 BFF 会话。根切换重新授权；服务校验 token 和当前 User/撤销事实，页面缓存不是权限。入口路由和运行配置见[部署设计](../docs/DEPLOYMENT.md)，不在本文复制 Ingress/ClusterIP 拓扑。

## 3. 交互适配

按动作已有业务语义分别处理管理变更确认、任务提交人确认和 Tea 审核。需要影响预览的场景消费真实所有者的结果；第一片账号范围预览和动作保存定义比较分别遵守[管理端 §2～3](../docs/architecture/management-ui-contracts.md#2-账号范围预览)，不固定跨服务统一 preview DTO，也不将所有创建/取消强制放进同一审批流程。

各 feature adapter 保存本次操作输入版本和关联，遇到未知响应先查原操作；错误呈现安全分类、影响、当前有权的恢复动作和关联 ID。Confirmation 绑定和一次消费引用[任务提交契约](../docs/architecture/task-execution.md#2-提交快照与确认)，Iris 卡片关联同一事实，Tea 已审核发送不加第二关。

Action 编辑消费 Mud 发布的 Operation/Action Schema；Workflow 编辑仅在对应业务恢复后采用。试用、推广和退回展示服务端版本与影响，不自行重建通用发布状态机。

### 3.1 信息架构

| 工作区 | 页面组织边界 |
|---|---|
| Governance | 当前根、Workspace/成员、身份源与授权管理 |
| Data Assets | 账号、联系人/群、图片和常用文字 |
| Automation | 终端、插件和已采用的 Action 定义 |
| Runtime | Task、Todo、Execution、Proof 与有权异常处置 |
| Conversation | 授权消息、账号问答、托管、稿审核和依据 |
| Reports | 已获准效果视图与数据截至时间 |
| Chat | 本人当前 Iris 对话、提交/确认和有权结果 |

分组不代表已交付页面或新增权限；具体入口、范围和验收沿总仓故事。

### 3.2 前端状态

Server state 使用 query cache，以 resource version/cursor 更新；编辑草稿用局部 form state；长 Run 使用 EventLog projection；用户/当前根为独立 session state，不将四类状态塞进全局 store。query/form/event 按根/User/对象隔离，切换或失权时清理，迟到响应不能恢复旧内容；版本与流恢复见[管理端 §4](../docs/architecture/management-ui-contracts.md#4-根切换与状态恢复)。

路由 meta 只优化入口体验；列表、详情、已有导出和证据链接消费服务端实际 scope 与权限来源。事件 adapter 按服务版本/序号更新事实，轮询仅作同源事实的降级；已消费确认不能被页面恢复重新提交。

### 3.3 可维护性、性能与安全

大列表使用 cursor、虚拟滚动和服务端筛选；效果页先显示 freshness，慢分析不阻塞治理入口。CSP/Trusted Types、输出编码、依赖 SCA 与敏感字段遮罩在浏览器基础层统一处理；Secret 不进入 bundle、公共配置、缓存或遥测。

## 4. 制品与验证

静态产物构建一次，启动只将通过 Schema 校验的公共 API base、OIDC issuer/client 和版本写入 `/runtime-config.json`；no-store/CSP、Release Manifest 关联和无效配置拒绝就绪的要求随制品验证，发布入口见[部署设计](../docs/DEPLOYMENT.md#6-制品发布与终端)。Sage 不消费 Seed 后端包。

质量覆盖类型、组件、消费者契约、可访问性和 Playwright；按[管理端增量验收](../docs/product/constraints/acceptance.md)使用真实后端验证根/User 切换、迟到回调、401/403、失权、预览过期、重复点击、未知对账、稿/确认恢复及业务闭环，不能以 mock 或隐藏按钮代替服务拒绝。
