# 登录、会话与个人工作空间

本文维护 Sage 的认证与个人空间。终端功能沿用同一会话，见[终端接入](terminals.md)。密码登录、注册与个人空间创建归 Mud。空间名使用查询返回值，成员角色来自 owner 契约。

## 结构与依赖

- `src/auth/session.ts` 的公开接口 `createSessionController({oidc,api})` 提供 signIn/callback/load/logout/retryLogout/dispose。组件只提交意图、显示状态，不请求服务。
- `src/auth/oidc.ts` 使用 oidc-client-ts 的无 UserStore `OidcClient` 完成授权码 + S256 PKCE。响应只返回 controller 的内存，不使用会保存令牌的 UserManager；API仅接受 access token。
- `src/api/mud.ts` 消费 `maia-mud-client@0.2.0` 生成方法与 Schema。未知响应通过 TypeBox `Check` 校验，不运行 eval/Function，不手写后端 DTO。
- 冻结制品 `vendor/maia-mud-client-0.2.0.tgz` 的 SHA256 为 `3de661e6b5097189c3fa15b85a045e05de23cc538a7f3a1c3f18c4baef2a8bc1`；`pnpm check:client` 核对制品、锁完整性及公开导出。该本地交付不是 registry 发布或生产签名证明。

## 协议及隔离

公开运行配置只允许 issuer/clientId/redirectUri/apiBaseUrl/version 五项；client固定sage，所有URL须为页面同源HTTPS精确入口。缺失或非法配置拒绝业务就绪。每进程从 `SAGE_PUBLIC_CONFIG` 指定文件读取并校验，`/runtime-config.json` 返回 no-store；构建产物不包含部署配置，16443可复用同一dist并使用独立公开文件。私钥/证书路径通过进程参数读取，不进入public或构建。

登录入口显式 `prompt:login`，刷新只做顶层授权恢复且省略prompt。使用scope=openid、随机nonce/state、`sid` essential claim、loadUserInfo:false，无refresh、iframe或silent renew。oidc-client-ts校验原state和nonce；jose通过发现的同源JWKS实际验证RS256签名、iss/aud/exp/sub/sid和原nonce，业务session.user.id必须与已验证sub一致。回调URL捕获后立即replaceState去掉code/query，不记录原URL；换码结果未知不重放code。

access/ID token仅在controller闭包内存。短期state/verifier/nonce只在当前标签页 `sage.oidc.` 前缀sessionStorage，600秒过期，回调成功/失败删除原操作；清理不碰其他前缀。离页立即丢弃内存会话与退出操作，但保留短期PKCE，以支持导航到认证页后返回。再次主动登录先清旧协议状态。OidcClient没有UserStore或令牌缓存，代次过期的底层完成结果不能恢复身份，也不能清除新授权的协议状态。

每次登录/回调/退出/失权推进epoch。查询、回调、登录失败、退出结果均比较epoch后再写页面。已持有凭据的正常、加载、降级及读取错误状态通过canLogout明确保留退出操作；只有清除本机凭据后隐藏退出。401清空资料并引导登录；403/404清空资料并显示无权；503/网络/非法响应显示安全错误和可重试；仅成员失败保留已验证空间资料并显式降级，缺数据不显示零成员。关联编号只显示owner错误Schema中的requestId，不呈现异常全文或内部code。

退出立即清access和私有资料，原ID token仅保留在当前内存退出操作，与随机requestId固定。未知结果显示“本机已退出，会话撤销待核实”，600秒内只重试原输入。退出请求10秒超时并传递AbortSignal，中断网络后进入待核实；controller本身以有界race覆盖不响应abort的传输。中断不能证明服务端未执行，因此保留原hint/requestId，不新建撤销操作。pending页可重新登录，主动登录/回调/离页会中断原请求，旧结果通过epoch丢弃。新登录、回调或离页丢弃原操作；晚到结果不能影响新会话。端点cookie行为由Mud负责。

## 视觉及可访问性

颜色由共享样式 token 定义。标题使用本机宋体，正文使用本机中文无衬线。空间标题是主要识别点，与成员表左对齐。顶部保留品牌和退出，登录后导航提供个人工作空间与终端入口。

自检：初稿原本可用多张统计卡，但本片只有本人及成员事实，已改为单一标题区域和表格。层级用于解释空间与成员，不增加虚构统计。颜色、字级、间距、圆角、边框和焦点等集中于 `src/styles/tokens.css`。布局在40rem切换，小屏账号和长空间名换行。语义标题、table/th、状态区、跳转链接、可见焦点及原生按钮保持键盘路径；无自动动画。空列表说明暂未读取并提供核对操作，不把失败伪装为空。

原型通过 `pnpm prototype` 把同一tokens和布局CSS嵌入 `docs/prototypes/personal-workspace.html`，可直接打开，含九种可切换状态。`pnpm check:prototype` 防止源样式与单文件分叉。原型只使用示例账号，不调用真实接口。

## 验证边界

TC-SAGE-001关联controller竞态、真实库/JWS、运行配置、owner契约测试及真实Chrome脚本。`pnpm check:browser` 会在指定本地应用注册自己的新账号，走真实Mud主路径、刷新恢复、退出撤销及同根重登；不重置数据库。UI空/加载/503/403等使用显式浏览器route故障注入，仅证明呈现与恢复，不能作为真实服务故障或授权验收。脚本不保存trace/HAR/token/密码，只输出状态摘要和安全UI截图。

本地HTTPS代理保留原Host并发送X-Forwarded-Proto:https和X-Forwarded-Host。认证文档的Referrer-Policy必须允许同源表单提交可信Origin，否则Chrome导航POST可能产生Origin:null而被Mud拒绝；不放宽Origin校验。共享Test/生产发布、真实终端隔离及完整US-001验收不属于本片完成声明。
