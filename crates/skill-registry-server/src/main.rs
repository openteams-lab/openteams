//! Skill Registry Server
//!
//! A standalone server that provides skill download services for AI agents.

use axum::{
    extract::{Path, Query},
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

/// Skill metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: Option<String>, 
    pub version: String,
    pub author: Option<String>,
    pub tags: Vec<String>,
    pub compatible_agents: Vec<String>,
    pub source_url: Option<String>,
}

/// Full skill package with content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillPackage {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: Option<String>,
    pub version: String,
    pub author: Option<String>,
    pub tags: Vec<String>,
    pub compatible_agents: Vec<String>,
    pub source_url: Option<String>,
    pub content: String,
}

/// Skill category
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillCategory {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

/// Search query parameters
#[derive(Debug, Deserialize)]
struct SearchQuery {
    search: Option<String>,
    category: Option<String>,
}

/// Application state
struct AppState {
    skills: Vec<SkillPackage>,
    categories: Vec<SkillCategory>,
}

/// Get sample skills data
fn get_sample_skills() -> Vec<SkillPackage> {
    vec![
        // === Original Skills ===
        SkillPackage {
            id: "code-review".to_string(),
            name: "代码审查".to_string(),
            description: "专业的代码审查技能，帮助发现代码中的问题并提供改进建议".to_string(),
            category: Some("development".to_string()),
            version: "1.0.0".to_string(),
            author: Some("AgentsChatGroup Team".to_string()),
            tags: vec!["review".to_string(), "quality".to_string(), "code".to_string()],
            compatible_agents: vec![
                "claude-code".to_string(),
                "codex".to_string(),
                "qwen".to_string(),
                "cursor".to_string(),
            ],
            source_url: Some("https://skills.agentschatgroup.com/api/skills/code-review".to_string()),
            content: r#"# 代码审查技能

你是一位专业的代码审查专家。在审查代码时，请关注以下方面：

## 审查重点

1. **代码质量**
   - 代码可读性
   - 命名规范
   - 注释完整性
   - 代码结构清晰度

2. **潜在问题**
   - 安全漏洞
   - 性能问题
   - 内存泄漏风险
   - 并发问题

3. **最佳实践**
   - 是否遵循项目规范
   - 是否有更好的实现方式
   - 是否需要重构

## 输出格式

请使用以下格式输出审查结果：

\`\`\`
### 代码审查报告

**总体评分**: X/10

**问题列表**:
1. [严重程度] 问题描述
   - 位置: 文件:行号
   - 建议: 修复建议

**优点**:
- ...

**改进建议**:
- ...
\`\`\`
"#.to_string(),
        },
        SkillPackage {
            id: "security-scan".to_string(),
            name: "安全扫描".to_string(),
            description: "自动检测代码中的安全漏洞和风险".to_string(),
            category: Some("security".to_string()),
            version: "1.0.0".to_string(),
            author: Some("AgentsChatGroup Team".to_string()),
            tags: vec!["security".to_string(), "vulnerability".to_string(), "scan".to_string()],
            compatible_agents: vec![
                "claude-code".to_string(),
                "codex".to_string(),
                "qwen".to_string(),
            ],
            source_url: Some("https://skills.agentschatgroup.com/api/skills/security-scan".to_string()),
            content: r#"# 安全扫描技能

你是一位专业的安全分析师。在扫描代码时，请关注以下安全风险：

## 扫描重点

1. **注入漏洞**
   - SQL 注入
   - XSS 跨站脚本
   - 命令注入
   - LDAP 注入

2. **认证与授权**
   - 弱密码策略
   - 会话管理问题
   - 权限绕过风险

3. **数据安全**
   - 敏感数据泄露
   - 加密不足
   - 不安全的数据存储

4. **配置安全**
   - 默认配置风险
   - 不安全的 HTTP 头
   - 错误信息泄露

## 输出格式

```
### 安全扫描报告

**风险等级**: 高/中/低

**发现的漏洞**:
1. [漏洞类型] 漏洞名称
   - 位置: 文件:行号
   - 风险等级: 高/中/低
   - 描述: 详细描述
   - 修复建议: 如何修复

**安全评分**: X/100
```
"#.to_string(),
        },
        SkillPackage {
            id: "test-generator".to_string(),
            name: "测试生成".to_string(),
            description: "自动生成单元测试和集成测试".to_string(),
            category: Some("testing".to_string()),
            version: "1.0.0".to_string(),
            author: Some("AgentsChatGroup Team".to_string()),
            tags: vec!["test".to_string(), "unit-test".to_string(), "coverage".to_string()],
            compatible_agents: vec![
                "claude-code".to_string(),
                "codex".to_string(),
                "qwen".to_string(),
                "cursor".to_string(),
            ],
            source_url: Some("https://skills.agentschatgroup.com/api/skills/test-generator".to_string()),
            content: r#"# 测试生成技能

你是一位专业的测试工程师。在生成测试时，请遵循以下原则：

## 测试原则

1. **覆盖率优先**
   - 正常路径测试
   - 边界条件测试
   - 异常情况测试
   - 错误处理测试

2. **测试结构**
   - Arrange: 准备测试数据
   - Act: 执行被测代码
   - Assert: 验证结果

3. **测试命名**
   - test_[方法名]_[场景]_[预期结果]
   - 描述性的测试名称

## 输出格式

```typescript
describe('ClassName', () => {
  describe('methodName', () => {
    it('should return expected result when given valid input', () => {
      // Arrange
      const input = 'valid input';
      
      // Act
      const result = method(input);
      
      // Assert
      expect(result).toBe('expected output');
    });

    it('should throw error when given invalid input', () => {
      // Arrange
      const input = null;
      
      // Act & Assert
      expect(() => method(input)).toThrow();
    });
  });
});
```

## 测试类型

- 单元测试: 测试单个函数/方法
- 集成测试: 测试模块间交互
- E2E测试: 测试完整流程
"#.to_string(),
        },
        SkillPackage {
            id: "doc-writer".to_string(),
            name: "文档编写".to_string(),
            description: "自动生成 API 文档和代码注释".to_string(),
            category: Some("documentation".to_string()),
            version: "1.0.0".to_string(),
            author: Some("AgentsChatGroup Team".to_string()),
            tags: vec!["docs".to_string(), "api".to_string(), "comments".to_string()],
            compatible_agents: vec![
                "claude-code".to_string(),
                "codex".to_string(),
                "qwen".to_string(),
            ],
            source_url: Some("https://skills.agentschatgroup.com/api/skills/doc-writer".to_string()),
            content: r#"# 文档编写技能

你是一位技术文档专家。在编写文档时，请遵循以下规范：

## 文档类型

1. **API 文档**
   - 端点描述
   - 请求参数
   - 响应格式
   - 示例代码

2. **代码注释**
   - 函数说明
   - 参数描述
   - 返回值说明
   - 使用示例

3. **README 文档**
   - 项目介绍
   - 安装说明
   - 使用指南
   - 贡献指南

## API 文档格式

```markdown
## API 端点名称

**端点**: `POST /api/endpoint`

### 描述
简要描述此端点的功能。

### 请求参数

| 参数名 | 类型 | 必填 | 描述 |
|--------|------|------|------|
| param1 | string | 是 | 参数描述 |

### 请求示例

\`\`\`json
{
  "param1": "value1"
}
\`\`\`

### 响应

| 状态码 | 描述 |
|--------|------|
| 200 | 成功 |
| 400 | 参数错误 |

### 响应示例

\`\`\`json
{
  "status": "success",
  "data": {}
}
\`\`\`
```
"#.to_string(),
        },
        SkillPackage {
            id: "refactor".to_string(),
            name: "代码重构".to_string(),
            description: "智能代码重构和优化建议".to_string(),
            category: Some("development".to_string()),
            version: "1.0.0".to_string(),
            author: Some("AgentsChatGroup Team".to_string()),
            tags: vec!["refactor".to_string(), "optimize".to_string(), "clean-code".to_string()],
            compatible_agents: vec![
                "claude-code".to_string(),
                "codex".to_string(),
                "qwen".to_string(),
                "cursor".to_string(),
            ],
            source_url: Some("https://skills.agentschatgroup.com/api/skills/refactor".to_string()),
            content: r#"# 代码重构技能

你是一位经验丰富的软件架构师。在重构代码时，请遵循以下原则：

## 重构原则

1. **SOLID 原则**
   - 单一职责原则 (SRP)
   - 开闭原则 (OCP)
   - 里氏替换原则 (LSP)
   - 接口隔离原则 (ISP)
   - 依赖倒置原则 (DIP)

2. **DRY 原则**
   - 消除重复代码
   - 提取公共方法
   - 使用继承和组合

3. **KISS 原则**
   - 保持简单
   - 避免过度设计
   - 代码可读性优先

## 重构技巧

1. **提取方法**
   - 长方法拆分
   - 有意义的命名

2. **简化条件**
   - 使用早返回
   - 提取条件判断

3. **消除魔法数**
   - 使用常量
   - 有意义的命名

## 输出格式

```
### 重构建议

**重构类型**: 提取方法/简化条件/...

**原代码**:
[展示原代码片段]

**问题分析**:
- 问题描述

**重构后**:
[展示重构后代码]

**改进点**:
- 改进说明
```
"#.to_string(),
        },
        SkillPackage {
            id: "git-commit".to_string(),
            name: "Git 提交助手".to_string(),
            description: "自动生成规范的 Git 提交信息".to_string(),
            category: Some("development".to_string()),
            version: "1.0.0".to_string(),
            author: Some("AgentsChatGroup Team".to_string()),
            tags: vec!["git".to_string(), "commit".to_string(), "conventional".to_string()],
            compatible_agents: vec![
                "claude-code".to_string(),
                "codex".to_string(),
                "qwen".to_string(),
            ],
            source_url: Some("https://skills.agentschatgroup.com/api/skills/git-commit".to_string()),
            content: r#"# Git 提交助手技能

你是一位 Git 提交信息专家。在生成提交信息时，请遵循 Conventional Commits 规范：

## 提交格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

## 提交类型

| 类型 | 描述 |
|------|------|
| feat | 新功能 |
| fix | Bug 修复 |
| docs | 文档更新 |
| style | 代码格式（不影响功能） |
| refactor | 重构（不是新功能也不是修复） |
| perf | 性能优化 |
| test | 添加测试 |
| chore | 构建/工具变更 |
| ci | CI 配置变更 |
| revert | 回滚提交 |

## 示例

### 简单提交
```
feat(auth): add login with OAuth2 support
```

### 复杂提交
```
feat(api): add user profile endpoints

Add GET /api/users/:id/profile and PUT /api/users/:id/profile
endpoints for user profile management.

- Add profile validation
- Add avatar upload support
- Add profile image cropping

Closes #123
```

## 最佳实践

1. 使用祈使句（"add" 而不是 "added"）
2. 首行不超过 50 字符
3. 主体内容每行不超过 72 字符
4. 用主体解释 what 和 why，而不是 how
"#.to_string(),
        },
        SkillPackage {
            id: "api-design".to_string(),
            name: "API 设计".to_string(),
            description: "RESTful API 设计和最佳实践指导".to_string(),
            category: Some("architecture".to_string()),
            version: "1.0.0".to_string(),
            author: Some("AgentsChatGroup Team".to_string()),
            tags: vec!["api".to_string(), "rest".to_string(), "design".to_string()],
            compatible_agents: vec![
                "claude-code".to_string(),
                "codex".to_string(),
                "qwen".to_string(),
            ],
            source_url: Some("https://skills.agentschatgroup.com/api/skills/api-design".to_string()),
            content: r#"# API 设计技能

你是一位 API 设计专家。在设计 API 时，请遵循 RESTful 最佳实践：

## RESTful 原则

1. **资源命名**
   - 使用名词复数: /users, /products
   - 使用小写和连字符: /user-profiles
   - 避免动词: ❌ /getUsers

2. **HTTP 方法**
   | 方法 | 用途 |
   |------|------|
   | GET | 获取资源 |
   | POST | 创建资源 |
   | PUT | 完整更新 |
   | PATCH | 部分更新 |
   | DELETE | 删除资源 |

3. **状态码**
   | 状态码 | 含义 |
   |--------|------|
   | 200 | 成功 |
   | 201 | 创建成功 |
   | 204 | 成功无内容 |
   | 400 | 请求错误 |
   | 401 | 未授权 |
   | 403 | 禁止访问 |
   | 404 | 未找到 |
   | 500 | 服务器错误 |

## 响应格式

### 成功响应
```json
{
  "status": "success",
  "data": { ... },
  "meta": {
    "page": 1,
    "total": 100
  }
}
```

### 错误响应
```json
{
  "status": "error",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [...]
  }
}
```
"#.to_string(),
        },
        SkillPackage {
            id: "debug-helper".to_string(),
            name: "调试助手".to_string(),
            description: "帮助定位和解决代码问题".to_string(),
            category: Some("development".to_string()),
            version: "1.0.0".to_string(),
            author: Some("AgentsChatGroup Team".to_string()),
            tags: vec!["debug".to_string(), "error".to_string(), "troubleshoot".to_string()],
            compatible_agents: vec![
                "claude-code".to_string(),
                "codex".to_string(),
                "qwen".to_string(),
            ],
            source_url: Some("https://skills.agentschatgroup.com/api/skills/debug-helper".to_string()),
            content: r#"# 调试助手技能

你是一位经验丰富的调试专家。在帮助调试时，请遵循以下流程：

## 调试流程

1. **理解问题**
   - 收集错误信息
   - 确定预期行为 vs 实际行为
   - 识别问题范围

2. **定位问题**
   - 分析错误栈
   - 检查相关日志
   - 使用断点/日志定位

3. **分析原因**
   - 检查输入数据
   - 检查边界条件
   - 检查并发问题
   - 检查环境配置

4. **提出方案**
   - 提供修复建议
   - 解释根本原因
   - 建议预防措施

## 常见问题类型

1. **空指针/未定义**
   - 检查变量初始化
   - 检查 API 返回值

2. **类型错误**
   - 检查类型定义
   - 检查类型转换

3. **异步问题**
   - 检查 Promise/async
   - 检查竞态条件

4. **性能问题**
   - 检查循环复杂度
   - 检查内存泄漏
   - 检查数据库查询

## 输出格式

```
### 问题分析

**错误类型**: [类型]

**根本原因**:
[详细解释]

**修复方案**:
```代码```

**预防建议**:
- [建议]
\`\`\`
"#.to_string(),
        },
        // === Skills from awesome-claude-skills ===
        SkillPackage {
            id: "artifacts-builder".to_string(),
            name: "Artifacts Builder".to_string(),
            description: "Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using React, Tailwind CSS, shadcn/ui".to_string(),
            category: Some("development".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["react".to_string(), "frontend".to_string(), "artifacts".to_string(), "shadcn".to_string()],
            compatible_agents: vec!["claude-code".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/artifacts-builder".to_string()),
            content: r#"# Artifacts Builder

To build powerful frontend claude.ai artifacts, follow these steps:

1. Initialize the frontend repo using `scripts/init-artifact.sh`
2. Develop your artifact by editing the generated code
3. Bundle all code into a single HTML file using `scripts/bundle-artifact.sh`
4. Display artifact to user
5. (Optional) Test the artifact

**Stack**: React 18 + TypeScript + Vite + Parcel (bundling) + Tailwind CSS + shadcn/ui

## Design Guidelines

Avoid "AI slop": excessive centered layouts, purple gradients, uniform rounded corners, and Inter font.

## Quick Start

### Step 1: Initialize Project

```bash
bash scripts/init-artifact.sh
cd <project-name>
```

### Step 2: Develop Your Artifact

Edit the generated files to build your artifact.

### Step 3: Bundle to Single HTML File

```bash
bash scripts/bundle-artifact.sh
```

This creates `bundle.html` - a self-contained artifact with all JavaScript, CSS, and dependencies inlined.

### Step 4: Share Artifact with User

Share the bundled HTML file in conversation with the user.
"#.to_string(),
        },
        SkillPackage {
            id: "changelog-generator".to_string(),
            name: "Changelog Generator".to_string(),
            description: "Automatically creates user-facing changelogs from git commits by analyzing commit history, categorizing changes, and transforming technical commits into clear, customer-friendly release notes".to_string(),
            category: Some("documentation".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["git".to_string(), "changelog".to_string(), "release-notes".to_string()],
            compatible_agents: vec!["claude-code".to_string(), "codex".to_string(), "qwen".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/changelog-generator".to_string()),
            content: r#"# Changelog Generator

This skill transforms technical git commits into polished, user-friendly changelogs.

## When to Use This Skill

- Preparing release notes for a new version
- Creating weekly or monthly product update summaries
- Documenting changes for customers
- Writing changelog entries for app store submissions

## What This Skill Does

1. **Scans Git History**: Analyzes commits from a specific time period
2. **Categorizes Changes**: Groups commits into logical categories (features, improvements, bug fixes, breaking changes, security)
3. **Translates Technical → User-Friendly**: Converts developer commits into customer language
4. **Formats Professionally**: Creates clean, structured changelog entries
5. **Filters Noise**: Excludes internal commits (refactoring, tests, etc.)

## How to Use

```bash
# Create a changelog from commits since last release
# Generate changelog for all commits from the past week
# Create release notes for version 2.5.0
```

## Example Output

```markdown
# Updates - Week of March 10, 2024

## ✨ New Features
- **Team Workspaces**: Create separate workspaces for different projects.

## 🔧 Improvements
- **Faster Sync**: Files now sync 2x faster across devices

## 🐛 Fixes
- Fixed issue where large images wouldn't upload
```
"#.to_string(),
        },
        SkillPackage {
            id: "mcp-builder".to_string(),
            name: "MCP Builder".to_string(),
            description: "Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools".to_string(),
            category: Some("development".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["mcp".to_string(), "api".to_string(), "integration".to_string(), "llm".to_string()],
            compatible_agents: vec!["claude-code".to_string(), "codex".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/mcp-builder".to_string()),
            content: r#"# MCP Server Development Guide

## Overview

MCP (Model Context Protocol) servers enable LLMs to interact with external services through well-designed tools.

## High-Level Workflow

### Phase 1: Deep Research and Planning

1. **Understand Agent-Centric Design Principles**
   - Build for Workflows, Not Just API Endpoints
   - Optimize for Limited Context
   - Design Actionable Error Messages
   - Follow Natural Task Subdivisions

2. **Study MCP Protocol Documentation**
   - Fetch from: `https://modelcontextprotocol.io/llms-full.txt`

3. **Study Framework Documentation**
   - Python SDK: FastMCP
   - TypeScript SDK: MCP SDK

4. **Exhaustively Study API Documentation**
   - Official API reference
   - Authentication requirements
   - Rate limiting patterns

### Phase 2: Implementation

1. **Set Up Project Structure**
   - Python: Single `.py` file or modules
   - TypeScript: `package.json`, `tsconfig.json`

2. **Implement Core Infrastructure**
   - API request helpers
   - Error handling utilities
   - Response formatting

3. **Implement Tools Systematically**
   - Define Input Schema (Pydantic/Zod)
   - Write Comprehensive Docstrings
   - Add Tool Annotations

### Phase 3: Review and Refine

- Code Quality Review
- Test and Build
- Use Quality Checklist

### Phase 4: Create Evaluations

Create 10 evaluation questions to test effectiveness.
"#.to_string(),
        },
        SkillPackage {
            id: "skill-creator".to_string(),
            name: "Skill Creator".to_string(),
            description: "Guide for creating effective skills that extend Claude's capabilities by providing specialized knowledge, workflows, and tools".to_string(),
            category: Some("development".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["skill".to_string(), "claude".to_string(), "workflow".to_string()],
            compatible_agents: vec!["claude-code".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/skill-creator".to_string()),
            content: r#"# Skill Creator

Skills are modular, self-contained packages that extend Claude's capabilities.

## Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/     - Executable code
    ├── references/  - Documentation
    └── assets/      - Output files
```

## Skill Creation Process

### Step 1: Understanding the Skill

Understand concrete examples of how the skill will be used.

### Step 2: Planning Contents

Analyze examples to identify:
- Scripts needed
- Reference documentation
- Assets/templates

### Step 3: Initialize the Skill

```bash
scripts/init_skill.py --path <skill_directory_path>
```

### Step 4: Edit the Skill

Focus on information beneficial and non-obvious to Claude.

### Step 5: Package the Skill

```bash
scripts/package_skill.py
```

### Step 6: Iterate

Test and improve based on real usage.
"#.to_string(),
        },
        SkillPackage {
            id: "canvas-design".to_string(),
            name: "Canvas Design".to_string(),
            description: "Create beautiful canvas-based designs and visual content".to_string(),
            category: Some("design".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["design".to_string(), "canvas".to_string(), "visual".to_string()],
            compatible_agents: vec!["claude-code".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/canvas-design".to_string()),
            content: r#"# Canvas Design

Create beautiful canvas-based designs and visual content.

## Features

- Interactive canvas elements
- Drag and drop functionality
- Export to various formats
- Responsive design support

## Usage

Use this skill when you need to create visual designs, diagrams, or interactive canvas-based content.
"#.to_string(),
        },
        SkillPackage {
            id: "file-organizer".to_string(),
            name: "File Organizer".to_string(),
            description: "Organize and manage files efficiently with smart categorization and sorting".to_string(),
            category: Some("productivity".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["files".to_string(), "organization".to_string(), "management".to_string()],
            compatible_agents: vec!["claude-code".to_string(), "codex".to_string(), "qwen".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/file-organizer".to_string()),
            content: r#"# File Organizer

Organize and manage files efficiently.

## Features

- Smart categorization
- Automatic sorting
- Duplicate detection
- Bulk renaming

## Usage

Use this skill when you need to organize, categorize, or manage large numbers of files.
"#.to_string(),
        },
        SkillPackage {
            id: "image-enhancer".to_string(),
            name: "Image Enhancer".to_string(),
            description: "Enhance and optimize images with AI-powered tools".to_string(),
            category: Some("media".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["image".to_string(), "enhancement".to_string(), "optimization".to_string()],
            compatible_agents: vec!["claude-code".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/image-enhancer".to_string()),
            content: r#"# Image Enhancer

Enhance and optimize images with AI-powered tools.

## Features

- Resolution upscaling
- Noise reduction
- Color correction
- Format conversion
- Compression optimization

## Usage

Use this skill when you need to improve image quality or optimize images for web/mobile.
"#.to_string(),
        },
        SkillPackage {
            id: "lead-research-assistant".to_string(),
            name: "Lead Research Assistant".to_string(),
            description: "Research and qualify leads with comprehensive data gathering and analysis".to_string(),
            category: Some("business".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["leads".to_string(), "research".to_string(), "sales".to_string()],
            compatible_agents: vec!["claude-code".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/lead-research-assistant".to_string()),
            content: r#"# Lead Research Assistant

Research and qualify leads efficiently.

## Features

- Company research
- Contact verification
- Social media analysis
- Competitor insights
- Lead scoring

## Usage

Use this skill when you need to research potential customers or qualify sales leads.
"#.to_string(),
        },
        SkillPackage {
            id: "content-research-writer".to_string(),
            name: "Content Research Writer".to_string(),
            description: "Research and write high-quality content with comprehensive fact-checking".to_string(),
            category: Some("content".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["content".to_string(), "writing".to_string(), "research".to_string()],
            compatible_agents: vec!["claude-code".to_string(), "codex".to_string(), "qwen".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/content-research-writer".to_string()),
            content: r#"# Content Research Writer

Research and write high-quality content.

## Features

- Topic research
- Fact verification
- SEO optimization
- Citation management
- Plagiarism checking

## Usage

Use this skill when you need to create well-researched, accurate content.
"#.to_string(),
        },
        SkillPackage {
            id: "webapp-testing".to_string(),
            name: "WebApp Testing".to_string(),
            description: "Comprehensive testing suite for web applications with automated test generation".to_string(),
            category: Some("testing".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["testing".to_string(), "web".to_string(), "automation".to_string()],
            compatible_agents: vec!["claude-code".to_string(), "codex".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/webapp-testing".to_string()),
            content: r#"# WebApp Testing

Comprehensive testing suite for web applications.

## Features

- Unit test generation
- Integration testing
- E2E testing
- Performance testing
- Accessibility testing

## Usage

Use this skill when you need to test web applications thoroughly.
"#.to_string(),
        },
        SkillPackage {
            id: "tailored-resume-generator".to_string(),
            name: "Resume Generator".to_string(),
            description: "Generate tailored resumes optimized for specific job descriptions".to_string(),
            category: Some("career".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["resume".to_string(), "career".to_string(), "job".to_string()],
            compatible_agents: vec!["claude-code".to_string(), "codex".to_string(), "qwen".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/tailored-resume-generator".to_string()),
            content: r#"# Resume Generator

Generate tailored resumes optimized for specific job descriptions.

## Features

- Job description analysis
- Skills matching
- ATS optimization
- Multiple templates
- Cover letter generation

## Usage

Use this skill when you need to create or improve a resume for a specific job application.
"#.to_string(),
        },
        SkillPackage {
            id: "video-downloader".to_string(),
            name: "Video Downloader".to_string(),
            description: "Download videos from various platforms with format conversion options".to_string(),
            category: Some("media".to_string()),
            version: "1.0.0".to_string(),
            author: Some("ComposioHQ".to_string()),
            tags: vec!["video".to_string(), "download".to_string(), "media".to_string()],
            compatible_agents: vec!["claude-code".to_string()],
            source_url: Some("https://github.com/ComposioHQ/awesome-claude-skills/tree/master/video-downloader".to_string()),
            content: r#"# Video Downloader

Download videos from various platforms.

## Features

- Multi-platform support
- Format conversion
- Quality selection
- Subtitle extraction
- Batch downloads

## Usage

Use this skill when you need to download or convert video content.
"#.to_string(),
        },
    ]
}

/// Get sample categories
fn get_sample_categories() -> Vec<SkillCategory> {
    vec![
        SkillCategory {
            id: "development".to_string(),
            name: "开发".to_string(),
            description: Some("代码开发相关技能".to_string()),
        },
        SkillCategory {
            id: "security".to_string(),
            name: "安全".to_string(),
            description: Some("安全扫描和漏洞检测".to_string()),
        },
        SkillCategory {
            id: "testing".to_string(),
            name: "测试".to_string(),
            description: Some("测试生成和验证".to_string()),
        },
        SkillCategory {
            id: "documentation".to_string(),
            name: "文档".to_string(),
            description: Some("文档编写和生成".to_string()),
        },
        SkillCategory {
            id: "architecture".to_string(),
            name: "架构".to_string(),
            description: Some("系统架构和 API 设计".to_string()),
        },
        SkillCategory {
            id: "design".to_string(),
            name: "设计".to_string(),
            description: Some("视觉设计和图形创作".to_string()),
        },
        SkillCategory {
            id: "productivity".to_string(),
            name: "效率".to_string(),
            description: Some("提高工作效率的工具".to_string()),
        },
        SkillCategory {
            id: "media".to_string(),
            name: "媒体".to_string(),
            description: Some("图片和视频处理".to_string()),
        },
        SkillCategory {
            id: "business".to_string(),
            name: "商业".to_string(),
            description: Some("商业和销售相关".to_string()),
        },
        SkillCategory {
            id: "content".to_string(),
            name: "内容".to_string(),
            description: Some("内容创作和研究".to_string()),
        },
        SkillCategory {
            id: "career".to_string(),
            name: "职业".to_string(),
            description: Some("职业发展和求职".to_string()),
        },
    ]
}

// Handlers

async fn list_skills(
    Query(query): Query<SearchQuery>,
    state: axum::extract::State<Arc<AppState>>,
) -> Json<Vec<SkillMeta>> {
    let mut skills: Vec<SkillMeta> = state
        .skills
        .iter()
        .map(|s| SkillMeta {
            id: s.id.clone(),
            name: s.name.clone(),
            description: s.description.clone(),
            category: s.category.clone(),
            version: s.version.clone(),
            author: s.author.clone(),
            tags: s.tags.clone(),
            compatible_agents: s.compatible_agents.clone(),
            source_url: s.source_url.clone(),
        })
        .collect();

    // Filter by search query
    if let Some(search) = &query.search {
        let search_lower = search.to_lowercase();
        skills.retain(|s| {
            s.name.to_lowercase().contains(&search_lower)
                || s.description.to_lowercase().contains(&search_lower)
                || s.tags.iter().any(|t| t.to_lowercase().contains(&search_lower))
        });
    }

    // Filter by category
    if let Some(category) = &query.category {
        skills.retain(|s| s.category.as_ref() == Some(category));
    }

    Json(skills)
}

async fn get_skill(
    Path(id): Path<String>,
    state: axum::extract::State<Arc<AppState>>,
) -> impl IntoResponse {
    match state.skills.iter().find(|s| s.id == id) {
        Some(skill) => Ok(Json(skill.clone())),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn list_categories(
    state: axum::extract::State<Arc<AppState>>,
) -> Json<Vec<SkillCategory>> {
    Json(state.categories.clone())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    // Initialize state
    let state = Arc::new(AppState {
        skills: get_sample_skills(),
        categories: get_sample_categories(),
    });

    // Build CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    // Build router
    let app = Router::new()
        .route("/api/skills", get(list_skills))
        .route("/api/skills/{id}", get(get_skill))
        .route("/api/categories", get(list_categories))
        .layer(cors)
        .with_state(state);

    // Start server
    let addr = "127.0.0.1:3101";
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("Skill Registry Server running at http://{}", addr);
    info!("API Endpoints:");
    info!("  GET http://{}/api/skills", addr);
    info!("  GET http://{}/api/skills/{{id}}", addr);
    info!("  GET http://{}/api/categories", addr);

    axum::serve(listener, app).await?;

    Ok(())
}