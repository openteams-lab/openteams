# AI团队预设与团队协议功能重构方案

## 一、需求概述

1. **提示词外置**：将AI成员预设的提示词从代码中抽离，写成代码内置的md文件
2. **团队协议功能**：在团队设置中添加团队协议并注入到输入中，前端入口在团队公告板
3. **预设窗口独立化**：将团队预设和成员预设窗口从设置中抽离成独立浮层窗口
4. **移除设置中的预设**：从设置对话框中完全移除预设管理功能，统一通过独立浮层窗口访问

---

## 二、现状分析

### 2.1 AI成员预设提示词

**当前实现位置**：`crates/services/src/services/config/versions/v9.rs`

- 使用 `build_role_prompt(role, goal, role_focus, dod)` 函数构建提示词
- 内置 `TEAM_COLLAB_PROTOCOL` 团队协作协议（硬编码字符串）
- 22个内置成员预设，每个预设包含：id、name、description、system_prompt、default_workspace_path
- 提示词结构：
  ```
  You are the team "{role}". {goal}
  
  (Embedded: Team Collaboration Protocol)
  {TEAM_COLLAB_PROTOCOL}
  
  Inputs: ...
  Output format: ...
  Workflow: ...
  Boundaries / Escalation: ...
  Role focus: ...
  Definition of Done: ...
  ```

### 2.2 团队公告板

**当前实现位置**：`frontend/src/pages/ui-new/chat/components/AiMembersSidebar.tsx`

- 位于AI成员侧边栏顶部
- 当前是静态文本，通过i18n显示（`members.teamBulletin.title/content`）
- 可折叠展开
- 使用 `MegaphoneIcon` 图标

### 2.3 自动化按钮

**当前实现位置**：`frontend/src/pages/ui-new/chat/components/SessionListSidebar.tsx`

- 位于会话列表侧边栏
- 使用 `ClockIcon` 图标
- 文案：`sidebar.automation`（"自动化"/"Automations"）
- 点击后触发 `onOpenAutomation` 回调

### 2.4 预设设置窗口

**当前实现位置**：`frontend/src/components/ui-new/dialogs/settings/ChatPresetsSettingsSection.tsx`

- 是设置对话框（SettingsDialog）的一个子组件
- 包含成员预设和团队预设两个标签页
- 支持新增、编辑、复制、禁用、删除预设

### 2.5 角色设定窗口（参考样式）

**实现位置**：`frontend/src/pages/ui-new/chat/components/PromptEditorModal.tsx`

- 独立浮层模态框
- 支持标题、描述、占位符自定义
- 支持文件导入
- 尺寸可配置（default: 800px, compact: 720px）

---

## 三、技术方案

### 3.1 提示词外置为MD文件

#### 3.1.1 文件结构设计

```
crates/services/src/services/config/presets/
├── protocol/
│   └── team_collaboration_protocol.md    # 团队协作协议模板
├── roles/
│   ├── _template.md                       # 角色提示词模板
│   ├── coordinator_pmo.md
│   ├── product_manager.md
│   ├── system_architect.md
│   ├── prompt_engineer.md
│   ├── frontend_engineer.md
│   ├── backend_engineer.md
│   ├── fullstack_engineer.md
│   ├── qa_tester.md
│   ├── ux_ui_designer.md
│   ├── safety_policy_officer.md
│   ├── solution_manager.md
│   ├── code_reviewer.md
│   ├── devops_engineer.md
│   ├── product_analyst.md
│   ├── data_analyst.md
│   ├── technical_writer.md
│   ├── content_researcher.md
│   ├── content_editor.md
│   ├── frontier_researcher.md
│   ├── marketing_specialist.md
│   ├── video_editor.md
│   └── market_analyst.md
└── teams/
    └── _team_template.md                  # 团队预设模板说明
```

#### 3.1.2 MD文件格式设计

