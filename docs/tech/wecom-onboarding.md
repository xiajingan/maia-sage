# 企微接入与内部联系人

本文维护 Sage 的安装与联系人页面。授权、实例绑定、范围交集与同步事实由 Mud 提供；跨工程设计见[管理端契约](../../../docs/architecture/management-ui-contracts.md)。官方姓名组件使用 Mud 的临时页面配置，页面不把成员标识作为姓名。

## 已绑定身份的 PC 姓名展示

实例列表和联系人页通过请求头 `X-Maia-Wecom-Binding: 1` 读取服务端 `currentUserWecomBound`。当前 Maia 用户重新登录后，以本次认证响应为准。字段缺失时沿用既有表现；联系人和授权可见名单不能用于推测本人身份。

已绑定用户在普通浏览器进入有效且有联系人的实例页，Sage 默认请求固定联系人页的 `getBoundNameComponentConfig`，使用服务端返回的企业、应用及允许展示的引用。官方 `agentConfig` 和 `WWOpenData.checkSession` 依次成功后才挂载姓名组件。浏览器会话核验失败时说明原因并保留联系人和同步状态。普通网页登录须由本人显式发起。退出、分页、切换范围或当前读取失去权限会清理旧配置与元素。

已绑定用户的 PC 组件成功挂载后，页面在当前配置到期前向 Mud 重新核对本页范围并申请新签名。每份新配置均重新核验官方浏览器会话。若应答晚于上一份配置的到期时间，页面先收起姓名，待新配置核验成功后恢复。权限拒绝或浏览器会话失效会停止自动续签。

已绑定用户在当前联系人页成功展示姓名后，若自动续签应答通过实例、页面与有效期核对，且返回不同的范围版本，立即收起旧列表，丢弃旧游标并重新读取第一页。重读仍返回已失效的范围版本时保留刷新入口，等待最新范围。首签范围不符、显式授权失败或官方浏览器会话失效只收起姓名组件。

## 页面与客户端

