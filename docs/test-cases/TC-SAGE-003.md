---
id: TC-SAGE-003
title: 企微稳定接入结果、联系人覆盖与权限清理
priority: P1
story: US-038, US-006
---

# TC-SAGE-003 企微稳定接入结果、联系人覆盖与权限清理

## 来源

US-038 AC-01、03、04、05、08、09、10、11、12、13 的 Sage 接入/未知恢复/分列状态行为；US-006 AC-01、02、04、09、11、12、13 的列表、同步及失权行为。官方姓名显示的 AC-14～17 由后续姓名组件与真实平台用例承接，本用例只验证接点与降级文案。

## 前置条件

用户拥有经现有认证控制器核实的个人 Workspace。测试通过真实生成客户端注入明确的合成 API 响应；Chrome 使用真实 Vue DOM，不包含真实企业资料或姓名。

## 步骤与预期结果

1. 在个人空间选择成员扫码或管理员接入。页面只使用服务端当前允许的入口；管理员操作若要求独立核验身份且当前入口为 member，文案仍明确是管理员身份核验。
2. 收到未知授权结果时，反复查询原操作。完成请求未知后先查询，不能重复完成或换 operationId 自动提交。初次发起尚无 operationId 时可明确核对原幂等请求，输入与 clientRequestId 保持相同。
3. 短token到期前停止新动作并恢复；未知create保持原clientRequestId，恢复后仅显式核对原请求，未知complete恢复后先GET原operationId，不能自动重发原rowVersion命令。授权完成后重新进入或刷新稳定结果页。查询原 operationId，不再次提交安装邀请；恢复存储不含 launch URL、code 或令牌。安装、联系人同步、存档、终端条件分列，部分覆盖不显示全量成功。
4. 在实例联系人页逐页读取并返回首页。成员标识与命名空间独立标记，职位/头像字段的未获准、未返回、待核对明确；姓名默认不可展示，不用标识冒充。pending 空列表不代表全量为零。
5. manager 对当前可访问范围补同步，未知时核对同一个 clientRequestId；有 syncId 时查询原同步。范围待核对且最近同步因 Provider 响应校验失败时，manager 可显式补同步，待核对资料仍隐藏；验证授权已撤销、实例停用及同步运行中均不会由该恢复入口发起请求。当前同步应答若与现页范围不一致，移除不相容的页面并等待刷新，不误复现旧资料或阻塞下一次刷新。在较早同步查询等待期间刷新并取得当前页面后，旧查询返回不能回退当前范围/同步进度或清掉新页；同范围更换 syncId、同 syncId 更换 rowVersion 的交错同样不能回退。失效查询的错误也不向新页添加旧错误提示；核对原未知请求仍使用原 key，其成功只确认原请求，不覆盖后来取得的页面事实；此时当前请求的权限拒绝仍清空资料。
6. 请求错误、部分覆盖、范围待核对和失权分别呈现。资源级 403/404 清空资料/动作而不误退出 Maia。跨根或实例、退出和新会话之后，旧响应及旧拒绝不能恢复资料或清除新会话。
7. 正常列表自动恢复当前Workspace的已知旧operationId，且其mustQuery明确为false：旧sid GET404后必须先成功核对当前实例列表，才能移除旧引用、显示管理员接入；期间和完成后都不自动POST。显式旧深链接/主动查询404、自动恢复403仍拒绝；当前列表403/404/503不能取得创建入口，跨Workspace路由仍拒绝。旧查询恢复成功后，不得被后来列表误清；退出后的迟到列表不能恢复旧资料或移除引用。
8. 从旧深链接拒绝页点击正常接入列表，同一Vue组件重新核对列表，成功后可显式新建；初次挂载不重复恢复。未知create原key遇403/404仍保留；complete实际发送前保存mustQuery=true，保存失败不发送，到期恢复在发送前拦截时不标假已发。query_original返回仍保持待核对；旧格式缺标记保守拒绝丢弃，不能把历史unknown猜成普通旧引用。
9. 在桌面与移动 Chrome 检查正常、空、加载、错误、降级和无权页面，原型提供同类状态。联系人表内滚动不使整页溢出，控制台没有异常。

