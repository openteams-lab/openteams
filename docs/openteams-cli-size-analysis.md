# openteams-cli 体积分析与裁剪方案

## 当前状态
- **二进制大小**: ~144MB (151,069,184 bytes)
- **目标平台**: Windows x64 (及其他 12 个平台)
- **构建工具**: Bun compile (单文件可执行)

---

## 一、体积构成分析

### 1. Bun 运行时 (~50-60MB)
Bun 编译时嵌入完整运行时，包括：
- JavaScript 引擎 (JavaScriptCore)
- Bun API 实现
- 原生模块加载器

### 2. AI SDK 提供商依赖 (~15-20MB)
当前打包了 **20+ 个 AI 提供商 SDK**：

```
@ai-sdk/amazon-bedrock    @ai-sdk/anthropic
@ai-sdk/azure            @ai-sdk/cerebras
@ai-sdk/cohere           @ai-sdk/deepinfra
@ai-sdk/gateway          @ai-sdk/google
@ai-sdk/google-vertex    @ai-sdk/groq
@ai-sdk/mistral          @ai-sdk/openai
@ai-sdk/openai-compatible @ai-sdk/perplexity
@ai-sdk/togetherai       @ai-sdk/vercel
@ai-sdk/xai
@openrouter/ai-sdk-provider
@gitlab/gitlab-ai-provider
ai-gateway-provider
```

### 3. 静态数据 (~2MB)
| 文件 | 大小 | 说明 |
|------|------|------|
| `models-snapshot.ts` | 1.6MB | models.dev 完整模型数据快照 |
| 迁移 SQL | ~100KB | 数据库迁移脚本 |

### 4. UI 框架 (~5-8MB)
- `solid-js` - 响应式 UI 框架
- `@opentui/core` + `@opentui/solid` - TUI 组件库
- `shiki` - 代码高亮 (较大依赖)

### 5. 原生模块 (~5-10MB)
- `web-tree-sitter` + `tree-sitter-bash` - 代码解析
- `@parcel/watcher` - 文件监视 (多平台二进制)
- `bun-pty` - 伪终端

### 6. 其他重型依赖 (~10-15MB)
- `effect` - 函数式编程框架
- `@octokit/rest` - GitHub API
- `hono` + `hono-openapi` - Web 框架
- `drizzle-orm` - ORM
- `@modelcontextprotocol/sdk` - MCP 协议

---

## 二、裁剪方案

### 方案 A: AI 提供商按需加载 (预计节省 10-15MB)

**变更项**: 将 AI 提供商改为可选特性/动态导入

**实现方式**:
```toml
# 在 package.json 中定义可选依赖
"optionalDependencies": {
  "@ai-sdk/anthropic": "2.0.65",
  "@ai-sdk/openai": "2.0.89"
  # ... 其他提供商
}
```

或在构建时通过 define 控制打包:
```typescript
// src/provider/index.ts
const providers = {
  openai: () => import("@ai-sdk/openai"),
  anthropic: () => import("@ai-sdk/anthropic"),
  // ...
}
```

**节省体积**: 10-15MB  
**风险**: 中 - 需要修改提供商加载逻辑，可能影响首次使用体验

---

### 方案 B: models-snapshot 外置 (预计节省 1.5MB)

**变更项**: 将 models-snapshot.ts 改为运行时从 CDN 加载

**当前实现**:
```typescript
// build.ts 构建时生成
export const snapshot = { /* 1.6MB JSON */ }
```

**改为**:
```typescript
// 运行时按需加载
const snapshot = await fetch("https://models.dev/api.json").then(r => r.json())
// 或本地缓存: ~/.openteams/cache/models.json
```

**节省体积**: 1.5MB  
**风险**: 低 - 首次使用需网络连接，可本地缓存

---

### 方案 C: TUI 可选特性 (预计节省 5-8MB)

**变更项**: 将 TUI 界面作为可选特性

**实现方式**:
1. 提供 `openteams-cli-core` (无 UI，仅命令行)
2. 提供 `openteams-cli-tui` (完整 UI)

或使用 feature flag:
```bash
openteams-cli run --no-ui    # 不加载 UI 模块
openteams-cli tui            # 启动 TUI
```

**节省体积**: 5-8MB (无 TUI 版本)  
**风险**: 中 - 需要分离构建目标

---

### 方案 D: shiki 代码高亮替代 (预计节省 2-3MB)