**角色提示词模板** (`_template.md`)：
```markdown
---
id: role_id
name: Role Name
description: Role description
default_workspace: workspace_path (optional)
---

# Role: {Role Name}

## Goal
{goal description}

## Role Focus
- Focus area 1
- Focus area 2
- Focus area 3

## Definition of Done
{dod description}
```

**团队协作协议模板** (`team_collaboration_protocol.md`)：
```markdown
# Team Collaboration Protocol

## Communication Format
- @Request: @Role | Task(one line) | Input | Output format | Acceptance | Constraints(optional) | Due(optional)

## Citation Rules
- Cite context: use "CITE#source: content" (priority: msg id > path > commit > link)
- If unsure: "UNSURE: ..."

## Conflict Resolution
- Point | My conclusion | Their conclusion | Shared facts | Assumptions | Verification/experiment | Recommended action
- Unresolved after 2 rounds -> @Coordinator
- Security-related -> @Safety

## Handoff Format
- Start with "DELIVER:" and include Artifact | How to use | Impact | Rollback | Next(<=5)

## Token Efficiency
- Conclusion-first, bullets-first
- Long output = Summary(<=8 lines) + Details
- No full paste, cite sources

## Defaults
- No scope creep
- No implicit privacy/permission
- When info is missing, propose an executable plan + 1-2 key confirmations

## Quality Bar
- Every response includes Conclusion + Evidence/Assumptions + Next Actions(<=5)
```

#### 3.1.3 后端实现

1. **新增模块**：`crates/services/src/services/config/preset_loader.rs`
   - `PresetLoader` 结构体：负责加载和解析MD文件
   - `load_builtin_presets() -> ChatPresetsConfig`：加载所有内置预设
   - `load_team_protocol() -> String`：加载团队协作协议
   - 使用 `include_str!` 宏在编译时嵌入MD文件

2. **修改 `v9.rs`**：
   - 移除硬编码的 `TEAM_COLLAB_PROTOCOL` 和 `build_role_prompt`
   - 调用 `PresetLoader` 加载预设

3. **类型定义**：
   - 新增 `RolePresetMd` 结构体解析MD frontmatter
   - 保持 `ChatMemberPreset` 类型不变

### 3.2 团队协议功能

#### 3.2.1 数据模型扩展

**扩展 `ChatPresetsConfig`**：
```rust
pub struct ChatPresetsConfig {
    pub members: Vec<ChatMemberPreset>,
    pub teams: Vec<ChatTeamPreset>,
    pub team_protocol: Option<String>,  // 新增：团队协议内容
}
```

**或独立存储**：
```rust
pub struct TeamProtocolConfig {
    pub content: String,
    pub enabled: bool,
}
```

#### 3.2.2 前端实现

**团队公告板改造** (`AiMembersSidebar.tsx`)：

1. **UI变更**：
   - 团队公告板内容改为可编辑的团队协议
   - 添加"编辑团队协议"超链接按钮
   - 点击后打开 `TeamProtocolEditorModal`

2. **新增组件**：`TeamProtocolEditorModal.tsx`
   - 参考 `PromptEditorModal.tsx` 样式
   - 支持编辑团队协议内容
   - 支持重置为默认协议
   - 支持启用/禁用协议注入

3. **协议注入逻辑**：
   - 在 `chat_runner.rs` 中，将团队协议注入到每个agent的system prompt
   - 格式：`(Team Protocol)\n{team_protocol}\n\n{original_system_prompt}`

#### 3.2.3 API设计

```
GET  /chat/presets/team-protocol    # 获取团队协议
POST /chat/presets/team-protocol    # 更新团队协议
```

### 3.3 预设窗口独立化

#### 3.3.1 UI变更

**入口按钮改造** (`SessionListSidebar.tsx`)：

1. **图标变更**：`ClockIcon` -> `UsersThreeIcon` 或 `TeamIcon`
2. **文案变更**：`sidebar.automation` -> `sidebar.aiTeam`（"AI团队"）
3. **点击行为**：打开 `AiTeamPresetsModal` 而非自动化功能

