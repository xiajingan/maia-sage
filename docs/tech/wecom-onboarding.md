# 企微接入与内部联系人

本文维护 Sage 的安装与联系人页面。授权、实例绑定、范围交集与同步事实由 Mud 提供；跨工程设计见[管理端契约](../../../docs/architecture/management-ui-contracts.md)。官方姓名组件使用 Mud 的临时页面配置，页面不把成员标识作为姓名。

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

认证往返的业务返回路径绑定在既有 OIDC state.data 中。保存、callback 读取和主入口导航均校验仅允许上述安装结果与联系人路径，必须同源且没有 query/hash、ID 按生成 Schema 验证正十进制 BIGINT 上界。OidcClient 消费协议 state 后删除记录；身份签名、nonce、generation 与会话 epoch/读取成功条件都成立后，controller.callback 才释放可选 returnPath。它只表示导航意图，不授予读取权限；姓名授权返回另用显式同会话恢复选项，见[姓名展示](#姓名组件与页面授权)。

安装完成仅表示可信绑定或恢复完成。实例卡片分别展示安装、联系人同步、会话存档、终端条件、范围核对和最近可信时间；没有可执行 Account 时不显示 Tea/Celt 就绪。部分同步与范围待核对不会被安装完成覆盖。

## 联系人、同步与清理

每页读取 20 条并沿服务端 cursor 翻页。页面显示 accessState、scopeVersion、sync coverage、安全原因及最近可信时间；pending 的空列表明确说明不代表全量为零。职位和头像资料分别区分可获取、未获准、未返回与待核对，来源 ID 与命名空间单列「成员标识」。当前不加载头像 URL，避免把未经页面授权确认的外部媒体请求当作资料读取。

当前实例可访问且会话为 manager 时允许补同步。同步请求未知保留同 clientRequestId，由用户核对原请求；已经有 syncId 时可查询原同步。正常页面不轮询，不自动新建 job。

联系人读取和同步读取共享已接受事实的代次。每次接收页面或同步事实后，先前基于旧事实发出的查询不能再覆盖范围、同步摘要或安全提示；即使 scopeVersion 相同，旧 syncId/rowVersion 的应答也会被丢弃。只有请求所依赖的事实仍是当前代次时，同步应答才可更新摘要；若其范围与现页不一致，则清空该页和 cursor，让用户重新核对，不把「范围不相等」解释成业务版本前进，也不按 ID 大小判断新旧。加载标记在原请求结束或清理后正常释放。

未知补同步的幂等输入还固定其原事实代次。后来取得新页面事实后，用户仍可用原 key 核对；成功只确认原请求并解除未知标记，不用原请求的旧同步摘要覆盖新页面；本次重核若收到当前权限拒绝，仍按当前请求的代次执行资料清理，不因原输入较旧而忽略拒绝。

正常、空、加载、请求错误、受限/部分覆盖及无权都有明确页面。联系人读取失败时移除旧资料，保留安全恢复提示；已知同步摘要可独立呈现。实例列表刷新失败可以保留上次实例状态并注明来源。资源级 403/404 清空并锁定对应 feature，安装恢复引用也从本机移除，避免再次进入时反复查询已失效的旧 sid 操作；保留 Maia 会话；401 沿既有会话失效路径。退出、会话/根切换、实例切换或卸载时取消请求、清空局部资料；请求还检查当前 Session 引用、epoch、signal 及页面读取代次，迟到旧结果/拒绝不能恢复资料或清除后来会话。既有终端包装保留原 403 会话处理兼容行为。

## 姓名组件与页面授权

公开开关 `wecomNamesEnabled` 默认为 false，开启后在原联系人页提供姓名授权/原操作核对。`createNameContextController({api,session})` 管理单页操作、短期配置与清理；沿 `session.withAccess` 使用原内存 Bearer。生成客户端的 createNameContext/getNameContext/completeNameContext/getNameComponentConfig 与生成 Schema 是唯一 HTTP 类型来源。姓名配置请求固定 pageKey=instance_contacts、limit=20 与联系人当前 cursor，不提交成员 ID、sid、任意签名 URL 或浏览器关联值。Cookie 仍由 Mud 的 HttpOnly/Secure/Lax 配置管理，Sage 不读写它。四个name方法均显式使用credentials=same-origin；HTTPS合成Chrome已验证create的Set-Cookie在后续query/complete/config请求中自动携带，实际Mud的设置/拒绝仍由T9验证。

普通 Web 仅接受官方98171的 `https://login.work.weixin.qq.com/wwlogin/sso/login`；member仅接受91120的 `https://open.weixin.qq.com/connect/oauth2/authorize`，不自行构造授权参数。普通 Web 点击动作同步打开空白新窗口，收到原操作授权入口后才导航。被阻止时给「打开姓名授权」，不会自动再次弹窗。原窗口保留 Bearer；`/wecom/name-context-result?operationId=...` 先删除 query/hash，只发送 `{operationId}` 到同源 opener。原窗口核对 origin、确切 popup source、单一字段和原 operationId 后，以自己 Bearer 查询原操作；仅服务端 nextAction=complete 时提交所见 rowVersion，再获取页面配置。结果页不处理企微 code、换码或登录，不把通知当作授权证据。无 opener 且无有效原关联时仅显示回到原窗口/重新登录提示。

`sessionStorage` 的 `sage.wecom.name-return` 仅保存 operationId、instanceId、受控联系人 returnPath 与 expiresAt（最多原五分钟上下文期限）；没有 token、code、授权 URL、企业身份或姓名。同窗口返回先回到该联系人路径，再调用既有 OIDC 的 `signIn(true,{sameSessionOnly:true})`，显式 PKCE + prompt=none 恢复原 issuer 会话；OIDC state 消费和 returnPath 白名单保持不变。刷新时只有该引用的受控returnPath与当前页面相同才走此分支，不用旧引用把无关页面拉回。恢复后只查原操作，Mud 若因原 sid/当前权限拒绝，页面要求先 Maia 登录再新建姓名上下文，不自动创建新操作。普通创建响应未知只复用原 clientRequestId；原操作已知后只查询。存储不可用时 Web 内存流程仍可工作；同窗口跳转停止并提示允许会话存储，避免丢失关联。

范围/实例/根/用户变化会取消旧姓名请求并清空配置；当前页 loading 先卸载组件，再依据已接受的新页面事实决定能否重签。正常同范围翻页可核对原上下文，配置仍与同页20条/cursor匹配。范围变化清除旧恢复引用；退出及正常组件卸载清理引用，`main` 在pagehide清会话前同步调用 `prepareNameNavigation()`，通过单一无payload姓名生命周期事件标记离页，保留非秘密引用供整页往返（不依赖监听注册顺序）；丢弃 Bearer。401沿既有会话失效；403/404/410仅限制姓名功能，保留联系人同步事实。范围核验预算不足使用 owner 的安全 recovery（缩小页/管理员核对范围/维护者预算调整），不把容量问题当作可重复授权解除的问题。缺 loginSuite 显示配置不可用，不循环授权或改实例归属。

`loadWecomSdk()` 只按官方91958顺序动态加载 jweixin-1.2.0.js 与 jwxwork-1.0.0.js，script保留 referrerpolicy=origin，不打包缓存官方脚本。`bindNames(config,binding)` 的 config 直接使用生成 NameComponentConfig，具名 NameBinding 只提供本页 mount/unmount/signal/安全状态回调；sdk 注入仅测试接缝，不从 runtime 或组件 props 接收外部实现。企微分支 wx.config 成功后 agentConfig；普通Web跳过config。agentConfig后才取 WWOpenData，存在checkSession时等待成功，成功后通过Vue v-if挂载、nextTick取本表元素并显式bind。列表更新先完成卸载再初始化，不让全局SDK自动把旧企业上下文用于新元素。

`WecomName` 只把服务端可信 userId/reference 交给 ww-open-data（type=userName、corpid）；不把open_userid自行兜底，不读取组件内容或事件载荷。姓名元素由Vue卸载，SDK适配器不直接删除Vue管理的节点，以保留重试时的插入锚点。只有这个官方标签被Vue识别为自定义元素。脚本load、config、agentConfig、checkSession、bound、update和失败阶段只产生有限枚举，所有状态的 realNameVerified 恒为false。update/ready/bound不是姓名正确性证明；未知ID可能显示原ID，界面请本人核对。

监听在挂载前安装以覆盖自动bind，off可用才订阅on；error/过期/取消清理自身监听和定时器并请求v-if移除元素，迟到事件不复活内容。单次脚本加载及每次初始化调用最多10秒，短期配置过期即卸载，URL不匹配不绑定。官方wx.ready/error没有解除监听API，config/agentConfig中断或失败后全局身份不确定，本页不再初始化其他范围，提示刷新后重新核对原操作。没有跨页面保留已初始化企业的缓存；不会用SDK失败触发重新安装或修改联系人同步状态。

## SDK资源策略与验证边界

Vite开发/预览响应的CSP保留原有限制，仅追加下列精确公开资源；不新增unsafe-eval、内联脚本或放宽frame-ancestors。部署层也必须使用兼容CSP，多个头/meta取交集，旧的纯self策略会继续阻止组件。

| 指令        | 允许的URL                                                                    | 依据/用途                                         |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| script-src  | `https://res.wx.qq.com/open/js/jweixin-1.2.0.js`                             | 官方91958动态SDK                                  |
| script-src  | `https://open.work.weixin.qq.com/wwopen/js/jwxwork-1.0.0.js`                 | 官方91958动态SDK                                  |
| frame-src   | `https://open.work.weixin.qq.com/wwopen/openData/frame/index`                | 匿名公开SDK的隔离展示/消息iframe                  |
| connect-src | `https://open.work.weixin.qq.com/wwopen/openData/getOpenData`                | 匿名公开SDK中的数据请求路径；未以真实授权请求验证 |
| img-src     | `https://wwcdn.weixin.qq.com/node/wework/images/1x1-00000000.91e42db1c6.png` | 匿名公开SDK中的透明图初始化资源                   |

匿名隔离HTTPS浏览器只加载上述脚本/透明图，确认wx.agentConfig及WWOpenData存在、无请求失败；HTTP探针还观察到frame路径。未保存脚本、未调用授权流程/qyapi、未携现有cookie或企业配置。SDK的aegis遥测地址不在放行集合。授权后新增资源或平台内部通信的实际需求只能在后续真实联调中按证据增量处理，不能据静态探针声明完整SDK网络路径已验证。

[接入原型](../prototypes/wecom-onboarding.html)与[联系人原型](../prototypes/contacts.html)可独立打开，以共享token和样式生成；姓名原型模拟准备、绑定、错误、过期、缺配置与刷新恢复，不呈现真人姓名。联系人表格继续在容器内横向滚动。

[TC-SAGE-003](../test-cases/TC-SAGE-003.md)保护原接入/同步页面；[TC-SAGE-004](../test-cases/TC-SAGE-004.md)连接姓名控制器、实际OIDC库/生成客户端及真实Chrome中的合成SDK/API。`pnpm check:name-browser` 和 `pnpm check:name-recovery-browser`（实际main入口及OIDC库/JWS）禁止真实外部业务请求，截图只含明确合成示例，不读取/截图真人姓名。不证明US-006-AC-14/16通过；Android与普通Web真实姓名、原sid恢复和登录Suite配置由T11在授权隔离环境验收。
