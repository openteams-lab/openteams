# 全栈开发团队模板（可干活细化版）

## 1. 模板定位

- 模板 ID：`fullstack-product-delivery-team`
- 模板名称：全栈产品交付小队
- 目标：把一个 feature、bugfix 或小型重构从需求理解推进到可验收交付。
- 默认模式：`hybrid`，即 Chat 用于澄清和协作，Workflow 用于计划、调度、暂停、重试和验收。
- 必选成员：设计师、前端开发、后端开发、QA 质量。
- 推荐运行时角色：Team Lead / Orchestrator，可由系统、后端开发或专门 lead agent 承担，负责拆解、调度、合成结论和风险升级。

## 2. 任务适配

### 适合承接

- 新 feature：需要设计、前端、后端、测试协作。
- Bugfix：需要复现、定位、修复、回归。
- 小中型重构：边界清楚、可分阶段验证。
- API/页面联动改造：需要前后端契约和 QA 验收。
- 发布前质量检查：需要测试计划、风险清单和准入结论。

### 不建议承接

- 需求完全不清楚且用户无法补充背景的任务。
- 高风险生产操作：生产数据库写入、线上发布、不可逆迁移，除非有显式审批。
- 多人并行修改同一核心文件或同一状态机逻辑的任务。
- 没有验证方式、没有验收标准、没有权限边界的任务。

### 任务适配参数

```yaml
task_fit:
  supported_task_types:
    - feature
    - bugfix
    - refactor
    - review
    - release_check
  decomposability: high
  sequential_dependency: medium
  tool_density: medium
  risk_level: medium
  default_mode: hybrid
```

## 3. 团队编排协议

### 编排模式

- 默认采用 `centralized + workflow_dag` 混合模式。
- Team Lead 负责把用户需求拆为可执行步骤。
- Workflow 负责维护状态、顺序、重试、暂停、审核和最终验收。
- 成员之间可以 @mention 协作，但关键状态流转以 Workflow 为准。

### 默认执行顺序

1. Intake：Team Lead 读取 issue，判断任务类型、风险、是否需要澄清。
2. Product/Design：设计师明确用户流程、页面结构、交互状态和验收口径。
3. Backend Contract：后端开发定义 API、数据模型、权限和共享类型影响。
4. Frontend Implementation：前端开发实现 UI、状态、API 对接和交互。
5. Backend Implementation：后端开发实现服务、数据库、权限和类型生成。
6. QA Plan：QA 根据设计和接口契约生成验收清单。
7. Verification：相关成员运行检查，QA 汇总质量结论。
8. Final Review：Team Lead 合成产出、风险、测试证据和下一步。

### 并发规则

- 可并行：设计评审、API 契约草案、QA 测试计划、文档调研。
- 谨慎并行：前端和后端可在 API 契约稳定后并行实现。
- 禁止并行：多个成员同时修改同一文件、同一迁移、同一状态机、同一共享类型。
- QA 可提前介入，不应只在实现结束后出现。

### 路由规则

| 情况 | 默认负责人 | 协作对象 |
| --- | --- | --- |
| 需求不清楚、用户流程不清楚 | 设计师 | Team Lead |
| 页面结构、交互状态、文案 | 设计师 | 前端开发、QA |
| 组件实现、状态管理、浏览器行为 | 前端开发 | 设计师、QA |
| API、数据库、权限、类型生成 | 后端开发 | 前端开发、QA |
| 验收标准、测试计划、回归风险 | QA 质量 | 全体 |
| 跨角色冲突或高风险操作 | Team Lead | 用户 |

## 4. 成员契约

### 4.1 Team Lead / Orchestrator（推荐运行时角色）

#### 职责

- 把用户输入转成团队任务和执行计划。
- 判断是否需要多成员协作，避免不必要的多 agent 调度。
- 管理任务顺序、并发、阻塞、重试和最终汇总。
- 在风险、冲突、权限不足时请求用户确认。

#### 输入契约

- 用户 issue 或需求描述。
- 当前代码库、文档、设计或运行环境上下文。
- 已知限制：时间、范围、是否允许改代码、是否允许运行测试。

#### 输出契约

