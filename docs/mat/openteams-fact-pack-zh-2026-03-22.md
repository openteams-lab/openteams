---
title: "OpenTeams 事实清单"
description: "基于当前仓库整理的 OpenTeams 核心能力、差异点、适用场景与可验证技术特征。"
---

# OpenTeams 事实清单

说明：以下内容仅基于当前仓库可见证据整理，优先采用代码、测试、嵌入资源与路由定义；README 级表述会单独标注。置信度分为 `高` / `中` / `需谨慎`。

## 适合先抓的结论

- OpenTeams 的产品核心不是“给单个 Agent 加一个聊天框”，而是把 `session`、`session agent`、`message`、`run`、`skill`、`work item` 做成了一整套多 Agent 协作系统。证据见 `crates/server/src/routes/chat/mod.rs:16` 与多张 chat 相关模型。
- 它的差异化重点是“共享上下文 + 多成员协作 + 运行过程可追踪”，而不只是多开几个独立 Agent 窗口。证据见 `crates/services/src/services/chat_runner.rs:263`、`crates/server/src/routes/chat/runs.rs:29`、`crates/server/src/routes/chat/runs.rs:96`。
- 当前仓库可强验证的内置资源规模是 `166` 个成员预设、`8` 个团队预设、`865` 个内置技能；其中“1000+ 技能”是 README 文案，不是当前仓库里的硬计数。证据见 `crates/services/src/services/config/preset_loader.rs:917`、`crates/services/src/services/config/preset_loader.rs:918`、`assets/skills/skills_registry.json:3`。

## 一、核心能力

### 1) 多 Agent 会话与共享上下文

- 事实：后端把会话、成员、消息、运行、技能、工作项分别建模，并提供完整 `/chat` API。
- 证据：`crates/server/src/routes/chat/mod.rs:16` 到 `crates/server/src/routes/chat/mod.rs:167`；`crates/db/src/models/chat_session.rs:17`；`crates/db/src/models/chat_session_agent.rs:33`；`crates/db/src/models/chat_run.rs:8`。
- 置信度：`高`
- 文章可用：`是`。适合写成“不是单 Agent 对话框，而是团队会话系统”。

### 2) 实时协作流

- 事实：会话支持 WebSocket 流式事件，事件类型覆盖新消息、工作项、Agent 增量输出、Agent 状态、@mention 确认、协议通知、压缩警告、mention 错误。
- 证据：`crates/services/src/services/chat_runner.rs:263`；`crates/server/src/routes/chat/sessions.rs:541`。
- 置信度：`高`
- 文章可用：`是`。适合写成“多成员协作不是轮询刷新，而是实时同步”。

### 3) 多运行时 Agent 协同

- 事实：代码枚举里定义了 `ClaudeCode`、`Amp`、`Gemini`、`Codex`、`Opencode`、`OpenTeamsCli`、`CursorAgent`、`QwenCode`、`Copilot`、`Droid`、`KimiCode` 共 11 个执行器变体。
- 证据：`crates/executors/src/executors/mod.rs:114` 到 `crates/executors/src/executors/mod.rs:128`。
- 置信度：`高`
- 文章可用：`是`。建议写法用“支持多种 coding-agent 运行时”，不要只写模糊的“全模型兼容”。
- 备注：README 的外部运行时清单写的是 10 个，代码里另有 `OpenTeamsCli` 包装执行器，因此口径最好写“至少 10 个外部运行时，代码层另含 OpenTeams 自身执行器包装”。

### 4) 预设成员与团队导入

- 事实：内置预设加载器直接从嵌入式 markdown 读取成员预设和团队预设；测试显式断言当前共有 `166` 个成员预设、`8` 个团队预设。
- 证据：`crates/services/src/services/config/preset_loader.rs:747`；`crates/services/src/services/config/preset_loader.rs:917`；`crates/services/src/services/config/preset_loader.rs:918`。
- 置信度：`高`
- 文章可用：`是`。适合写成“开箱即用的角色团队”，且这个数字现在能被仓库验证。

