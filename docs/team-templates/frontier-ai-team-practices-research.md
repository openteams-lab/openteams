# 前沿 AI 团队实践调研

调研日期：2026-06-21

## 摘要

当前前沿 AI 团队实践的共识不是“堆更多 agent”，而是按任务性质选择合适架构：能并行拆解、上下文很大、工具很多的任务适合多 agent；强顺序依赖、共享上下文密集、反馈链很短的任务通常更适合单 agent 或确定性 workflow。可靠的 AI 团队需要把角色能力、上下文边界、工具权限、交接契约、质量门禁、运行时调度和可观测性一起定义。

## 主流做法

### 1. 先简单后复杂

Anthropic 和 OpenAI 都强调：先把单 agent、工具和提示词做好，只有当复杂度、工具数量、领域分工或上下文窗口成为瓶颈时，再升级为多 agent。多 agent 会带来成本、延迟、协调复杂度和错误传播风险。

对 OpenTeams 的启发：

- 团队模板需要声明“为什么需要团队”，而不是默认所有任务都用多人协作。
- 模板中应加入 `task_fit` 字段，例如并行度、顺序依赖、工具密度、上下文规模、风险等级。
- 对简单任务，团队协议可以退化为单成员执行 + QA/Review。

### 2. 两类核心编排模式

目前最常见的两类模式：

- Manager / Orchestrator 模式：一个 lead 或 manager 拆解任务、分派给专家 agent、合成结果。
- Handoff / Decentralized 模式：agent 之间按专业边界转交控制权，由下一个 agent 接管任务。

Microsoft Magentic-One、Anthropic Research 更偏 Orchestrator-Workers。OpenAI Agents SDK 和 LangGraph 同时支持 manager、handoff、router、subagent 等模式。

对 OpenTeams 的启发：

- 团队协议需要显式定义 `orchestration_mode`：centralized、handoff、workflow_dag、hybrid。
- Chat mode 适合 handoff 和讨论；Workflow mode 适合 DAG、暂停、重试、审核和验收。
- 全栈开发团队建议用 hybrid：计划和状态由 workflow 编排，设计/前端/后端/QA 可在独立步骤中并行或串行执行。

### 3. 多 agent 最适合“可并行 + 高价值”的任务

Anthropic 的多 agent Research 系统适合开放式研究，因为子 agent 可以并行探索不同方向。Google Research 在 2026 年的实验中也指出，多 agent 在可并行任务上能明显提升表现，但在严格顺序规划任务上可能显著下降。

对 OpenTeams 的启发：

- 团队模板要标注哪些步骤可并行，哪些必须串行。
- 对代码实现类任务，应谨慎并行修改同一模块，避免上下文冲突和重复改动。
- QA、设计评审、接口评审、文档调研这类相对独立工作适合并行。

### 4. 明确的任务契约比角色名更重要

Anthropic 的经验显示，给 subagent 的任务描述必须包含目标、输出格式、工具/来源指导和边界，否则会重复搜索、遗漏关键点或互相干扰。

对 OpenTeams 的启发：

每个成员配置除了职责、Skill、MCP，还应定义：

- `input_contract`：启动前需要什么上下文
- `output_contract`：必须产出什么格式
- `scope_boundary`：负责什么、不负责什么
- `handoff_target`：完成后交给谁
- `effort_budget`：最多允许多少轮、多少工具调用、多少时间
- `escalation_rules`：何时请求用户、lead 或其他成员

### 5. 工具和 MCP 是团队能力边界

前沿实践普遍把工具接口当成核心工程对象。Anthropic 明确强调工具描述、参数、边界和示例会直接影响 agent 表现；OpenAI 把工具、handoff、guardrails、MCP 和 tracing 作为 agent 应用的基础能力。

对 OpenTeams 的启发：

- MCP 不应只挂在成员上，还要有工具契约：用途、权限、输入输出、失败策略、审计要求。
- 类似工具要避免重叠，否则 agent 容易选错工具。
- MCP 描述应包含示例、边界、危险操作审批规则。
- 团队模板中应有 `tool_policy`：只读、可写、需审批、禁用场景。

### 6. 用持久化产物减少“传话损耗”

Anthropic 提到 subagent 结果可写入文件系统或外部 artifact，再把轻量引用交给协调者。这样比所有信息都通过 lead 汇总更可靠，也更便于审计。

对 OpenTeams 的启发：

- 每个成员应把复杂产出写成 artifact，而不是只发长消息。
- 团队协议应规定 artifact 类型：设计规格、API 契约、测试报告、风险清单、实现记录。
- 协调者只传递引用和摘要，减少上下文污染。

