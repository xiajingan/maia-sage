# 企微接入与内部联系人

本文维护 Sage 的安装与联系人页面。授权、实例绑定、范围交集与同步事实由 Mud 提供；跨工程设计见[管理端契约](../../../docs/architecture/management-ui-contracts.md)。官方姓名组件由后续任务接入，当前页面不把成员标识作为姓名。

## 页面与客户端

入口位于当前个人工作空间的「企业微信接入」。安装控制器为 `createWecomPage({api,session})`，联系人控制器为 `createContactPage({api,session})`，均通过同一个 [Mud API adapter](../../src/api/mud.ts) 调用生成方法、校验生成 Schema。DTO 取自冻结的 `maia-mud-client@0.5.0`，摘要和升级方式见[认证依赖](authentication.md#结构与依赖)。

| 页面       | 固定路径                                                              |
| ---------- | --------------------------------------------------------------------- |
| 接入入口   | `/workspaces/:workspaceId/wecom`                                      |
| 原安装结果 | `/workspaces/:workspaceId/wecom/install-operations/:operationId`      |
| 实例联系人 | `/workspaces/:workspaceId/channel-app-instances/:instanceId/contacts` |

联系人页面的 `pageKey` 为 `instance_contacts`，URL 不携 query/hash，分页 cursor 留在页面内存；跳转主要内容只移动焦点，返回历史或 hash 变化也会清理联系人 URL 的附加部分。实际请求限定 instanceId。根、User、manager 资格来自既有 SessionView，不新增浏览器权限状态。当前 Session 契约只有个人空间 manager，不虚构其他角色数据。

## 接入与原操作恢复

管理者选择成员扫码或管理员入口，服务端返回原 operationId、nextAction、rowVersion 及当前 launch。页面按 launch.kind 呈现当前步骤；管理员接入若要求独立身份核验且 launch.kind 为 member，显示「核验管理员身份」，不改称成员安装。

授权入口只由用户在新窗口打开，保留原 Maia 会话；回到原窗口后查询原操作，只有服务端 nextAction 为 complete 时允许提交所见 rowVersion。窗口不开启自动重试、循环授权或原始 code 传递。页面不读取返回页 code，也不通过 postMessage 接收凭据。结果未知时保留原操作并先查询，完成请求未知后在取得新查询结果前关闭完成按钮。

create 尚未返回 operationId 时，页面保留原 clientRequestId 和 mode，由用户明确「核对原发起请求」重复同内容的幂等请求，不生成新 key。已取得 operationId 后只查询原 ID，不重放一次性邀请。新操作只在服务端允许 start_new 后由用户明确发起。

sessionStorage 的 `sage.wecom.install` 只存 workspaceId、operationId，或尚无结果的原幂等输入。它不存 Bearer、code、launch URL、成员资料或权限。恢复引用只用来查询，归属与 sid 仍由服务端校验。存储不可用时，当前内存流程与已知稳定 operationId 查询仍可使用。

认证往返的业务返回路径绑定在既有 OIDC state.data 中。保存、callback 读取和主入口导航均校验仅允许上述安装结果与联系人路径，必须同源且没有 query/hash、ID 按生成 Schema 验证正十进制 BIGINT 上界。OidcClient 消费协议 state 后删除记录；身份签名、nonce、generation 与会话 epoch/读取成功条件都成立后，controller.callback 才释放可选 returnPath。它只表示导航意图，不授予读取权限；不增加独立 lastPath 或改动登录 prompt/sid 协议。

安装完成仅表示可信绑定或恢复完成。实例卡片分别展示安装、联系人同步、会话存档、终端条件、范围核对和最近可信时间；没有可执行 Account 时不显示 Tea/Celt 就绪。部分同步与范围待核对不会被安装完成覆盖。

## 联系人、同步与清理

每页读取 20 条并沿服务端 cursor 翻页。页面显示 accessState、scopeVersion、sync coverage、安全原因及最近可信时间；pending 的空列表明确说明不代表全量为零。职位和头像资料分别区分可获取、未获准、未返回与待核对，来源 ID 与命名空间单列「成员标识」。当前不加载头像 URL，避免把未经页面授权确认的外部媒体请求当作资料读取。

当前实例可访问且会话为 manager 时允许补同步。同步请求未知保留同 clientRequestId，由用户核对原请求；已经有 syncId 时可查询原同步。正常页面不轮询，不自动新建 job。同步返回较新范围时立即清空旧页和 cursor，使迟到的旧读取失效，再由用户刷新当前权限。

正常、空、加载、请求错误、受限/部分覆盖及无权都有明确页面。联系人读取失败时移除旧资料，保留安全恢复提示；已知同步摘要可独立呈现。实例列表刷新失败可以保留上次实例状态并注明来源。资源级 403/404 清空并锁定对应 feature，安装恢复引用也从本机移除，避免再次进入时反复查询已失效的旧 sid 操作；保留 Maia 会话；401 沿既有会话失效路径。退出、会话/根切换、实例切换或卸载时取消请求、清空局部资料；请求还检查当前 Session 引用、epoch、signal 及页面读取代次，迟到旧结果/拒绝不能恢复资料或清除后来会话。既有终端包装保留原 403 会话处理兼容行为。

## 姓名接点与验证边界

ContactWorkspace 的 `contact-name` scoped slot 提供 contactId、instanceId、scopeVersion 和当前 cursor；默认显示「姓名暂不可展示」。后续官方姓名组件应使用服务端配置及显示引用，不把真名提取到 Vue 数据、同步字段或快照。无 code 结果路径 `/wecom/name-context-result?operationId=...` 由姓名组件任务承接，本模块未实现该上下文状态机。

[接入原型](../prototypes/wecom-onboarding.html)与[联系人原型](../prototypes/contacts.html)可独立打开，以共享 token 和样式生成。联系人表格使用语义宽度 token 并在容器内横向滚动，避免小屏将各字段挤成逐字竖排。

[TC-SAGE-003](../test-cases/TC-SAGE-003.md)连接 controller、生成客户端与真实 Chrome 中的合成业务响应验证。`pnpm check:wecom-browser` 验证实际 Vue 页面、稳定业务路由、原操作恢复、同步幂等、权限清理、桌面/移动布局和原型状态。它不访问真实企微，不证明真实平台安装、官方姓名显示、共享 Test 组合或完整故事验收通过。
