---
title: "OpenTeams 文章勘误清单"
description: "针对剩余 3 篇文章的一轮事实核验与可直接执行的修改建议。"
---

# OpenTeams 剩余 3 篇文章勘误清单

适用范围：

- `docs/marketing-article-drafts-zh-2026-03-22.md` 的“文章一”
- `docs/marketing-article-drafts-zh-2026-03-22.md` 的“文章二”
- `docs/zh-Hans/articles/openteams-not-just-more-ai-tabs.mdx`

核验基线：

- 可直接引用的硬证据以 `crates/server/src/routes/chat/mod.rs`、`crates/services/src/services/chat_runner.rs`、`crates/services/src/services/chat.rs`、`crates/services/src/services/skill_registry.rs`、`crates/services/src/services/config/preset_loader.rs`、`assets/skills/skills_registry.json` 为主。
- 当前仓库可强验证的资源规模：`166` 个成员预设、`8` 个团队预设、`865` 个内置技能。

## 一、通用勘误

### 1. 把所有 `1000+ 技能` 改掉

- 优先级：`高`
- 原因：当前仓库硬计数是 `865`，`1000+` 只存在于 README 宣传口径，不适合作为正文事实表述。
- 统一替换建议：
  - 保守写法：`数百个内置技能`
  - 精确写法：`当前仓库内置技能统计为 865 个`
- 证据：`assets/skills/skills_registry.json:3`

### 2. 把所有直接承诺型效果词降级

- 优先级：`高`
- 原因：`真正翻倍`、`第一次真正拥有`、`必须` 这类字眼属于效果判断，不是仓库可验证能力。
- 统一替换建议：
  - `速度才会真正翻倍` -> `更容易进入并行推进状态`
  - `第一次真正拥有` -> `更接近拥有`
  - `必须` -> `值得` / `更适合`

### 3. 运行时数量口径改成更稳妥的写法

- 优先级：`中`
- 原因：README 列 10 个外部 coding-agent 运行时；代码枚举里另含 `OpenTeamsCli` 包装执行器，共 11 个执行器变体。直接写死“支持 10 种编程 Agent 运行时”容易和代码口径打架。
- 统一替换建议：
  - `支持多种 coding-agent 运行时，README 当前列出 10 种外部运行时`
  - 或 `支持至少 10 种常见 coding-agent 运行时`
- 证据：`README.md:77`；`crates/executors/src/executors/mod.rs:114`

### 4. 关于 `.openteams/` 的描述收紧到“上下文快照与 run 记录”

- 优先级：`中`
- 原因：可强验证的是会话上下文快照和 run 记录落到工作区 `.openteams/`；不要泛化成“所有协作数据都只在这里”。
- 统一替换建议：
  - `会话上下文快照与运行记录会写入工作区 .openteams/`
  - `日志、diff、未跟踪文件可通过 run 记录与接口查看`
- 证据：`crates/services/src/services/chat_runner.rs:1539`；`crates/services/src/services/chat_runner.rs:961`；`crates/server/src/routes/chat/runs.rs:29`

## 二、逐篇可执行勘误

## A. `docs/marketing-article-drafts-zh-2026-03-22.md` 文章一

### A1. 标题里的“真正翻倍”需要降级

- 位置：`docs/marketing-article-drafts-zh-2026-03-22.md:6`
- 问题：仓库没有任何可验证的效率倍数数据。
- 建议改成：`别再让 AI 单打独斗：把多个智能体拉进同一个团队，项目推进才有机会真正并行起来`

### A2. 开头段可保留，但建议把“第一次真正拥有一支 AI 小组”收紧

- 位置：`docs/marketing-article-drafts-zh-2026-03-22.md:9`
- 问题：这是渲染表达，不是仓库可验证事实。
- 建议改成：`让团队更接近拥有一支可以协同作战的 AI 小组`

### A3. “多模型协作”可保留，但建议补成“多运行时/多 Agent 协作”

- 位置：`docs/marketing-article-drafts-zh-2026-03-22.md:16`
- 问题：仓库更直接证明的是多 Agent / 多运行时协作，不是抽象的“多模型编排”。
- 建议改成：`多 Agent、跨运行时协作意味着你不用把所有任务都押在一个 Agent 身上`

### A4. 卖点列表里的技能数字需要改

- 位置：`docs/marketing-article-drafts-zh-2026-03-22.md:47` 到 `docs/marketing-article-drafts-zh-2026-03-22.md:50`
- 问题：`1000+ 技能` 与仓库硬计数不符；`10 种编程 Agent 运行时` 建议改口径。
- 建议改成：
  - `支持多种 coding-agent 运行时，README 当前列出 10 种外部运行时。`
  - `支持共享群聊上下文、并行执行、@mention 交接。`
  - `当前仓库可验证为 166 个内置 AI 成员、8 个团队预设、865 个内置技能。`
  - `运行过程可查看日志、diff、未跟踪文件，并支持会话归档与恢复。`

