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
5. manager 对当前可访问范围补同步，未知时核对同一个 clientRequestId；有 syncId 时查询原同步。当前同步应答若与现页范围不一致，移除不相容的页面并等待刷新，不误复现旧资料或阻塞下一次刷新。在较早同步查询等待期间刷新并取得当前页面后，旧查询返回不能回退当前范围/同步进度或清掉新页；同范围更换 syncId、同 syncId 更换 rowVersion 的交错同样不能回退。失效查询的错误也不向新页添加旧错误提示；核对原未知请求仍使用原 key，其成功只确认原请求，不覆盖后来取得的页面事实；此时当前请求的权限拒绝仍清空资料。
6. 请求错误、部分覆盖、范围待核对和失权分别呈现。资源级 403/404 清空资料/动作而不误退出 Maia。跨根或实例、退出和新会话之后，旧响应及旧拒绝不能恢复资料或清除新会话。
7. 在桌面与移动 Chrome 检查正常、空、加载、错误、降级和无权页面，原型提供同类状态。联系人表内滚动不使整页溢出，控制台没有异常。

## 测试代码

- [tests/wecom.test.ts](../../tests/wecom.test.ts)：`unknown_keeps_operation`、`result_reload_not_invite`、未知原发起核对与完成未知限制。
- [tests/contacts.test.ts](../../tests/contacts.test.ts)：`contact_partial_and_permissions`、分页与双向同步范围竞态、`older sync query cannot replace accepted page facts` 三种交错、旧查询失败隔离、原未知请求核对及当前 401/403 清理。
- [scripts/check-wecom-browser.mjs](../../scripts/check-wecom-browser.mjs)：`pnpm check:wecom-browser`，真实 Chrome 中的合成 Vue 流程与原型验证。
- [tests/terminals.test.ts](../../tests/terminals.test.ts) 保留旧终端会话行为回归；认证返回路径验证见 [tests/oidc.test.ts](../../tests/oidc.test.ts) 与 [tests/session.test.ts](../../tests/session.test.ts)。

## 结果边界

这些测试不证明真实安装成功或官方组件显示真实姓名。真实服务端权限拒绝、同企业不同 Workspace 隔离、实际 Test 组合和参与者姓名确认由总仓对应验收执行。

## 跨工程验证回指

本用例的跨工程组合验证见[TC-010](../../../docs/test-cases/TC-010.md)、[TC-011](../../../docs/test-cases/TC-011.md)、[TC-012](../../../docs/test-cases/TC-012.md)、[TC-013](../../../docs/test-cases/TC-013.md)、[TC-014](../../../docs/test-cases/TC-014.md)、[TC-015](../../../docs/test-cases/TC-015.md)、[TC-016](../../../docs/test-cases/TC-016.md)。具体执行结果及真实平台证据由总仓对应用例与迭代报告维护；此处回指不表示真实平台验收已通过。