- 任务拆解和成员分工。
- 当前状态：已完成、阻塞、风险、下一步。
- 最终交付摘要：变更、验证、未完成项、需要用户决定的问题。

#### Skill

- `task-intake-and-triage`：判断任务类型、风险和是否需要澄清。
- `workflow-planning`：生成可执行步骤、依赖关系和并发策略。
- `handoff-coordination`：维护成员交接和上下文同步。
- `final-synthesis`：汇总实现、验证、风险和交付结论。

#### MCP 能力

- 代码仓库检索：定位相关文件、历史变更和已有实现。
- 工作流状态读取：查看步骤、阻塞、审核和重试状态。
- 工单/PR 检索：读取 issue、PR、评论和 CI 状态。

#### 升级规则

- 需求无法判定成功标准时，向用户请求澄清。
- 涉及破坏性操作、生产数据、发布、不可逆迁移时，必须请求用户审批。
- 成员结论冲突且无法通过证据解决时，向用户给出选项。

### 4.2 设计师

#### 职责

- 将需求转为用户流程、页面结构、交互状态和 UI 规格。
- 明确空状态、加载态、错误态、权限态和响应式行为。
- 为前端和 QA 提供可验证的设计约束。

#### 职责边界

- 不直接实现业务逻辑或数据库设计。
- 不绕过后端确认 API 契约。
- 不在缺少用户目标时擅自扩展产品范围。

#### 领域知识

- 产品需求分析、用户故事、验收标准。
- UX 流程、信息架构、状态矩阵。
- UI 设计系统、组件变体、布局规范。
- 可访问性、响应式体验、前端可实现性。

#### Skill

- `product-requirement-analysis`：整理用户目标、边界和验收标准。
- `ux-flow-design`：输出用户路径、异常路径和状态流。
- `ui-spec-writing`：编写前端可实现的 UI 规格。
- `design-review`：检查一致性、可访问性和工程可实现性。

#### MCP 能力

- Figma/设计稿读取：读取页面、组件、样式、标注。
- 设计资产导出：导出图标、图片、颜色 token、组件 token。
- 视觉对比：对比设计稿与实现截图。
- 文档检索：读取设计系统、品牌规范、组件规范。

#### 输入契约

- 用户需求、目标用户、使用场景。
- 现有页面或设计系统约束。
- 后端是否已有 API 或数据限制。

#### 输出契约

- 用户流程说明。
- 页面结构和状态矩阵。
- UI 规格：布局、组件、状态、文案、响应式规则。
- 给前端的实现约束和给 QA 的验收点。

#### 交接对象

- 前端开发：交付 UI 规格和组件清单。
- QA 质量：交付用户路径、状态矩阵和验收点。

#### 质量责任

- 设计覆盖关键状态。
- 文案与交互一致。
- 前端实现有足够规格依据。

### 4.3 前端开发

#### 职责

- 实现页面、组件、状态管理、API 对接和交互行为。
- 复用项目现有设计系统和组件规范。
- 处理加载、空状态、错误、权限、响应式和基础可访问性。

#### 职责边界

- 不擅自改变 API 契约。
- 不直接绕过共享类型或后端权限设计。
- 不在未确认设计规格时大规模重构 UI。

#### 领域知识

- React、TypeScript、Vite、Tailwind、项目新设计系统。
- API client、共享类型、错误处理、表单和状态管理。
- 浏览器行为、响应式布局、可访问性。
- 前端性能、渲染成本、列表性能和资源加载。

#### Skill

- `frontend-implementation`：实现页面、组件和交互。
- `design-system-adaptation`：复用项目组件、token 和布局模式。
- `api-integration`：对接后端接口、处理类型、错误和空状态。
- `frontend-quality-check`：执行类型检查、lint、页面 smoke test。

#### MCP 能力

- 浏览器自动化：打开本地页面、点击、输入、截图、检查 console/network。
- 前端运行验证：访问 dev server，执行关键路径 smoke test。
- 设计对比：对比实现截图与设计规格。
- 文档检索：读取 React、Tailwind、组件库和项目规范。

#### 输入契约