### 5) 技能系统与本地回退

- 事实：技能既可来自远端 registry，也可从仓库嵌入的 `assets/skills` 离线安装；统计文件当前记录 `865` 个内置技能。
- 证据：`crates/services/src/services/skill_registry.rs:36` 到 `crates/services/src/services/skill_registry.rs:60`；`assets/skills/skills_registry.json:3`；`crates/server/src/routes/chat/skills.rs:343`。
- 置信度：`高`
- 文章可用：`是`，但数字应写 `865` 或“数百个”，不要直接写“1000+”。

### 6) 运行可追踪：日志 / diff / 未跟踪文件

- 事实：每次 Agent 运行都会落到 `ChatRun`，并暴露日志、diff、未跟踪文件读取接口；runner 还会调用 git 抓取 diff 和 untracked 文件快照。
- 证据：`crates/db/src/models/chat_run.rs:8`；`crates/server/src/routes/chat/runs.rs:29`；`crates/server/src/routes/chat/runs.rs:96`；`crates/server/src/routes/chat/runs.rs:134`；`crates/services/src/services/chat_runner.rs:1383`；`crates/services/src/services/chat_runner.rs:1450`。
- 置信度：`高`
- 文章可用：`是`。这是非常适合渲染的“可审计协作”卖点。

### 7) 会话归档 / 恢复

- 事实：会话支持归档与恢复；归档时会导出 `messages_export.jsonl` 和 `session_summary.md`。
- 证据：`crates/server/src/routes/chat/mod.rs:24`；`crates/server/src/routes/chat/mod.rs:25`；`crates/services/src/services/chat.rs:616` 到 `crates/services/src/services/chat.rs:639`。
- 置信度：`高`
- 文章可用：`是`。适合放在“长期项目协作可沉淀”里。

### 8) 团队协作协议

- 事实：会话层有 `team_protocol` 和 `team_protocol_enabled`，团队预设也可携带协议文本；prompt 构建时会把群组成员、共享黑板、工作记录和输出协议一起注入。
- 证据：`crates/db/src/models/chat_session.rs:17`；`crates/services/src/services/config/versions/v9.rs:58`；`crates/server/src/routes/chat/mod.rs:63`；`crates/services/src/services/chat_runner.rs:1869` 到 `crates/services/src/services/chat_runner.rs:1995`。
- 置信度：`高`
- 文章可用：`是`。这点能把它和“随便拉几个 Agent 一起跑”区分开。

## 二、差异点提炼

### 更像“多 Agent 协作操作系统”，不是“多窗口管理器”

- 依据：数据库与 API 里把团队协作要素拆成一等对象，而不是把所有行为揉进单次 prompt。
- 支撑：`ChatSession`、`ChatSessionAgent`、`ChatMessage`、`ChatRun`、`ChatSkill`、`ChatWorkItem` 等模型都独立存在。
- 文章可用：`强烈推荐`。

### 既能跨 Agent 类型协同，也能用预设角色快速搭班子

- 依据：执行器枚举支持多种 coding agent；预设系统直接内嵌成员角色与团队组合。
- 支撑：`crates/executors/src/executors/mod.rs:114`；`crates/services/src/services/config/preset_loader.rs:747`。
- 文章可用：`推荐`。

### 强调过程可见，而不是只看最终答案

- 依据：有运行日志、diff、未跟踪文件、工作记录、共享黑板、work item 流。
- 支撑：`crates/server/src/routes/chat/runs.rs:29`；`crates/services/src/services/chat_runner.rs:1204`；`crates/services/src/services/chat_runner.rs:1208`；`crates/services/src/services/chat_runner.rs:267`。
- 文章可用：`强烈推荐`。

## 三、适合的使用场景