### 7. 质量门禁和 human-in-the-loop 是生产必需品

OpenAI 和 Microsoft 都强调 guardrails、人类审核、高风险操作审批、沙箱隔离、日志监控。Anthropic 也强调 checkpoint、停止条件、测试和观测。

对 OpenTeams 的启发：

- 团队模板需要 `quality_gates`，不是只靠成员自觉。
- 高风险操作必须进入审批：数据库迁移、删除文件、发布、生产数据访问、外部系统写操作。
- QA 成员不仅做最后测试，也应定义验收标准和风险门禁。
- Workflow mode 的暂停、恢复、重试、accept/reject 是 AI 团队的关键基础设施。

### 8. 评估应看结果和过程，而不是固定路径

多 agent 系统同一个输入可能走不同路径。Anthropic 建议用小样本真实任务尽早评估，并用灵活方法判断结果是否达成目标。Google Research 也把任务属性、架构选择和错误传播作为评估重点。

对 OpenTeams 的启发：

- 团队模板需要内置 eval/rubric：成功标准、失败类型、证据要求。
- 评估不应要求每次执行相同步骤，而要看输出质量、风险控制、是否遵守权限和是否通过门禁。
- 每个团队模板可以附带一组 benchmark tasks，用于比较团队协议和成员配置变化。

### 9. 中央协调有利于错误控制

Google Research 发现，独立并行 agent 容易放大错误；中央编排器虽然增加瓶颈，但能作为验证点，降低错误传播。Microsoft Magentic-One 也采用 Orchestrator 来计划、追踪和重新规划。

对 OpenTeams 的启发：

- 对全栈开发这类有交付责任的团队，建议默认有 lead 或 orchestrator。
- 去中心化 handoff 更适合客服分流、领域接管、低耦合任务。
- workflow reducer / scheduler 的设计方向和前沿实践一致：运行时状态应由中心机制治理。

## 代表性实践

### Anthropic Research

做法：

- LeadResearcher 规划研究策略并创建多个 subagent。
- Subagent 并行搜索不同方向，各自使用工具并压缩发现。
- Lead 合成结果，必要时继续创建 subagent。
- CitationAgent 负责引用定位和可溯源输出。
- 使用 memory 保存计划，避免长上下文截断。

可借鉴点：

- lead 分派任务时必须给目标、边界、输出格式、工具来源。
- 按任务复杂度分配 agent 数和工具调用预算。
- 并行适合 breadth-first 研究；编码任务要谨慎。
- 使用 artifact 保存子任务结果。

来源：https://www.anthropic.com/engineering/multi-agent-research-system

### Anthropic Building Effective Agents

做法：

- 从 augmented LLM 开始：模型 + retrieval + tools + memory。
- 常用模式包括 prompt chaining、routing、parallelization、orchestrator-workers、evaluator-optimizer、autonomous agents。
- 建议只在简单方案不足时增加 agentic complexity。
- 强调工具文档、透明计划、沙箱测试和 guardrails。

可借鉴点：

- OpenTeams 的 workflow 模式可以覆盖 prompt chaining、routing、orchestrator-workers、evaluator-optimizer。
- 团队模板应明确“何时不用多 agent”。
- 工具/MCP 的描述质量应成为模板质量的一部分。

来源：https://www.anthropic.com/engineering/building-effective-agents

### OpenAI Agents

做法：

- Agent 由 instructions、tools、handoffs、guardrails、structured outputs 等组成。
- 多 agent 分为 manager pattern 和 decentralized handoff pattern。
- Guardrails 包括输入过滤、工具使用限制、人类审核和高风险动作拦截。
- SDK 路线强调 server 端掌控 orchestration、tool execution、state、approval。

可借鉴点：

- 成员定义应包含结构化输出和 handoff 规则。
- 团队协议需要决定“谁拥有当前回复/执行权”。
- 对高风险动作使用 human review。

来源：https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/

来源：https://developers.openai.com/api/docs/guides/agents

### Microsoft Magentic-One / AutoGen

做法：

- Orchestrator 负责计划、分派、跟踪进度、失败后重新规划。
- 专家包括 WebSurfer、FileSurfer、Coder、Computer Terminal。
- 面向开放式 Web、文件和代码执行任务。
- 明确建议容器、虚拟环境、日志监控、人类监督和访问限制。

可借鉴点：