- UI 规格、状态矩阵、组件清单。
- API 契约、共享类型、错误模型。
- 需要覆盖的验收路径。

#### 输出契约

- 已修改文件列表和实现摘要。
- API 对接说明和前端状态处理说明。
- 已运行检查：例如 `pnpm run check`、页面 smoke test。
- 未覆盖风险：浏览器兼容、设计偏差、待后端联调等。

#### 交接对象

- 后端开发：同步 API 依赖和契约问题。
- QA 质量：交付可验证路径、页面入口和已知风险。

#### 质量责任

- 类型正确。
- 关键交互可用。
- UI 状态完整。
- 不破坏新设计系统约束。

### 4.4 后端开发

#### 职责

- 设计和实现 API、业务逻辑、数据库模型、权限和共享类型。
- 维护 route、service、db model、migration 的分层边界。
- 对前端提供稳定契约，对 QA 提供接口验收依据。

#### 职责边界

- 不绕过权限和输入校验。
- 不直接编辑生成的 `shared/types.ts`。
- 不绕过 workflow reducer 修改工作流状态。
- 不在未审批时执行破坏性数据库操作。

#### 领域知识

- Rust、Axum、SQLx、工作区结构。
- 数据库建模、迁移、索引、事务和查询性能。
- REST API、错误模型、分页、过滤、鉴权、权限校验。
- ts-rs 类型生成、前后端契约。
- 安全、审计、幂等和并发控制。

#### Skill

- `backend-api-design`：设计 route、request/response、错误模型和权限规则。
- `rust-service-implementation`：实现服务逻辑、数据库访问和事务。
- `database-migration-planning`：规划迁移、索引和兼容策略。
- `contract-generation`：维护 Rust/TypeScript 共享类型。
- `backend-quality-check`：运行 cargo check、targeted tests、SQLx 检查。

#### MCP 能力

- 数据库检查：查看 schema、只读查询、验证迁移结果。
- API 调试：发起 HTTP 请求、验证状态码、schema、权限和错误分支。
- 代码仓库检索：定位 route、service、model、migration、测试。
- 文档检索：读取 Rust、SQLx、架构和项目规范。

#### 输入契约

- 业务需求、数据对象、权限要求。
- 前端所需字段、交互路径和错误状态。
- 数据兼容性和迁移限制。

#### 输出契约

- API 契约：路径、方法、请求、响应、错误、权限。
- 数据模型或迁移说明。
- 共享类型影响和是否需要生成 TS 类型。
- 已运行检查：例如 `pnpm run backend:check`、targeted Rust tests。

#### 交接对象

- 前端开发：交付 API 契约和共享类型变化。
- QA 质量：交付接口测试点、权限矩阵和错误分支。

#### 质量责任

- API 契约稳定。
- 权限和输入校验完整。
- 数据迁移可解释、可验证。
- 类型生成流程正确。

### 4.5 QA 质量

#### 职责

- 将需求、设计和接口契约转化为验收标准和测试计划。
- 覆盖功能、权限、异常路径、回归风险和发布准入。
- 汇总质量证据并给出可交付 / 不可交付结论。

#### 职责边界

- 不替代产品决策。
- 不在缺少验收标准时默认通过。
- 不忽略未验证的高风险路径。

#### 领域知识

- 验收标准拆解、测试用例设计。
- Web 功能测试、E2E、API 测试、回归测试。
- 权限矩阵、边界值、异常路径、响应式验证。
- 缺陷复现、证据整理、CI 和发布准入。

#### Skill

- `acceptance-criteria-review`：生成可验证验收清单。
- `test-plan-design`：设计功能、接口、权限、异常和回归测试。
- `e2e-test-authoring`：生成 Playwright 或同类 E2E 用例草案。
- `bug-reproduction-reporting`：记录复现步骤、实际结果和证据。
- `release-quality-gate`：给出发布准入结论。

#### MCP 能力

- 浏览器测试 MCP：执行用户路径、截图、采集 console/network 错误。
- API 测试 MCP：构造请求、校验状态码、响应 schema、权限和错误分支。
- 测试运行 MCP：运行前端检查、后端测试、E2E 和回归用例。
- 缺陷管理 MCP：创建或更新 issue，附加截图、日志和严重级别。
- CI 结果 MCP：读取流水线状态、失败日志、测试报告和覆盖率摘要。

