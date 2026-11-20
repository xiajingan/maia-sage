---
id: TC-SAGE-004
title: 官方姓名组件、页面授权与原 Maia 会话恢复
priority: P1
story: US-006
---

# TC-SAGE-004 官方姓名组件、页面授权与原 Maia 会话恢复

## 来源

[US-006](../../../docs/product/stories/US-006-从企业微信同步内部联系人.md) AC-14～17：官方组件展示、组件失败独立于同步、普通浏览器页面授权保留 Maia 身份/权限、错误企业不改实例归属。AC-14/16 的真人姓名正确性需真实参与者确认，本用例合成验证不代替该验收。

已绑定用户的 PC 页合成验证还覆盖连续两次自动续签、新签名请求晚于旧签名期限、权限拒绝、浏览器会话失效与换页取消。通过同一文档的两名合成成员、重新执行的 SDK 步骤和过期时移除的节点判断结果。

## 前置条件

- 已有 Maia 个人空间及当前实例访问权限，联系人列表有可信同步记录。
- 公开姓名开关开启；测试夹具所有企业/成员/授权响应均为合成数据。
- 验证同窗口恢复时保留非秘密原操作关联，实际issuer和sid核对分别由OIDC/Mud负责。

## 步骤与预期结果

1. 普通浏览器点击姓名授权，完成合成窗口返回：原窗口保留自己的会话，仅正确来源/同源/原操作通知可触发查询与完成。结果页清除query/hash，消息只有operationId。HTTPS合成create响应设置HttpOnly/Secure/Lax的__Host Cookie，后续query/complete/config由浏览器自动携带，测试不从JS读取其值。
2. 阻止弹窗、返回错误企业或缺登录授权配置：分别显示显式打开入口、核对企业/新上下文入口或配置提示；不循环授权、不切换实例、不改变同步成功。关闭过授权窗口后，显式打开会复用原操作并跟踪新窗口；旧窗口通知被拒绝，新窗口仍须通过origin和原operationId核对。
3. 企微整页返回：仅受控联系人路径和原操作可恢复，OIDC显式prompt=none和S256 PKCE。无原issuer会话或原操作被sid/权限拒绝时，要求先Maia登录再新建上下文，不能用企微code登录Maia。
4. 加载官方组件：企微先config再agentConfig；Web跳过config。checkSession成功后才创建官方元素，并在挂载后bind。ready/update/bound只表示阶段，不能宣称真人显示成功。
5. 短token恢复阶段保留只读资料与既有原操作引用至pagehide，同时暂停姓名查询链；迟到查询不得更新版本或继续complete/config。以真实session与姓名controller、生成API组合并控制时间，GET或complete成功应答时跨到期/进入5秒提前窗，随后complete/config零发送、只恢复一次，保留原操作及已接受rowVersion。已发complete返回到期401同样不重发、保留旧引用供核对；恢复原操作的GET在途到期401也不能提前消费唯一已知引用；恢复后查询原操作，不自动再次提交旧rowVersion。pagehide沿导航准备保留原引用，退出/换账号/恢复失败立即清理。超时、错误、过期、URL或范围变化、退出/切实例：组件卸载，监听与旧请求隔离；晚ready/error/update不能复活旧元素。全局初始化中断后必须刷新再核对，不继续初始化新范围。
6. 姓名 create 先发生网络/503未知结果，再核对原key时跨到期401或在dispatch前恢复：真实session/namecontroller组合模拟pagehide与新controller，恢复零POST，显式核对才复用原key/environment；首次POST前存储失败零发送。pending绑定实际userId及稳定选择，固定五分钟UI期限不滚动。损坏/到期/账号/实例/范围不匹配保留并阻断；显式放弃只清本地无HTTP，再新建需另一次点击。退出/换账号清理；原始sid/token不得持久化。真实Chrome main/Vue合成场景验证pending按钮、认证导航及同key核对。
7. 重试原姓名授权：先重查当前上下文/范围再取同页20条配置，Vue元素可重新挂载；容量受限显示安全恢复指导，原Maia会话与联系人同步摘要保留。
7. 在桌面/移动布局以及独立浏览器中查看：无整页横向溢出、未知/空/受限有下一步；第二浏览器不能凭operationId取得原Bearer或原窗口source。

PC 合成绑定场景：真实 Vue 页面和客户端从联系人响应读取当前用户的安装绑定，成功时由隔离的模拟 SDK 依次完成 agentConfig、checkSession 和两名合成联系人的姓名渲染；缺少会话检查、会话过期或企业不匹配时挂载数为零。默认签名被拒绝时保留显式恢复；同一标签页的原授权操作按原会话核对。自动路径不创建扫码操作。

## 测试代码

- `tests/name-context.test.ts`：popup_source_and_origin、原关联、失权/迟到响应、分页/预算与同窗口恢复拒绝。
- `tests/wecom-name.test.ts`：sdk_ready_is_not_real_name、component_expired_or_wrong_corp、Web/企微时序与卸载/超时/事件隔离。
- `tests/oidc.test.ts`：same_window_prompt_none 及原state、nonce、returnPath、晚回调隔离。
- `tests/session.test.ts`：显式恢复选项传递与失败后无可用会话。
- `scripts/check-name-recovery-browser.mjs`：实际main入口、OIDC库/PKCE/JWS、同窗口返回与reload、合成Mud的sid拒绝及issuer login_required；只查原操作且不持久Bearer。
- `scripts/check-name-browser.mjs`、`tests/fixtures/name-browser.ts`：真实Chrome/实际Vue与生成客户端，合成API/SDK、CSP、主路径与上述交互状态；截图仅合成数据。

## 执行

`pnpm exec vitest run tests/name-context.test.ts tests/wecom-name.test.ts tests/oidc.test.ts tests/session.test.ts`，`pnpm check:name-browser`、`pnpm check:name-recovery-browser`。前置静态/类型/生成客户端/构建/原型检查沿本工程package.json。

## 跨工程验证回指

本用例的跨工程组合验证见[TC-014](../../../docs/test-cases/TC-014.md)、[TC-017](../../../docs/test-cases/TC-017.md)、[TC-018](../../../docs/test-cases/TC-018.md)。具体执行结果及真实平台证据由总仓对应用例与迭代报告维护；此处回指不表示真实平台验收已通过。