**新增组件**：`AiTeamPresetsModal.tsx`

1. **结构设计**：
   ```
   ┌─────────────────────────────────────────────────────┐
   │  AI团队预设                              [关闭]      │
   ├─────────────────────────────────────────────────────┤
   │  [成员预设] [团队预设]                              │
   ├─────────────────────────────────────────────────────┤
   │  ┌──────────────┐  ┌──────────────────────────────┐ │
   │  │ 预设列表     │  │ 预设详情编辑区              │ │
   │  │              │  │                              │ │
   │  │ @coordinator │  │ 名称: [输入框]              │ │
   │  │ @product     │  │ 描述: [输入框]              │ │
   │  │ @architect   │  │ 代理类型: [下拉选择]        │ │
   │  │ ...          │  │ 角色设定: [编辑器]          │ │
   │  │              │  │ 工作区路径: [输入框]        │ │
   │  │ [+ 新增]     │  │                              │ │
   │  └──────────────┘  └──────────────────────────────┘ │
   └─────────────────────────────────────────────────────┘
   ```

2. **功能复用**：
   - 复用 `ChatPresetsSettingsSection.tsx` 的核心逻辑
   - 提取为独立的无状态组件 `PresetEditorPanel`
   - 在设置对话框和独立浮层中复用

#### 3.3.2 组件重构

1. **提取核心组件**：
   - `PresetEditorPanel.tsx`：预设编辑面板（无状态）
   - `MemberPresetEditor.tsx`：成员预设编辑器
   - `TeamPresetEditor.tsx`：团队预设编辑器

2. **新增容器组件**：
   - `AiTeamPresetsModal.tsx`：独立浮层窗口（唯一入口）

3. **移除设置中的预设**：
   - 删除 `ChatPresetsSettingsSection.tsx` 组件
   - 从 `SettingsDialog.tsx` 中移除预设相关的标签页/导航项
   - 更新设置相关的i18n文件，移除预设相关翻译条目

---

## 四、任务拆解

### Phase 1: 提示词外置（后端）

| 任务ID | 任务描述 | 涉及文件 | 预估复杂度 |
|--------|----------|----------|------------|
| 1.1 | 创建MD文件目录结构和模板文件 | `crates/services/src/services/config/presets/` | 中 |
| 1.2 | 实现 `PresetLoader` 模块 | `crates/services/src/services/config/preset_loader.rs` | 高 |
| 1.3 | 迁移22个角色提示词到MD文件 | `presets/roles/*.md` | 中 |
| 1.4 | 迁移团队协作协议到MD文件 | `presets/protocol/team_collaboration_protocol.md` | 低 |
| 1.5 | 修改 `v9.rs` 使用新的加载方式 | `crates/services/src/services/config/versions/v9.rs` | 中 |
| 1.6 | 添加单元测试 | `preset_loader.rs` 内部 | 中 |

### Phase 2: 团队协议功能

| 任务ID | 任务描述 | 涉及文件 | 预估复杂度 |
|--------|----------|----------|------------|
| 2.1 | 扩展数据模型添加 `team_protocol` 字段 | `crates/services/src/services/config/versions/v9.rs`, `shared/types.ts` | 低 |
| 2.2 | 实现团队协议API端点 | `crates/server/src/routes/chat/presets.rs` (新建) | 中 |
| 2.3 | 创建 `TeamProtocolEditorModal` 组件 | `frontend/src/pages/ui-new/chat/components/TeamProtocolEditorModal.tsx` | 中 |
| 2.4 | 改造团队公告板UI | `frontend/src/pages/ui-new/chat/components/AiMembersSidebar.tsx` | 中 |
| 2.5 | 实现协议注入逻辑 | `crates/services/src/chat_runner.rs` | 中 |
| 2.6 | 添加i18n翻译 | `frontend/src/i18n/locales/*/chat.json` | 低 |