10. 原 expired 页面仅在 source view 允许 recover 时显示「使用已保存结果重新核验管理员身份」。点击只调用 recover，显示业务 Suite member OAuth；再次过期仍使用原 source/最新 sourceRowVersion 与新 key，不重发 admin 安装。
11. recover 响应丢失先 GET 精确 key，找到原轮不 POST；未找到仅明确重试同 body/key。尤其在旧恢复轮11上创建下一轮的 key B 响应丢失后，刷新旧轮路由或回列表都必须先查 B；B已创建12时显示12，未创建时保留原 body/B，普通查询不 POST，明确重试仍只用原 body/B；不得把 B 记为旧轮11的已创建 key。不同 key 的409结束冲突意图，再无 key 查询当前轮；不保存别名、过期后不自动重试，下一轮必须显式点击。恢复 complete 未知只能先 GET 原恢复操作。
12. 无 storage 的稳定结果页先恢复 GET，只有合法 NOT_FOUND404 回退旧 GET；503、403和非法恢复/旧 Schema 响应不能降级。已知 kind 按所属 API 查询/完成。来源超过24小时显示安全说明，无恢复按钮、无自动安装；根/sid/失权与旧请求迟到不能复活页面。
13. 复制同一服务端 member launch，说明电脑保留 Maia 登录、手机企微内打开且无需 Maia 登录、完成后回电脑查询。复制失败给本页只读可选择链接；传递不触发 create/recover、不持久化 URL。异步复制失败在会话切换、查询进入非 authorize 或到期之后返回，不得恢复旧链接；手机断点无页面横向溢出。
14. 管理员首装完成请求返回 `authorization_invalidation_pending` 时，原操作继续提供查询及显式完成。刷新进入同一 operationId；工作结清后查询最新版，再手动提交该 rowVersion。等待期间若服务端返回 `operation_authorization_invalidated`，原结果进入受限，完成和恢复入口消失。刷新与查询均不自动 POST，不触发新的安装或恢复。

## 测试代码

- [tests/wecom.test.ts](../../tests/wecom.test.ts)：`unknown_keeps_operation`、`result_reload_not_invite`、`expired_result_offers_recovery`、`recovery_expires_again`、`recovery_create_unknown_queries_original_key`、`recovery_reload_without_storage`、`recovery_stale_response_and_source_expired`、`recovery_identity_handoff`，以及迟到复制、409无别名、Schema分派、第二轮未知重试、`recovery_unknown_second_round_reload` 的已创建/未创建及旧路由/列表组合与旧引用/权限清理。
- [tests/wecom.test.ts](../../tests/wecom.test.ts) 的 `pending_subscribe_reload_completes_same_operation`、`hard_invalidation_while_waiting_blocks` 与 [scripts/check-wecom-browser.mjs](../../scripts/check-wecom-browser.mjs) 核对首装关注等待的原页动作、提交版本和失效后限制。
- [tests/contacts.test.ts](../../tests/contacts.test.ts)：`contact_partial_and_permissions`、分页与双向同步范围竞态、`older sync query cannot replace accepted page facts` 三种交错、旧查询失败隔离、原未知请求核对及当前 401/403 清理。
- [scripts/check-wecom-browser.mjs](../../scripts/check-wecom-browser.mjs)：`pnpm check:wecom-browser`，真实Chrome中的合成Vue流程与原型验证，包含恢复入口、同一链接复制与失败手选、迟到clipboard与到期清理、无storage刷新、源结果过期说明、同组件旧深链接404返回正常列表、无自动POST及显式新admin。
- [tests/terminals.test.ts](../../tests/terminals.test.ts) 保留旧终端会话行为回归；认证返回路径验证见 [tests/oidc.test.ts](../../tests/oidc.test.ts) 与 [tests/session.test.ts](../../tests/session.test.ts)。

## 结果边界

这些测试只使用本地合成 API/clipboard；不证明真实管理员恢复、跨设备平台授权、Android或普通Web真实姓名，也不表示Test上线或九项live验收通过。真实服务端权限拒绝、同企业不同 Workspace 隔离、实际 Test 组合和参与者姓名确认由总仓对应验收执行。

## 跨工程验证回指

本用例的跨工程组合验证见[TC-010](../../../docs/test-cases/TC-010.md)、[TC-011](../../../docs/test-cases/TC-011.md)、[TC-012](../../../docs/test-cases/TC-012.md)、[TC-013](../../../docs/test-cases/TC-013.md)、[TC-014](../../../docs/test-cases/TC-014.md)、[TC-015](../../../docs/test-cases/TC-015.md)、[TC-016](../../../docs/test-cases/TC-016.md)。具体执行结果及真实平台证据由总仓对应用例与迭代报告维护；此处回指不表示真实平台验收已通过。
