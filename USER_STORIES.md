# Sage 用户故事

> Sage 按 S0 身份/导航、S1 治理、S2 资产/终端、S3 Automation Studio、S4 Runtime、S5 Conversation/Agent、S6 Operations 演进。页面完成不等于故事完成，必须有真实服务端契约、拒绝、重连和 E2E。

Sage 不消费 Seed，也不产生 Seed Dependency Assignment；后端能力缺口应向对应 API/领域契约所有者提出统一 Assignment。

| ID | 用户故事 | 验收标准 | 来源 | 状态 |
|---|---|---|---|---|
| SAGE-001 | 作为管理员，我希望治理租户、成员、管理组、角色和应用。 | 层级/角色/状态可维护；权限拒绝正确；高风险变更确认和审计可见。 | SAG-001/FND-001/002 | `draft` |
| SAGE-002 | 作为管理员，我希望管理 Owner/User 与范围。 | 直接 Owner 唯一；有效 Own 可解释；Own/Use 在查询、页面和导出明确；移交原因和权限来源可见。 | SAG-007/FND-007~011 | `draft` |
| SAGE-003 | 作为管理员，我希望管理账号、联系人、群和标签。 | 同步状态和错误可见；目标可预览；关联实体分别鉴权。 | SAG-002 | `draft` |
| SAGE-004 | 作为运营人员，我希望管理终端和绑定。 | 覆盖注册/激活、名称/组/标签/责任人、账号绑定约束、能力/健康/版本、运行配置灰度回滚和撤销；影响 Todo 可下钻。 | TRM-001~007 | `draft` |
| SAGE-005 | 作为运营人员，我希望管理内容、插件、Action 和 Workflow。 | 依赖/兼容性校验；版本发布、灰度、回滚；未发布不可执行。 | SAG-003/CFG-001~006 | `draft` |
| SAGE-006 | 作为用户，我希望创建、控制和查看任务。 | 草稿含计划/截止时间；预览/确认/取消/暂停/重试/回放完整；展示 Task→Todo→Execution→Proof 并阻止证据验证失败冒充成功。 | SAG-004/TSK-001~008 | `draft` |
| SAGE-007 | 作为运营人员，我希望查看摘要和异常队列。 | 指标口径/新鲜度可见；可授权下钻；异常有处置入口。 | SAG-005 | `draft` |
| SAGE-008 | 作为会话运营人员，我希望查看会话和回复处理。 | 账号切换、上下文、策略/回复和关联执行可见；权限逐实体校验。 | SAG-006 | `draft` |
| SAGE-009 | 作为用户，我希望使用内嵌 Iris Chat。 | 流式恢复、计划/确认卡片、进度和报告跳转可用；无模型 Secret。 | IRS-001~010 | `draft` |
| SAGE-010 | 作为发布负责人，我希望 E2E 验证管理闭环。 | Test 覆盖跨租户拒绝、token/成员撤销、Own/Use 导出、高风险确认、发布、SSE 断流恢复和任务处置。 | FND-021 | `draft` |

## 产品化细化故事

| ID | 用户故事 | 验收标准 | 来源 | 状态 |
|---|---|---|---|---|
| SAGE-011 | 作为用户，我希望在多租户间安全切换。 | 切换重新授权；清空旧 query/form/event state；旧 token/API 请求拒绝；URL 不泄漏租户数据。 | FND-001/004 | `draft` |
| SAGE-012 | 作为管理员，我希望预览权限变更影响。 | 展示直接 Owner/有效 Own/User/关联对象；preview 版本过期拒绝提交；导出同 scope。 | FND-007~011 | `draft` |
| SAGE-013 | 作为 Action 作者，我希望用 Schema 编辑 Step。 | Operation input/output、映射来源、风险/资源可见；未来引用/类型错误发布前阻止。 | CFG-002 | `draft` |
| SAGE-014 | 作为流程作者，我希望可视化 Workflow 依赖与分支。 | 节点/子流程/join/失败策略可见；循环/Schema 缺口检测；运行版本不可变。 | CFG-004 | `draft` |
| SAGE-015 | 作为发布者，我希望比较和灰度资产版本。 | diff、依赖影响、cohort、命中和回滚目标明确；不修改运行中快照。 | CFG-005 | `draft` |
| SAGE-016 | 作为运营人员，我希望处理 outcome_unknown。 | 展示最后租约/步骤/证据；只允许授权核验、判定或回放；不提供“直接成功”。 | TSK-007/008 | `draft` |
| SAGE-017 | 作为审核人员，我希望并发审批不会覆盖。 | claim/版本 CAS；旧草稿批准拒绝；超时和改稿失效；Stem Confirmation 可区分。 | TEA-003~005 | `draft` |
| SAGE-018 | 作为用户，我希望事件断线后恢复而不重复提示。 | Last-Event-ID、快照补偿、终态覆盖缓存；确认卡片不重复消费。 | IRS-007/TSK-006 | `draft` |
| SAGE-019 | 作为运维人员，我希望所有异常有可执行下一步。 | error code、影响范围、correlation ID、runbook/重试/人工入口；Secret 不显示。 | SOP-004/005 | `draft` |
