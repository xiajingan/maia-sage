# 登录、会话与个人工作空间

本文维护 Sage 的认证与个人空间。终端及企微功能沿用同一会话，见[终端接入](terminals.md)和[企微接入](wecom-onboarding.md)。密码登录、注册与个人空间创建归 Mud。空间名使用查询返回值，成员角色来自 owner 契约。

## 结构与依赖

- `src/auth/session.ts` 的公开接口 `createSessionController({oidc,api,now?})` 提供 signIn/callback/load/logout/retryLogout/dispose 及带 epoch/signal 校验的 withAccess。组件只提交意图、显示状态，不请求服务。
- `src/auth/oidc.ts` 使用 oidc-client-ts 的无 UserStore `OidcClient` 完成授权码 + S256 PKCE。响应只返回 controller 的内存，不使用会保存令牌的 UserManager；API仅接受 access token。
- `src/api/mud.ts` 消费 `maia-mud-client@0.6.0` 生成方法与 Schema。未知响应通过 TypeBox `Check` 校验，不运行 eval/Function，不手写后端 DTO。恢复 source/recovery 与旧安装分别使用所属 Schema，非法恢复响应不按旧类型解释。
- 当前制品 `vendor/maia-mud-client-0.6.0.tgz` 为 Mud 原包（34938 bytes），SHA256 为 `ac92f682e0d37c5c63d62c50169142c2d0473f9c11df153614829e8602878a51`，SHA512 为 `eba6fa69114e6f9b3dc90c00b101aa253f3ff1f35350fadf66e9f96af72e721fecb22b81af4729526a7968c55de27e427d98a91e732813a70916ad77d93ec004`。`pnpm check:client` 核对两包摘要、0.6.0 的 SHA512 锁完整性及 SDK/Schema 公开导出。只升级 Mud client。
- 冻结制品 `vendor/maia-mud-client-0.5.0.tgz` 的 SHA256 为 `53c119750398d610c92a6d4df2c6a6bfbde009a7216fa6a6b22dcd9b2e46500f`；`pnpm check:client` 核对制品、锁完整性及公开导出。该本地交付不是 registry 发布或生产签名证明。

## 协议及隔离

公开运行配置允许 issuer/clientId/redirectUri/apiBaseUrl/version 及可选布尔值 wecomNamesEnabled（省略为 false）；client固定sage，所有URL须为页面同源HTTPS精确入口。缺失或非法配置拒绝业务就绪。每进程从 `SAGE_PUBLIC_CONFIG` 指定文件读取并校验，`/runtime-config.json` 返回 no-store；构建产物不包含部署配置，16443可复用同一dist并使用独立公开文件。私钥/证书路径通过进程参数读取，不进入public或构建。

登录入口显式 `prompt:login`；普通启动、刷新、重新打开及姓名页面往返均调用既有 `signIn(true, {sameSessionOnly:true})`，只尝试一次顶层 `prompt:none` 恢复，仍使用授权码 + S256 PKCE。没有原 issuer 会话时显示登录入口，callback 分支不会再次进入启动恢复。OIDC 发现/换码请求使用库的10秒超时，不无限等待或重放code。实际 sid 是否仍为原操作会话由 Mud 每次查询/完成核对，Sage 不自报 sid。使用scope=openid、随机nonce/state、`sid` essential claim、loadUserInfo:false，无refresh token、认证iframe或silent renew。oidc-client-ts校验原state和nonce；jose通过发现的同源JWKS实际验证RS256签名、iss/aud/exp/sub/sid和原nonce，业务session.user.id必须与已验证sub一致。回调URL捕获后立即replaceState去掉code/query，不记录原URL；换码结果未知不重放code。

access/ID token及 `Credentials.expiresAt` 仅在controller闭包内存。`expiresAt` 为实际 token 响应经 OidcClient 换算的 Unix 毫秒，必须为有效安全整数且在当前时间5秒之后；缺失、非法或回调期间已过期的凭据直接停止，不触发回调→授权循环。正常已登录请求在剩余5秒内或到期后，先协调一次现有顶层恢复，原业务 callback 不发送；`location.assign` 返回也不会继续执行原动作。每次实际 HTTP dispatch（包括姓名查询后的 complete/config）都重新检查到期、epoch 与 signal。当前未取消请求返回401时，只有该次真实 expiresAt 已到才协调一次恢复并结束旧调用；未过期401（包括剩余1～5秒）、资源403/404、网络/DB错误不通过重认证掩盖。session/members 的正常读取沿同一规则，callback读取始终停止而不循环授权。已发送请求不通用重发，安装的未知结果仍沿原clientRequestId、operationId与rowVersion核对。24小时绝对边界由Mud执行，Sage不延长短token或自行判断sid等价。

短期state/verifier/nonce只在当前标签页 `sage.oidc.` 前缀sessionStorage，600秒过期，回调成功/失败删除原操作；清理不碰其他前缀。离页立即丢弃内存会话与退出操作，但保留短期PKCE，以支持导航到认证页后返回。再次主动登录先清旧协议状态。OidcClient没有UserStore或令牌缓存，代次过期的底层完成结果不能恢复身份，也不能清除新授权的协议状态。