## B. `docs/marketing-article-drafts-zh-2026-03-22.md` 文章二

### B1. 标题里的“必须”建议降级

- 位置：`docs/marketing-article-drafts-zh-2026-03-22.md:57`
- 问题：这是判断句，不是仓库可验证事实。
- 建议改成：`从“结果可用”到“过程可见”：为什么下一代 AI 团队平台会越来越看重执行过程展示`

### B2. “阶段性产物”建议对应到仓库里的具体对象

- 位置：`docs/marketing-article-drafts-zh-2026-03-22.md:60`
- 问题：正文建议更明确锚定到消息、run、日志、diff、work records，减少抽象描述。
- 建议补一句：`在仓库实现上，这些留痕具体对应消息记录、ChatRun、日志、diff、未跟踪文件和 work records。`

### B3. `.openteams/` 句子建议更精确

- 位置：`docs/marketing-article-drafts-zh-2026-03-22.md:94`
- 问题：当前说法略泛。
- 建议改成：`会话上下文快照与运行记录会写入工作区的 .openteams/ 目录，日志、diff 与未跟踪文件可通过 run 接口读取。`

## C. `docs/zh-Hans/articles/openteams-not-just-more-ai-tabs.mdx`

### C1. “运行时数据落在工作区里的 .openteams/ 目录”建议改成“关键上下文与 run 记录”

- 位置：`docs/zh-Hans/articles/openteams-not-just-more-ai-tabs.mdx:89`
- 问题：当前表述偏大，建议锚定到代码里确定存在的对象。
- 建议改成：`OpenTeams 的聊天系统不只是保留消息，还会记录运行相关的日志、diff、上下文快照和工作记录；其中会话上下文与 run 记录会写入工作区里的 .openteams/ 目录。`

### C2. ASCII 目录树建议把“产物路径”口径统一为已验证文件名

- 位置：`docs/zh-Hans/articles/openteams-not-just-more-ai-tabs.mdx:102` 到 `docs/zh-Hans/articles/openteams-not-just-more-ai-tabs.mdx:115`
- 问题：当前树基本方向正确，但为了完全贴合仓库，建议统一成代码里真实出现的文件名。
- 建议改成：

```text
<workspace>/
`-- .openteams/
    +-- context/<session_id>/
    |   +-- messages.jsonl
    |   +-- shared_blackboard.jsonl
    |   `-- work_records.jsonl
    `-- runs/<session_id>/run_records/
        `-- session_agent_<session_agent_id>_run_0001/
            +-- input.md
            +-- output.md
            +-- raw.log
            +-- meta.json
            `-- diff.patch
```

- 证据：`crates/services/src/services/chat_runner.rs:976` 到 `crates/services/src/services/chat_runner.rs:990`

### C3. 资源规模句里的 `1000+ 技能库` 需要改

- 位置：`docs/zh-Hans/articles/openteams-not-just-more-ai-tabs.mdx:148`
- 问题：与当前仓库硬计数不符。
- 建议改成：`还有 160+ 内置 AI 成员、8 个团队预设，以及当前仓库可验证为 865 个内置技能。`

### C4. “任务交接不再全部依赖用户自己转发”可以更贴近代码链路

- 位置：`docs/zh-Hans/articles/openteams-not-just-more-ai-tabs.mdx:77`
- 问题：原意正确，但若想更严谨，可以补到“系统支持按 mention 路由并回传状态”。
- 建议改成：`OpenTeams 允许成员在会话里互相 @mention，系统会按 mention 路由到对应成员，并回传 received/running/completed/failed 等状态。`
- 证据：`crates/services/src/services/chat_runner.rs:285`；`crates/services/src/services/chat_runner.rs:937`；`crates/services/src/services/chat_runner.rs:4677`

## 三、可直接统一替换的安全表述

- `1000+ 技能` -> `数百个内置技能` 或 `当前仓库可验证为 865 个内置技能`
- `支持 10 种编程 Agent 运行时` -> `支持多种 coding-agent 运行时`
- `运行时数据都保存在 .openteams/` -> `会话上下文快照与 run 记录会写入 .openteams/`
- `速度真正翻倍` -> `更容易并行推进`
- `必须把执行过程展示出来` -> `会越来越重视执行过程展示`

## 四、核验结论

- 三篇里最需要立即修的点只有两个：`1000+ 技能` 和 `效果承诺型措辞`。
- 多 Agent 协作、共享上下文、@mention 链路、运行记录、归档恢复、工作区 `.openteams/`、团队预设与团队协议，这些主干叙述都能在当前仓库里找到支撑。
- 如果编辑要最快完成定稿，建议先统一替换数字与口径，再做标题降火处理，最后补上 1 到 2 处更贴代码实现的句子即可。