- OpenTeams 的成员可以按工具面拆分：浏览器、文件、代码、终端、测试。
- 默认运行环境要隔离，尤其是能执行命令或访问外部系统的成员。
- lead 不只是聊天角色，还要具备计划、进度跟踪和重规划职责。

来源：https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/

来源：https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/magentic-one.html

### Google Research Agent Scaling

做法：

- 对 180 种 agent 配置做受控评估。
- 评估 single-agent、independent、centralized、decentralized、hybrid 架构。
- 结论是架构要匹配任务属性，不是 agent 越多越好。
- 中央架构在错误控制上更稳，独立并行更容易错误级联。

可借鉴点：

- OpenTeams 应把“任务可分解性、顺序依赖、工具数量”作为选择团队模式的输入。
- 需要记录错误传播和返工原因，反向优化团队模板。
- 对工具很多的任务，多 agent 未必更好，因为工具协调成本会上升。

来源：https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/

### LangGraph / CrewAI

做法：

- LangGraph 强调 context engineering：决定每个 agent 看见什么上下文。
- 常见模式包括 subagents、handoffs、skills、router、自定义 workflow。
- CrewAI 把 agents、crews、flows 组合起来，并内置 guardrails、memory、knowledge、observability、人类介入。

可借鉴点：

- OpenTeams 的 Skill 和 MCP 应与上下文策略绑定：不是所有成员都看全部上下文。
- “团队模板”可以区分 crew/team 和 flow/workflow：团队定义人，workflow 定义执行路径。
- 可观测性、状态持久化、恢复长任务是产品级多 agent 系统的基础能力。

来源：https://docs.langchain.com/oss/python/langchain/multi-agent

来源：https://docs.crewai.com/

## 对 OpenTeams 团队模板的建议字段

建议在现有“成员 + 团队协议”基础上补齐：

```yaml
team_template:
  task_fit:
    supported_task_types: []
    not_recommended_for: []
    decomposability: low | medium | high
    sequential_dependency: low | medium | high
    tool_density: low | medium | high
    risk_level: low | medium | high

  orchestration:
    mode: centralized | handoff | workflow_dag | hybrid
    lead_agent: string
    planner: string
    final_reviewer: string
    parallelism_rules: []
    handoff_rules: []
    stop_conditions: []

  member_contracts:
    - name: string
      role: string
      responsibilities: []
      scope_boundary: []
      input_contract: []
      output_contract: []
      handoff_target: string
      effort_budget:
        max_turns: number
        max_tool_calls: number
      escalation_rules: []

  tool_policy:
    mcp_servers: []
    allowed_tools_by_member: {}
    approval_required_actions: []
    forbidden_actions: []
    failure_fallbacks: []

  artifact_policy:
    required_artifacts: []
    artifact_formats: []
    summary_required: true

  quality_gates:
    acceptance_rubric: []
    required_checks: []
    evidence_required: []
    human_review_required_for: []

  runtime_policy:
    sandbox_required: true
    context_policy: []
    memory_policy: []
    retry_policy: []
    observability:
      traces: true
      logs: true
      metrics: []
```

## 对全栈开发团队的落地建议

- 使用 centralized + workflow_dag 的混合模式：lead 负责计划和合成，workflow 负责状态和顺序。
- 设计、后端 API 设计、前端实现、QA 计划可以部分并行，但同一代码区域的实现应避免多人同时修改。
- QA 应作为 evaluator/optimizer 的一部分，而不是只在最后验收。
- 每个成员必须有输出契约：设计师产出 UI spec，后端产出 API contract，前端产出实现记录，QA 产出验证报告。
- MCP 按角色授权：设计师可用 Figma/视觉对比，前端可用浏览器，后端可用 API/DB 只读检查，QA 可用测试运行和缺陷管理。
- 所有高风险命令、数据库写操作、发布操作需要 human-in-the-loop。

## 反模式

- 为了“看起来像团队”而增加 agent。
- 只有角色名，没有输入输出契约。
- lead 给 subagent 模糊任务。
- 所有成员共享完整上下文，导致注意力污染。
- MCP 工具描述模糊、能力重叠、权限不清。
- 没有 artifact，所有结果只在聊天里传递。
- 没有预算、停止条件、重试策略。
- 用固定路径评估 agent，而不是评估结果质量和合规性。

## 结论

前沿 AI 团队实践正在从“多 agent 对话”转向“可编排、可约束、可观测、可评估的 agent runtime”。对 OpenTeams 来说，团队模板应从成员描述升级为完整的工作系统定义：任务适配、编排模式、成员契约、MCP 权限、产物协议、质量门禁、运行时策略和评估体系。