认证返回路径只允许 `/`、`/terminals`、`/workspaces/{id}/wecom`、安装操作稳定页与实例联系人页，ID经生成Schema校验；拒绝外源、query、hash与任意路径。路径在首次异步等待及同步session watcher改变路由前捕获，随本次 OIDC state.data 保存并消费；不保存敏感表单或终端激活码。企微严格路径与时序边界见[企微接入恢复](wecom-onboarding.md#接入与原操作恢复)。callback 仅在当前 epoch 且工作空间读取成功后返回可选导航路径，主入口再次校验后导航。

每次登录/回调/退出/失权推进epoch。正常恢复开始时phase为authenticating，load/withAccess禁止新业务；原只读session/members暂留至pagehide，以让既有姓名导航准备保留非秘密原操作或 pending-create 的原幂等 key。姓名controller同时同步suspend，令已在途query/complete/config链的epoch与signal失效，不能拿闭包中的旧token继续下一项动作。pagehide仍按prepareNameNavigation→dispose清内存；恢复失败、显式换账号及退出立即清资料/原引用。

origin级localStorage只额外保存固定布尔意图 `sage.auth.recovery-blocked=true`，不含账号、sid、令牌或路径，不是认证/权限事实。主动退出在撤销发送前置位，整体失权/失败恢复同样置位，避免注销未知后刷新/新标签页复活；资源级拒绝不置位。显式密码登录清除意图；正常到期不置位。storage不可用时停止自动恢复，但不阻止显式登录或实际撤销。迟到失败必须先通过epoch校验，不得重新污染新登录已清除的标记；跨标签标记不会自动删除其他页面的内存会话。

查询、回调、登录失败、退出结果均比较epoch后再写页面。已持有凭据的正常、加载、降级及读取错误状态通过canLogout明确保留退出操作；只有清除本机凭据后隐藏退出。会话/成员读取的未到期401清空资料并引导登录，403/404清空资料并显示无权；企微资源级拒绝的隔离行为见[企微接入](wecom-onboarding.md#联系人同步与清理)；503/网络/非法响应显示安全错误和可重试；session/member读取沿已有API传输期限在10秒后取消，超时归读取错误而非401；仅成员失败保留已验证空间资料并显式降级，缺数据不显示零成员。关联编号只显示owner错误Schema中的requestId，不呈现异常全文或内部code。

退出也清理非秘密姓名恢复引用；退出立即清access和私有资料，原ID token仅保留在当前内存退出操作，与随机requestId固定。未知结果显示“本机已退出，会话撤销待核实”，600秒内只重试原输入。退出请求10秒超时并传递AbortSignal，中断网络后进入待核实；controller本身以有界race覆盖不响应abort的传输。中断不能证明服务端未执行，因此保留原hint/requestId，不新建撤销操作。pending页可重新登录，主动登录/回调/离页会中断原请求，旧结果通过epoch丢弃。新登录、回调或离页丢弃原操作；晚到结果不能影响新会话。端点cookie行为由Mud负责。

## 视觉及可访问性

颜色由共享样式 token 定义。标题使用本机宋体，正文使用本机中文无衬线。空间标题是主要识别点，与成员表左对齐。顶部保留品牌和退出，登录后导航提供个人工作空间、终端与企业微信接入入口。

自检：初稿原本可用多张统计卡，但本片只有本人及成员事实，已改为单一标题区域和表格。层级用于解释空间与成员，不增加虚构统计。颜色、字级、间距、圆角、边框和焦点等集中于 `src/styles/tokens.css`。布局在40rem切换，小屏账号和长空间名换行。语义标题、table/th、状态区、跳转链接、可见焦点及原生按钮保持键盘路径；无自动动画。空列表说明暂未读取并提供核对操作，不把失败伪装为空。

原型通过 `pnpm prototype` 把同一tokens和布局CSS嵌入 `docs/prototypes/personal-workspace.html`，可直接打开，含九种可切换状态。`pnpm check:prototype` 防止源样式与单文件分叉。原型只使用示例账号，不调用真实接口。

## 验证边界

TC-SAGE-001关联controller竞态、真实库/JWS、运行配置、owner契约测试及真实Chrome脚本。`pnpm check:browser` 会在指定本地应用注册自己的新账号，走真实Mud主路径、无cookie启动一次停止、刷新/新标签稳定页prompt=none恢复、退出撤销及同根重登；不重置数据库。短expires_in元数据、UI空/加载/503/403和退出未知等使用显式浏览器route故障注入，仅证明呈现与恢复，不能作为真实服务故障或授权验收；真实300秒旧Bearer拒绝、24小时边界及同sid/Grant完整组合由总仓后续验证。脚本不保存trace/HAR/token/密码，只输出状态摘要和安全UI截图。

本地HTTPS代理保留原Host并发送X-Forwarded-Proto:https和X-Forwarded-Host。认证文档的Referrer-Policy必须允许同源表单提交可信Origin，否则Chrome导航POST可能产生Origin:null而被Mud拒绝；不放宽Origin校验。共享Test/生产发布、真实终端隔离及完整US-001验收不属于本片完成声明。

姓名授权的同窗口恢复、无 code 结果处理与普通浏览器弹窗边界见[姓名展示](wecom-onboarding.md#姓名组件与页面授权)。这条能力不把企微身份转换为 Maia 凭据。