入口位于当前个人工作空间的「企业微信接入」。安装控制器为 `createWecomPage({api,session})`，联系人控制器为 `createContactPage({api,session})`，均通过同一个 [Mud API adapter](../../src/api/mud.ts) 调用生成方法、校验生成 Schema。DTO 取自 Mud 发布的 `maia-mud-client@0.7.0`，摘要和升级方式见[认证依赖](authentication.md#结构与依赖)。

| 页面       | 固定路径                                                              |
| ---------- | --------------------------------------------------------------------- |
| 接入入口   | `/workspaces/:workspaceId/wecom`                                      |
| 原安装结果 | `/workspaces/:workspaceId/wecom/install-operations/:operationId`      |
| 实例联系人 | `/workspaces/:workspaceId/channel-app-instances/:instanceId/contacts` |

联系人页面的 `pageKey` 为 `instance_contacts`，URL 不携 query/hash，分页 cursor 留在页面内存；跳转主要内容只移动焦点，返回历史或 hash 变化也会清理联系人 URL 的附加部分。实际请求限定 instanceId。根、User、manager 资格来自既有 SessionView，不新增浏览器权限状态。当前 Session 契约只有个人空间 manager，不虚构其他角色数据。

## 接入与原操作恢复

管理者选择成员扫码或管理员入口，服务端返回原 operationId、nextAction、rowVersion 及当前 launch。页面按 launch.kind 呈现当前步骤；管理员接入若要求独立身份核验且 launch.kind 为 member，显示「核验管理员身份」，不改称成员安装。

原 admin 安装入口由用户在新窗口打开，保留原 Maia 会话；member 管理员核验同时提供下述手机传递入口。回到原窗口后查询原操作，只有服务端 nextAction 为 complete 时允许提交所见 rowVersion。窗口不开启自动重试、循环授权或原始 code 传递。页面不读取返回页 code，也不通过 postMessage 接收凭据。结果未知时保留原操作并先查询，完成请求未知后在取得新查询结果前关闭完成按钮。

管理员首装遇到可核验的关注通知尚未处理完，服务端返回原操作的 `awaiting_verification`、`authorization_invalidation_pending` 和 `nextAction=complete`。刷新和查询仍读取同一 operationId，用户可在原期限内显式提交最新 rowVersion。若再次核对返回 `operation_authorization_invalidated`，原页显示接入受限，完成入口随服务端动作关闭。这里沿用原结果页及原 API，刷新只发起查询，恢复仍取决于独立的已保存结果资格。

create 尚未返回 operationId 时，页面保留原 clientRequestId 和 mode，由用户明确「核对原发起请求」重复同内容的幂等请求，不生成新 key。已取得 operationId 后只查询原 ID，不重放一次性邀请。已读取的原操作只有服务端允许 start_new 后才可由用户明确重新发起；正常列表对已确认不可读的普通恢复引用另按下述边界处理。

sessionStorage 的 `sage.wecom.install` 既有安装分支保存 workspaceId、operationId、kind、非秘密布尔 mustQuery，或尚无结果的原幂等输入；恢复字段见下节。它不存 Bearer、code、launch URL、成员资料或权限。恢复引用只用来查询，归属与 sid 仍由服务端校验。存储不可用时，当前内存查询与已知稳定 operationId 查询仍可使用；complete 必须先成功持久化 mustQuery=true 才能发送，保存失败则停止提交，避免遗留的 false 标记掩盖未知结果。短token恢复在dispatch前挡住complete时，不写已发送标记。成功查询/完成只依据服务端 nextAction 更新标记，query_original 仍保持待核对；缺少该字段的旧格式引用保守视为待核对，须先成功读取才能解除。

正常接入列表仅自动恢复本Workspace的已知operationId。只有保存的mustQuery明确为false、没有未知create输入，且该自动查询返回404时，页面才继续查询当前Workspace实例列表；列表成功后移除这一不可读引用，显示当前列表，由管理者显式开始新的操作。没有自动create、complete或邀请重放。403、显式旧操作深链接/主动查询的404、列表权限拒绝仍显示拒绝；列表503/网络错误保留原引用并阻止新建。读取成功的新事实会取消之前的“旧引用不可读”判断，迟到列表不得清掉后来核对成功的操作。

从旧深链接返回同一Workspace的正常列表时，组件重新进入已有resume/list流程，取消旧请求并核对当前列表权限；不因复用组件而永久保留旧拒绝，也不把旧拒绝当作当前可创建的证明。未知create的原key和complete待核对operationId在资源拒绝及返回列表时继续保留，不通过更换key或清引用绕过核对。旧格式引用无法证明历史上没有unknown，因此旧sid404仍拒绝；这项兼容限制不推断业务已失败或已完成。

认证往返的业务返回路径绑定在既有 OIDC state.data 中。保存、callback读取和主入口导航沿[认证返回白名单](authentication.md#协议及隔离)校验当前稳定入口，必须同源且没有query/hash，ID按生成Schema验证正十进制BIGINT上界。OidcClient 消费协议 state 后删除记录；身份签名、nonce、generation 与会话 epoch/读取成功条件都成立后，controller.callback 才释放可选 returnPath。它只表示导航意图，不授予读取权限；姓名授权返回另用显式同会话恢复选项，见[姓名展示](#姓名组件与页面授权)。

安装完成仅表示可信绑定或恢复完成。实例卡片分别展示安装、联系人同步、会话存档、终端条件、范围核对和最近可信时间；没有可执行 Account 时不显示 Tea/Celt 就绪。部分同步与范围待核对不会被安装完成覆盖。

## 已保存结果的管理员身份恢复

原管理员安装结果页进入 expired 时，通过 `getWecomInstallRecoverySource` 读取当前来源资格。只有服务端允许 recover 才显示「使用已保存结果重新核验管理员身份」，说明只核验、不会重新安装。发现已存在当前轮时直接呈现该轮；关联只用于查询，不提供权限。新一轮必须显式点击 `recover()`，以 source view 的 sourceOperationId/rowVersion 和新 clientRequestId 调用 `createWecomInstallRecovery`。恢复轮再次过期时仍指向最初 source，使用恢复 view 的 sourceRowVersion 与新的 key；不调用旧 createWecomInstallOperation 或申请安装入口。

恢复结果继续使用原稳定 operation 路由，App 入口清除该页 query/hash。已知 kind=recovery 的 query/complete 分别调用 `getWecomInstallRecovery`、`completeWecomInstallRecovery`；无存储或旧格式 kind 缺失时先恢复 GET，只有 Schema 合法的 404 NOT_FOUND 才回退旧 GET。其他拒绝、503、网络或非法响应均不降级。每次实际 HTTP dispatch 重新进入 session.withAccess，包括旧 GET 回退、source 发现及冲突后的当前轮查询；短 token 到期时结束原链，不拿旧闭包 token 继续请求。

创建响应丢失后保留原 sourceId、rowVersion/key。刷新旧恢复轮路由或返回接入列表时，若仍有 recoveryPending，先只按其原 source/key 查询；查到则显示该请求创建的轮，未查到则保留原意图，普通 query 不 POST。只有当前 pending 的 POST 成功结果或精确 source/key 查询结果可以结清意图并关联已创建 key；普通旧轮 GET 不能把新 key 记给旧轮。用户明确「核对原核验请求」时仍先查原 key，未查到才以同 key、同 body 重试，不自动换 key。不同 key 的 409 会终止该意图并删除冲突 key，再不带 key 查询当前轮，不记成当前轮别名；该轮过期也不会自动重发冲突 key。只有下次显式点击才有新 key。完成未知仍先查原新 operationId，不重发 complete。服务端返回 query_original 时关闭 OAuth/完成/恢复动作；没有自动轮询或清理循环。

恢复 member launch 及旧管理员独立 member 核验态提供「复制管理员身份核验链接」，复制服务端的同一 HTTPS URL，不另建 state 或请求 API。页面说明保留电脑页面及 Maia 登录，把链接交给本次企业管理员在手机企微内打开，无需在手机登录 Maia，完成后回电脑查询。企微内直接打开链接和旧 admin 链接保留。复制失败只在当前页面展示可选择的只读链接与反馈，不引入二维码或 Web provider login。

恢复存储沿用 `sage.wecom.install`：仅增加 kind、sourceId/sourceRowVersion、已确认创建的 clientRequestId，或 recoveryPending 的 sourceId、原 rowVersion/key。launch URL、code/state/token 不进入浏览器存储、日志或报告。查询、失权、根/User/会话变化、操作切换及本轮 expiresAt 到期会清掉手工链接/复制反馈；迟到的 clipboard 结果只有当前操作、当前会话仍允许同一 launch 时才可显示。到期后提示查询原操作，是否能新建一轮仍由服务端判断。源结果超过24小时或不可用时展示「已保存结果已不可核验，请重新取得可信授权」，不显示恢复按钮、不自动安装；旧新授权入口仍需另一次显式操作。

## 联系人、同步与清理

每页读取 20 条并沿服务端 cursor 翻页。从实例进入后保留实例抬头和返回入口。常规列表仅显示头像、姓名、职位。当前已获准的同源 HTTPS 头像可显示，外部 URL 或缺少头像使用占位。默认收起的「维护与同步」区提供授权范围、可信时间和同步操作。当前无法访问或需要恢复姓名时，主区域提供相应提示与可用操作。范围待核对的空结果仍和成功同步后的空列表区分。

当前实例可访问且会话为 manager 时允许补同步。范围待核对时，若页面提示 Provider 响应校验失败且最近一次同步因同一原因失败，manager 仍可显式补同步；联系人资料保持隐藏，授权撤销或实例停用时不提供该入口。同步请求未知保留同 clientRequestId，由用户核对原请求；已经有 syncId 时可查询原同步。正常页面不轮询，不自动新建 job。

联系人读取和同步读取共享已接受事实的代次。每次接收页面或同步事实后，先前基于旧事实发出的查询不能再覆盖范围、同步摘要或安全提示；即使 scopeVersion 相同，旧 syncId/rowVersion 的应答也会被丢弃。只有请求所依赖的事实仍是当前代次时，同步应答才可更新摘要；若其范围与现页不一致，则清空该页和 cursor，让用户重新核对，不把「范围不相等」解释成业务版本前进，也不按 ID 大小判断新旧。加载标记在原请求结束或清理后正常释放。

未知补同步的幂等输入还固定其原事实代次。后来取得新页面事实后，用户仍可用原 key 核对；成功只确认原请求并解除未知标记，不用原请求的旧同步摘要覆盖新页面；本次重核若收到当前权限拒绝，仍按当前请求的代次执行资料清理，不因原输入较旧而忽略拒绝。

正常、空、加载、请求错误、受限/部分覆盖及无权都有明确页面。联系人读取失败时移除旧资料，保留安全恢复提示；已知同步摘要可独立呈现。实例列表刷新失败可以保留上次实例状态并注明来源。资源级403/404清空资料并锁定对应feature；普通安装恢复引用按上文区分自动列表与显式操作，未知输入/待核对引用不会被拒绝处理清空。保留Maia会话；401 沿既有认证门禁，当前请求实际到期时仅恢复并结束旧调用，否则会话失效。退出、会话/根切换、实例切换或卸载时取消请求、清空局部资料；请求还检查当前 Session 引用、epoch、signal 及页面读取代次，迟到旧结果/拒绝不能恢复资料或清除后来会话。既有终端包装保留原 403 会话处理兼容行为。

已接入实例时以实例和原操作入口为主。普通列表仅在完整读取并确认当前空间没有实例时提供成员或管理员接入。若完整列表只有已停用实例，管理员可在原过期的安装操作上按服务端的重新发起指引继续。只有确认保存结果已不能恢复，显式点击「准备重新发起」，并重新读取实例列表后，才显示发起入口。新操作沿原结果页查询和授权，原实例由 Mud 核对归属。存在仍有效、受限或待核对的实例，或列表不完整、请求失败、原结果待核实时，保留原操作核对路径。

## 姓名组件与页面授权

公开开关 `wecomNamesEnabled` 默认为 false，开启后在原联系人页提供姓名授权/原操作核对。`createNameContextController({api,session})` 管理单页操作、短期配置与清理；沿 `session.withAccess` 使用原内存 Bearer。生成客户端的 createNameContext/getNameContext/completeNameContext/getNameComponentConfig 与生成 Schema 是唯一 HTTP 类型来源。姓名配置请求固定 pageKey=instance_contacts、limit=20 与联系人当前 cursor，不提交成员 ID、sid、任意签名 URL 或浏览器关联值。Cookie 仍由 Mud 的 HttpOnly/Secure/Lax 配置管理，Sage 不读写它。四个name方法均显式使用credentials=same-origin；HTTPS合成Chrome已验证create的Set-Cookie在后续query/complete/config请求中自动携带，实际Mud的设置/拒绝仍由T9验证。

普通 Web 仅接受官方98171的 `https://login.work.weixin.qq.com/wwlogin/sso/login`；member仅接受91120的 `https://open.weixin.qq.com/connect/oauth2/authorize`，不自行构造授权参数。普通 Web 点击动作同步打开空白新窗口，收到原操作授权入口后才导航。被阻止时给「打开姓名授权」，不会自动再次弹窗；授权窗口已关闭时，显式点击只尝试打开一个新窗口，保留原操作并替换接收通知所核对的popup source。原窗口保留 Bearer；`/wecom/name-context-result?operationId=...` 先删除 query/hash，只发送 `{operationId}` 到同源 opener。原窗口核对 origin、确切 popup source、单一字段和原 operationId 后，以自己 Bearer 查询原操作；仅服务端 nextAction=complete 时提交所见 rowVersion，再获取页面配置。GET、complete、config 分别经过 session.withAccess；任何一步等待期间进入到期提前窗，下一次 dispatch 触发恢复并结束原链。已发送 complete 返回到期401时保留原 operationId/rowVersion 和非秘密恢复引用，不能认定副作用未执行；恢复后先查询原操作，禁止自动再次提交旧版本命令。结果页不处理企微 code、换码或登录，不把通知当作授权证据。无 opener 且无有效原关联时仅显示回到原窗口/重新登录提示。

`sessionStorage` 的 `sage.wecom.name-return` 已知操作分支保存 operationId、instanceId、受控联系人 returnPath 与 expiresAt（最多原五分钟上下文期限）。尚未取得 operationId 的 pending-create 分支只保存原 clientRequestId、environment、真实 Maia userId、workspaceId、instanceId、scopeVersion、returnPath 与首次发送前固定的五分钟 UI 期限；没有 token、原始 sid、code、授权 URL、企业身份或姓名。同窗口返回先回到该联系人路径，再调用既有 OIDC 的 `signIn(true,{sameSessionOnly:true})`，显式 PKCE + prompt=none 恢复原 issuer 会话；OIDC state 消费和 returnPath 白名单保持不变。刷新时只有该引用的受控returnPath与当前页面相同才走此分支，不用旧引用把无关页面拉回。恢复后只查原操作，Mud 若因原 sid/当前权限拒绝，页面要求先 Maia 登录再新建姓名上下文，不自动创建新操作。首次 create 的实际 dispatch 前必须保存 pending-create，保存失败不发送；未知响应、到期401和认证离页保留原 key 与 environment。恢复只核对当前真实用户、Workspace、实例、范围及稳定路径后显示待核对状态，不自动POST；用户显式“核对原姓名发起请求”才以原 key/environment核对，取得 operationId 后替换为已知操作引用。字段是导航关联，不提供授权；Mud 同用户/实例/key 查询不以 sid 新建命名空间，旧 sid 操作仍由服务端拒绝。损坏、过期或不匹配的 pending 引用保留并阻止核对及新建；五分钟只是保守UI期限，不说明旧副作用未发生。“放弃本次姓名核验”仅清本地引用/状态，不请求服务、不撤销上游历史，随后新建仍需用户另一次显式操作。退出、换账号及恢复失败沿原清理；普通离页/切实例不静默丢弃未知 key。

范围/实例/根/用户变化会取消旧姓名请求并清空配置；当前页 loading 先卸载组件，再依据已接受的新页面事实决定能否重签。正常同范围翻页可核对原上下文，配置仍与同页20条/cursor匹配。范围变化清除旧恢复引用；退出及正常组件卸载清理引用，`main` 在pagehide清会话前同步调用 `prepareNameNavigation()`，通过单一无payload姓名生命周期事件标记离页，保留非秘密引用供整页往返（不依赖监听注册顺序）；丢弃 Bearer。401沿既有认证门禁（当前请求实际到期仅恢复、不重发）；403/404/410仅限制姓名功能，保留联系人同步事实。范围核验预算不足使用 owner 的安全 recovery（缩小页/管理员核对范围/维护者预算调整），不把容量问题当作可重复授权解除的问题。缺 loginSuite 显示配置不可用，不循环授权或改实例归属。

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
