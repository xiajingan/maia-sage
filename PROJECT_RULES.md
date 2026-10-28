# Sage 工程规则

本工程遵守[总仓项目规则](../PROJECT_RULES.md)；本文只补充本工程适用差异。技术栈为 TypeScript / Vue 3 / Vite；Node.js 用于构建工具链，版本及边界以[本工程架构](ARCHITECTURE.md)和[技术栈基线](../docs/architecture/technology-stack.md)为准。

## 本工程约束

- Vue feature 按 UI、query/form state、生成 client 和路由入口组织；共享组件不发业务请求，不跨 feature 导入内部 store。约束见[管理端架构](ARCHITECTURE.md)。
- client 消费各服务发布的 OpenAPI/事件 Schema；浏览器不维护权限算法或领域状态机。当前根/User、表单、查询和事件隔离，迟到回调不能恢复旧内容。
- 构建和 runtime-config 仅含公共配置；相关变更验证真实后端的拒绝、预览版本、一次确认和未知对账，并覆盖所选界面的可访问性。预算按实际页面确定并复验。

## 检查要求

当前文档变更须检查结构、链接/锚点、语义及 diff。实现建立后，本工程在真实清单/CI 中登记管理端与 Chat UI 所需的静态、行为、契约检查及必要的环境验证。只运行已配置且适用于本次变更的检查，不使用占位命令，不宣称尚未验证的门槛已通过。