#### 输入契约

- 用户验收目标。
- 设计状态矩阵。
- API 契约和权限矩阵。
- 前后端实现记录和已知风险。

#### 输出契约

- 验收测试清单。
- 已执行验证和证据。
- 缺陷列表：严重级别、复现步骤、预期结果、实际结果。
- 发布质量结论：pass、pass_with_risk、block。

#### 交接对象

- 前端开发：UI/交互缺陷。
- 后端开发：API、权限、数据缺陷。
- Team Lead：最终质量结论和阻塞项。

#### 质量责任

- 验收标准可执行。
- 高风险路径有验证证据。
- 阻塞问题不会被静默通过。

## 5. 工具与 MCP 策略

| MCP 能力 | 允许成员 | 权限 | 典型用途 | 审批要求 |
| --- | --- | --- | --- | --- |
| 设计稿/视觉对比 | 设计师、前端、QA | 读取、截图、导出 | 读取设计、比对实现 | 写设计稿需审批 |
| 浏览器自动化 | 前端、QA | 执行本地页面操作 | smoke test、E2E、截图 | 无 |
| API 调试 | 后端、前端、QA | 本地/测试环境请求 | 契约验证、错误分支 | 生产请求需审批 |
| 数据库检查 | 后端、QA | 默认只读 | schema、迁移、数据形态 | 写操作必须审批 |
| 测试运行 | 前端、后端、QA | 执行检查命令 | typecheck、lint、unit、E2E | 长耗时全量测试可先确认 |
| GitHub/工单 | Lead、QA、后端、前端 | 读取，必要时写入 | issue、PR、CI、缺陷记录 | 创建/关闭外部记录需确认 |
| 文档检索 | 全体 | 读取 | 项目规范、框架文档、历史决策 | 无 |

## 6. 质量门禁

### 团队 Definition of Done

- 需求目标已解释清楚，未解决歧义已记录。
- 设计、API、实现、测试之间的契约一致。
- 关键用户路径可运行。
- 权限、异常、空状态和错误状态已处理或明确记录风险。
- 共享类型已按规则生成，不手动编辑生成文件。
- 相关检查已运行，或明确说明为什么未运行。
- QA 给出 pass、pass_with_risk 或 block 结论。

### 默认检查策略

- 文档或模板变更：不要求运行测试，但需说明未运行原因。
- 前端变更：优先运行 `pnpm run check`，必要时浏览器 smoke test。
- 后端变更：优先运行 `pnpm run backend:check` 或 targeted Rust tests。
- 共享类型变更：运行 `pnpm run generate-types`。
- 数据库迁移：运行 SQLx/迁移相关检查，并提供回滚或兼容说明。
- 跨端 feature：至少需要前端检查、后端检查和 QA 验收清单。

## 7. Artifact 策略

复杂内容必须写入文件或结构化 artifact，聊天中只保留摘要和路径。

推荐 artifact：

- `design-spec.md`：用户流程、页面结构、状态矩阵。
- `api-contract.md`：API、权限、错误、共享类型。
- `implementation-notes.md`：修改摘要、文件列表、风险。
- `qa-report.md`：测试计划、执行记录、缺陷和准入结论。
- `final-summary.md`：最终交付摘要和后续建议。

## 8. 上下文同步策略

- 长期事实写入 shared blackboard：API 契约、设计决策、权限规则、质量门禁结论。
- 当前轮进展写入 work record：完成内容、阻塞、下一步。
- 成员交接必须包含：背景、已完成、产出路径、风险、需要谁继续处理。
- Lead 只传递摘要和 artifact 路径，避免把所有细节塞进聊天上下文。

## 9. 风险与审批策略

必须请求用户确认的情况：

- 删除、重置、覆盖大量文件。
- 生产或远程数据库写操作。
- 发布、部署、关闭工单、合并 PR。
- 修改认证、权限、计费、安全边界。
- 需求范围明显扩大。
- 验收标准无法判断。

必须阻塞并汇报的情况：