### Phase 3: 预设窗口独立化

| 任务ID | 任务描述 | 涉及文件 | 预估复杂度 |
|--------|----------|----------|------------|
| 3.1 | 提取 `PresetEditorPanel` 核心组件 | `frontend/src/components/ui-new/presets/` (新建) | 高 |
| 3.2 | 创建 `AiTeamPresetsModal` 浮层组件 | `frontend/src/pages/ui-new/chat/components/AiTeamPresetsModal.tsx` | 中 |
| 3.3 | 改造入口按钮（图标+文案） | `frontend/src/pages/ui-new/chat/components/SessionListSidebar.tsx` | 低 |
| 3.4 | 从设置对话框中移除预设功能 | `frontend/src/components/ui-new/dialogs/settings/SettingsDialog.tsx`, `ChatPresetsSettingsSection.tsx` (删除) | 中 |
| 3.5 | 清理设置相关i18n翻译 | `frontend/src/i18n/locales/*/settings.json` | 低 |
| 3.6 | 添加i18n翻译 | `frontend/src/i18n/locales/*/chat.json` | 低 |

### Phase 4: 测试与文档

| 任务ID | 任务描述 | 涉及文件 | 预估复杂度 |
|--------|----------|----------|------------|
| 4.1 | 后端单元测试 | `crates/services/src/services/config/` | 中 |
| 4.2 | 前端组件测试 | `frontend/src/components/ui-new/presets/__tests__/` | 中 |
| 4.3 | 更新用户文档 | `docs/zh-Hans/core-features/ai-team-presets.mdx` | 低 |

### 本轮实施进度（2026-03-12）

- [x] `3.4` 从设置对话框中移除预设功能
  - 已从 `SettingsDialog.tsx` 和 `SettingsSection.tsx` 移除 `presets` 导航项与内容分支
  - 已将 `ChatPresetsSettingsSection.tsx` 迁移为独立的 `frontend/src/components/ui-new/presets/ChatPresetsEditorPanel.tsx`
  - `AiTeamPresetsModal.tsx` 已改为复用新的独立编辑器组件，不再依赖设置页入口
- [x] `3.5` 清理设置相关 i18n 翻译
  - 已删除各语言 `settings.layout.nav.presets` / `settings.layout.nav.presetsDesc`
  - 已将聊天侧“无可用预设”提示改为指向新的 `AI Team` 入口，避免继续指向旧的 Settings -> Presets

---

## 五、技术风险与缓解措施

### 5.1 提示词外置风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 编译时嵌入MD文件增加二进制体积 | 低 | MD文件总大小约50KB，影响可忽略 |
| MD解析错误导致启动失败 | 高 | 添加解析错误处理，使用默认值兜底 |
| 运行时无法修改内置提示词 | 中 | 这是设计目标，保持一致性 |

### 5.2 团队协议风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 协议内容过长影响token消耗 | 中 | 添加字符限制提示，支持压缩模式 |
| 协议注入位置不当影响agent行为 | 高 | 在system prompt开头注入，确保优先级 |

### 5.3 UI重构风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 组件提取影响现有功能 | 中 | 保持原有组件接口，渐进式重构 |
| 用户习惯改变 | 低 | 提供过渡提示，保持功能一致性 |
| 设置中移除预设导致用户困惑 | 中 | 在设置中添加引导提示，指向新的"AI团队"入口 |

---

## 六、依赖关系

```
Phase 1 (提示词外置)
    │
    ├──→ Phase 2 (团队协议) ──→ Phase 2.5 (协议注入) 依赖 Phase 1.4
    │
    └──→ Phase 3 (预设窗口独立化)
            │
            ├──→ 3.1 (提取核心组件) ──→ 3.2 (创建浮层)
            │
            └──→ 3.2 (创建浮层) ──→ 3.4 (移除设置中的预设)
```

---

## 七、验收标准

### 7.1 提示词外置