- 复杂研发任务：需要架构、前端、后端、测试并行推进，并且希望留存过程证据。
- 内容生产团队：仓库内置了 `content_researcher`、`content_editor`、`marketing_specialist`、`video_editor` 等角色预设，说明其目标不只限于纯编程。证据见 `crates/services/src/services/config/preset_loader.rs:71`、`crates/services/src/services/config/preset_loader.rs:75`、`crates/services/src/services/config/preset_loader.rs:87`、`crates/services/src/services/config/preset_loader.rs:91`。
- 对本地数据敏感的代码仓协作：上下文和运行记录会写入工作区 `.openteams/` 目录，适合强调本地可控与可审计。证据见 `crates/services/src/services/chat_runner.rs:1182`、`crates/services/src/services/chat_runner.rs:1539`。
- 长周期项目沉淀：支持归档、恢复、摘要导出，适合持续项目协作而非一次性问答。证据见 `crates/services/src/services/chat.rs:616`。

## 四、可验证技术特征

- 工作区隔离：`ChatSessionAgent` 自带 `workspace_path`，并可单独配置 `allowed_skill_ids`。证据：`crates/db/src/models/chat_session_agent.rs:38` 到 `crates/db/src/models/chat_session_agent.rs:45`。
- 技能白名单过滤：runner 在执行前会按 `allowed_skill_ids` 过滤启用技能。证据：`crates/services/src/services/chat_runner.rs:1271` 到 `crates/services/src/services/chat_runner.rs:1289`。
- 上下文快照落盘：会话历史写入 `<workspace>/.openteams/context/<session_id>/messages.jsonl`。证据：`crates/services/src/services/chat_runner.rs:1539` 到 `crates/services/src/services/chat_runner.rs:1562`。
- 运行记录落盘：运行记录目录位于 `<workspace>/.openteams/runs/<session_id>/run_records`。证据：`crates/services/src/services/chat_runner.rs:1182` 到 `crates/services/src/services/chat_runner.rs:1190`。
- 权限对象已建模：存在 `ChatPermission`，带 `capability`、`scope`、`ttl_type`、`expires_at`。证据：`crates/db/src/models/chat_permission.rs:17` 到 `crates/db/src/models/chat_permission.rs:29`。
- 上下文压缩配置：配置结构里已有 token threshold 与 compression percentage。证据：`crates/services/src/services/config/versions/v9.rs:91` 到 `crates/services/src/services/config/versions/v9.rs:117`。

## 五、哪些点适合写进渲染文章

### 可以大胆写

- “多 Agent 共享会话，而不是复制粘贴 prompt 的多窗口作业。”
- “支持多类 coding agent 混编协作，并可用预设团队快速启动。”
- “运行过程可追踪：日志、diff、未跟踪文件、工作记录都有落盘与接口。”
- “团队协议可以进入系统，而不只是靠人手动提醒协作规则。”
- “成员预设和团队预设规模已经达到可直接开箱使用的程度。”

### 需要谨慎写

- “1000+ 内置技能”：当前 README 这么写，但仓库内置统计文件是 `865`；除非文章明确引用 README 宣传口径，否则不建议直接写。
- “完全本地、绝对隐私安全”：README 有本地执行表述，但“绝对安全”属于超出仓库可验证边界的推断，不建议扩大。
- “所有 Agent 都能完全等价协作”：代码里不同执行器能力并不完全一致，例如 `capabilities()` 针对不同执行器返回值不同。证据：`crates/executors/src/executors/mod.rs:192`。

## 六、可直接供编辑改写的短句

- OpenTeams 更像一个多 Agent 协作层，把成员、消息、运行、技能和工作项都纳入同一会话系统。
- 它的关键价值不只是“多开几个 AI”，而是让不同 Agent 在共享上下文里协同，并留下可回放、可审计的执行痕迹。
- 从当前仓库看，它已经具备角色预设、团队预设、技能安装、会话归档、运行 diff 与工作区落盘等成体系能力。