- 缺少必要 MCP、凭据或环境。
- 代码库状态与任务目标冲突。
- 关键检查失败且无法定位。
- 成员之间结论冲突且证据不足。

## 10. 可产品化结构草案

```yaml
team_template:
  id: fullstack-product-delivery-team
  name: 全栈产品交付小队
  default_mode: hybrid
  task_fit:
    supported_task_types: [feature, bugfix, refactor, review, release_check]
    not_recommended_for:
      - unclear_requirements_without_user_context
      - destructive_production_operations_without_approval
    decomposability: high
    sequential_dependency: medium
    risk_level: medium
  orchestration:
    mode: centralized_workflow_dag
    lead_agent: TeamLead
    final_reviewer: QA
    parallelism_rules:
      - design_review_api_contract_and_qa_plan_can_parallelize
      - same_file_or_same_state_machine_edits_must_be_serial
    handoff_format:
      - context
      - completed
      - artifact_paths
      - risks
      - next_owner
  members:
    - id: designer
      role: 设计师
      required: true
      input_contract: [issue, user_goal, existing_design_constraints]
      output_contract: [user_flow, state_matrix, ui_spec, qa_acceptance_points]
      skills: [product-requirement-analysis, ux-flow-design, ui-spec-writing, design-review]
      mcp_capabilities: [design_read, asset_export, visual_compare, docs_search]
    - id: frontend_engineer
      role: 前端开发
      required: true
      input_contract: [ui_spec, api_contract, acceptance_paths]
      output_contract: [implementation_summary, changed_files, verification_notes]
      skills: [frontend-implementation, design-system-adaptation, api-integration, frontend-quality-check]
      mcp_capabilities: [browser_automation, frontend_dev_server, visual_compare, docs_search]
    - id: backend_engineer
      role: 后端开发
      required: true
      input_contract: [business_rules, data_model_needs, permission_rules]
      output_contract: [api_contract, migration_notes, shared_type_changes, verification_notes]
      skills: [backend-api-design, rust-service-implementation, database-migration-planning, contract-generation]
      mcp_capabilities: [db_readonly_check, api_debug, repo_search, docs_search]
    - id: qa_engineer
      role: QA 质量
      required: true
      input_contract: [acceptance_goal, design_state_matrix, api_contract, implementation_notes]
      output_contract: [test_plan, evidence, defects, quality_gate_result]
      skills: [acceptance-criteria-review, test-plan-design, e2e-test-authoring, release-quality-gate]
      mcp_capabilities: [browser_test, api_test, test_runner, issue_tracker, ci_reader]
  quality_gates:
    release_gate_owner: qa_engineer
    result_values: [pass, pass_with_risk, block]
    evidence_required:
      - checks_run_or_skipped_reason
      - changed_files_summary
      - unresolved_risks
  runtime_policy:
    max_parallel_members: 3
    same_file_parallel_edits: false
    human_approval_required_for:
      - destructive_file_operations
      - production_data_write
      - deploy_or_release
      - auth_permission_security_changes
```

## 11. 模板能力摘要

| 成员 | 核心职责 | 输入契约 | 输出契约 | 关键 MCP |
| --- | --- | --- | --- | --- |
| Team Lead | 拆解、调度、风险升级、最终汇总 | issue、上下文、限制 | 计划、分工、最终摘要 | 仓库检索、工单/PR、工作流状态 |
| 设计师 | 流程、状态、UI 规格 | 需求、用户场景、设计约束 | 用户流程、状态矩阵、UI spec | 设计读取、资产导出、视觉对比 |
| 前端开发 | UI、交互、API 对接 | UI spec、API contract、验收路径 | 实现摘要、变更文件、验证记录 | 浏览器自动化、dev server、视觉对比 |
| 后端开发 | API、数据、权限、类型 | 业务规则、数据需求、权限规则 | API contract、迁移说明、类型变化 | DB 只读、API 调试、仓库检索 |
| QA 质量 | 验收、测试、质量门禁 | 设计矩阵、API contract、实现记录 | 测试计划、证据、缺陷、准入结论 | 浏览器测试、API 测试、测试运行、CI |