**变更项**: 用更轻量的高亮方案替代 shiki

**替代方案**:
- `highlight.js` (~200KB)
- `prism-react-renderer` (~100KB)
- 使用 Tree-sitter 自带高亮

**节省体积**: 2-3MB  
**风险**: 低 - 高亮效果可能略有差异

---

### 方案 E: Effect 框架替代 (预计节省 3-5MB)

**变更项**: 逐步移除 Effect 依赖

**当前状态**: 部分模块使用 Effect
**替代方案**: 使用原生 Promise/async + 简单的 Result 类型

**节省体积**: 3-5MB  
**风险**: 高 - 需要大量重构，影响面广

---

### 方案 F: Bun 编译优化 (预计节省 5-10MB)

**变更项**: 优化 Bun 编译配置

**当前问题**: 
- 未启用 minify
- 未启用 tree-shaking 优化
- 包含所有平台的原生模块

**优化措施**:
```typescript
await Bun.build({
  // ...
  minify: {
    whitespace: true,
    identifiers: true,
    syntax: true,
  },
  splitting: false,
  treeshaking: true,
  // 仅打包目标平台的原生模块
})
```

**节省体积**: 5-10MB  
**风险**: 低 - 主要是构建配置调整

---

### 方案 G: 拆分 CLI 与 Server (预计节省 20-30MB)

**变更项**: 将本地服务器能力拆分为独立包

**当前问题**: CLI 包含完整的 Hono 服务器、数据库、认证等

**拆分方案**:
```
openteams-cli          # 核心命令行工具 (~50MB)
openteams-server       # 本地服务器 (~40MB)
openteams-tui          # TUI 界面 (~30MB)
```

**节省体积**: 20-30MB (CLI 核心)  
**风险**: 高 - 架构调整较大，影响安装体验

---

## 三、变更项-节省体积-风险 清单

| 序号 | 变更项 | 节省体积 | 风险 | 优先级 |
|------|--------|----------|------|--------|
| 1 | Bun 编译优化 (minify/tree-shaking) | 5-10MB | 低 | P0 |
| 2 | models-snapshot 外置/按需加载 | 1.5MB | 低 | P1 |
| 3 | shiki 替换为轻量高亮 | 2-3MB | 低 | P1 |
| 4 | AI 提供商按需加载/可选特性 | 10-15MB | 中 | P2 |
| 5 | TUI 可选特性/分离构建 | 5-8MB | 中 | P2 |
| 6 | Effect 框架逐步移除 | 3-5MB | 高 | P3 |
| 7 | CLI/Server/TUI 架构拆分 | 20-30MB | 高 | P3 |

---

## 四、推荐实施路径

### Phase 1: 低风险快速见效 (预计减少 10-15MB)
1. 启用 Bun 编译优化 (minify, tree-shaking)
2. models-snapshot 改为运行时加载 + 本地缓存
3. 替换 shiki 为 highlight.js

### Phase 2: 中风险深度优化 (预计再减少 15-20MB)
4. AI 提供商改为动态导入 + 配置化启用
5. TUI 作为可选特性，提供 headless 版本

### Phase 3: 架构重构 (长期目标)
6. 评估 Effect 框架的必要性
7. 考虑 CLI/Server 分离架构

---

## 五、关键依赖清单

### 必须保留
- `ai` - AI SDK 核心
- `@ai-sdk/provider` - 提供商接口
- `web-tree-sitter` - 代码解析
- `@parcel/watcher` - 文件监视
- `hono` - HTTP 服务

### 可优化/替换
- `@ai-sdk/*` (20+ 提供商) → 按需加载
- `shiki` → highlight.js/prism
- `effect` → 原生异步

### 可外置
- `models-snapshot` → CDN/缓存
- 数据库迁移 → 首次运行下载

---

## 六、非核心能力拆分建议

| 能力 | 当前状态 | 拆分建议 |
|------|----------|----------|
| AI 提供商 | 全部内置 | 仅默认 OpenAI/Anthropic，其他按需安装 |
| models.dev 数据 | 编译时嵌入 | 运行时获取 + 本地缓存 |
| 代码高亮 | shiki 内置 | 外置主题包 |
| TUI 界面 | 内置 | 可选安装 |
| 本地服务器 | 内置 | 独立 openteams-server 包 |
| GitHub 集成 | @octokit 内置 | 按需安装 |