- [x] 所有22个角色提示词已迁移到MD文件
- [x] 团队协作协议已迁移到MD文件
- [x] 后端启动时正确加载所有预设
- [x] 现有功能无回归

### 7.2 团队协议

- [x] 团队公告板显示"编辑团队协议"链接
- [x] 点击链接打开团队协议编辑窗口
- [x] 编辑后保存成功
- [x] 协议正确注入到agent的system prompt

### 7.3 预设窗口独立化

- [x] "自动化"按钮已改为"AI团队"按钮
- [x] 图标已更换为团队相关图标
- [x] 点击按钮打开独立的预设管理浮层
- [x] 浮层内可完整管理成员预设和团队预设
- [x] 设置对话框中已移除预设相关功能
- [x] `ChatPresetsSettingsSection.tsx` 组件已删除

---

## 八、后续优化建议

1. **预设市场**：支持导入/导出预设配置，分享给其他用户
2. **协议模板**：提供多种团队协议模板供选择
3. **协议变量**：支持在协议中使用变量（如项目名、团队名）
4. **预设版本控制**：支持预设配置的版本回滚

---

## 九、本轮实现进度（2026-03-12）

### 已完成（Phase 3 全部 + Phase 1 全部 + Phase 2 全部）

- [x] 3.1 提取 `PresetEditorPanel` 核心组件
- [x] 3.2 创建 `AiTeamPresetsModal.tsx`，提供独立的 AI 团队预设浮层，并复用现有预设管理能力
- [x] 3.3 改造 `SessionListSidebar.tsx` 的入口按钮，文案从"自动化"调整为"AI团队"，图标切换为团队图标并接入新浮层
- [x] 3.4 从设置对话框中移除预设入口（已删除 `ChatPresetsSettingsSection.tsx`）
- [x] 3.5 清理设置相关 i18n（已删除各语言 `settings.layout.nav.presets` 等）
- [x] 1.1 创建 `crates/services/src/services/config/presets/` 目录结构与模板文件
- [x] 1.2 实现 `crates/services/src/services/config/preset_loader.rs`，以 `include_str!` 编译时内嵌方式加载内置预设
- [x] 1.3 将 22 个内置角色提示词迁移到 `crates/services/src/services/config/presets/roles/*.md`
- [x] 1.4 将团队协作协议迁移到 `crates/services/src/services/config/presets/protocol/team_collaboration_protocol.md`
- [x] 1.5 修改 `crates/services/src/services/config/versions/v9.rs`，移除硬编码角色提示词与协议内容，改为通过 `PresetLoader` 生成内置成员预设
- [x] 1.6 添加 `PresetLoader` 单元测试，并验证 `cargo test -p services preset_loader` 与 `cargo check -p services` 通过
- [x] 2.1 扩展 `ChatPresetsConfig`，新增 `team_protocol` 字段并生成 `shared/types.ts`
- [x] 2.2 新增 `GET/POST /chat/presets/team-protocol` 路由，支持读取与保存团队协议
- [x] 2.3 创建 `TeamProtocolEditorModal.tsx`，支持启用/禁用与内容编辑
- [x] 2.4 改造 `AiMembersSidebar.tsx`，将团队公告板接入真实团队协议内容、加载态、错误态与编辑入口
- [x] 2.5 在 `chat_runner.rs` 中将团队协议注入到 agent 的 system prompt，并补充注入单测
- [x] 2.6 补充 `frontend/src/i18n/locales/*/chat.json` 文案，并修复预设保存时对 `team_protocol` 的保留逻辑
- [x] 验证通过：`pnpm run generate-types`、`cargo test -p services preset_loader`、`cargo test -p services inject_team_protocol`、`cargo check -p server`、`pnpm run check`

### 下一批待执行（Phase 4）

**Phase 4（测试与文档）**：
- 4.1 后端单元测试
- 4.2 前端组件测试
- 4.3 更新用户文档
