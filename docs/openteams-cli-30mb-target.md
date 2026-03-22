# openteams-cli 30MB 硬目标方案

**基准**: 当前二进制约 144MB  
**目标**: ≤30MB

---

## 一、核心 CLI 最小命令集

### 保留命令 (5个)

| 命令 | 用途 | 依赖 |
|------|------|------|
| `run` | 核心 Agent 运行 | ai sdk, 1 provider |
| `upgrade` | 版本升级 | http |
| `--version/--help` | 基础信息 | 无 |

### 删除命令 (18个)

| 命令 | 体积影响 | 替代方案 |
|------|----------|----------|
| `tui/thread` | 5-8MB | 移至 `@openteams/tui` 包 |
| `attach` | 3-5MB | 移至 `@openteams/tui` 包 |
| `github` | 2-3MB | 移至 `@openteams/github` 插件 |
| `pr` | 1-2MB | 移至 `@openteams/github` 插件 |
| `mcp` | 3-5MB | 移至 `@openteams/mcp` 包 |
| `acp` | 2-3MB | 移至 `@openteams/acp` 包 |
| `serve` | 3-5MB | 移至 `@openteams/server` 包 |
| `web` | 2-3MB | 移至 `@openteams/web` 包 |
| `stats` | 0.5MB | 删除或外置 |
| `models` | 0.5MB | 删除，改为 API 查询 |
| `providers` | 1MB | 删除或简化 |
| `agent` | 1MB | 合并到 run |
| `session` | 1MB | 移至 `@openteams/server` |
| `db` | 0.5MB | 移至 `@openteams/server` |
| `export/import` | 1MB | 移至 `@openteams/server` |
| `generate` | 0.5MB | 删除 |
| `account` | 0.5MB | 移至 `@openteams/auth` |
| `debug` | 0.5MB | 删除 |

---

## 二、Provider SDK 瘦身

### 当前 Provider SDK 列表 (20+)

```json
// 完全移除的 Provider SDK (节省 ~15MB)
"@ai-sdk/amazon-bedrock"
"@ai-sdk/azure"
"@ai-sdk/cerebras"
"@ai-sdk/cohere"
"@ai-sdk/deepinfra"
"@ai-sdk/gateway"
"@ai-sdk/google"
"@ai-sdk/google-vertex"
"@ai-sdk/groq"
"@ai-sdk/mistral"
"@ai-sdk/openai-compatible"  // 保留核心，移除特定实现
"@ai-sdk/perplexity"
"@ai-sdk/togetherai"
"@ai-sdk/vercel"
"@ai-sdk/xai"
"@openrouter/ai-sdk-provider"
"@gitlab/gitlab-ai-provider"
"ai-gateway-provider"
"@aws-sdk/credential-providers"
"google-auth-library"
```

### 保留 Provider SDK (2个)

```json
// 仅保留，满足 90% 用户需求
"@ai-sdk/openai"        // OpenAI, 兼容多数 API
"@ai-sdk/anthropic"     // Anthropic Claude
```

### Provider 插件化架构

```
openteams-cli (核心)
  └── 内置: openai, anthropic

@openteams/provider-google    (可选安装)
@openteams/provider-azure     (可选安装)
@openteams/provider-bedrock   (可选安装)
@openteams/provider-groq      (可选安装)
... 其他 provider 插件
```

---

## 三、依赖收缩路径

### 阶段 1: 删除重型依赖

| 依赖 | 当前体积 | 操作 | 节省 |
|------|----------|------|------|
| `@ai-sdk/*` (18个) | 12-15MB | 删除，仅保留 2 个 | 10-12MB |
| `solid-js` | 1MB | 移除 TUI | 1MB |
| `@opentui/*` | 3-5MB | 移除 TUI | 3-5MB |
| `shiki` | 2-3MB | 移除代码高亮 | 2-3MB |
| `effect` | 3-5MB | 重构移除 | 3-5MB |
| `@octokit/rest` | 1-2MB | 移除 GitHub 命令 | 1-2MB |
| `hono` + `hono-openapi` | 1-2MB | 移除 serve 命令 | 1-2MB |
| `@modelcontextprotocol/sdk` | 1-2MB | 移除 mcp 命令 | 1-2MB |
| `drizzle-orm` | 1MB | 简化存储 | 0.5-1MB |
| `web-tree-sitter` | 2-3MB | 移除代码解析 | 2-3MB |
| `tree-sitter-bash` | 0.5MB | 移除代码解析 | 0.5MB |

### 阶段 2: 替换/简化

| 依赖 | 替代方案 | 节省 |
|------|----------|------|
| `effect` | 原生 async/Promise + 简单 Result | 3-5MB |
| `shiki` | 无高亮 / ANSI 着色 | 2-3MB |
| `@parcel/watcher` | chokidar (更轻量) 或轮询 | 1-2MB |
| `yargs` | 内置简单参数解析 | 0.5MB |

### 阶段 3: 最小依赖集

```json
{
  "dependencies": {
    "@ai-sdk/openai": "2.0.89",
    "@ai-sdk/anthropic": "2.0.65",
    "ai": "5.0.124",
    "@ai-sdk/provider": "2.0.1",
    "zod": "4.1.8"
  }
}
```

---

## 四、体积预估

### 当前构成 (144MB)

```
Bun 运行时           50-60MB   (不可压缩)
AI Provider SDK      15-20MB   → 删除 18 个，保留 2 个
TUI/UI 框架           5-8MB   → 完全移除
原生模块              5-10MB   → 精简
models-snapshot       1.5MB   → 外置/删除
Effect 框架           3-5MB   → 移除
其他依赖             10-15MB   → 精简
```

### 瘦身后构成

```
Bun 运行时           50-60MB   ⚠️ 瓶颈
AI SDK (2 provider)   2-3MB
核心逻辑              2-3MB
原生模块 (精简)       1-2MB
其他最小依赖          1-2MB
────────────────────────────
合计                 56-70MB
```

### ⚠️ 关键问题: Bun 运行时瓶颈

**Bun 编译后的最小体积约 50-60MB**（仅 `console.log` 程序），无法突破此下限。

---

## 五、达成 30MB 的替代方案

### 方案 A: 切换运行时 (推荐)

| 运行时 | 最小体积 | 说明 |
|--------|----------|------|
| Bun compile | 50-60MB | 当前方案，无法达标 |
| Deno compile | 20-30MB | 可达标，需迁移 |
| pkg (Node) | 25-35MB | 可达标，需迁移 |
| nexe (Node) | 20-30MB | 可达标，需迁移 |

**推荐**: 迁移至 Deno compile

**优势**:
- Deno 运行时更小 (20-30MB)
- TypeScript 原生支持
- 类似的 API 设计

**迁移成本**: 中高

### 方案 B: 外置运行时

不打包运行时，要求用户预装：
- `openteams-cli` (纯 JS，约 3-5MB)
- 用户自行安装 Bun/Deno/Node

**体积**: 3-5MB ✅

**缺点**: 用户体验差，需额外安装步骤

### 方案 C: WASM 模块化

将核心逻辑编译为 WASM：
- 运行时独立安装
- CLI 为薄壳 + WASM 模块

**体积**: 5-10MB

**缺点**: 开发复杂度高

---

## 六、多平台目标矩阵体积预估

### 当前目标矩阵 (12个平台)

```
linux-arm64
linux-arm64-musl
linux-x64
linux-x64-musl
linux-x64-baseline
darwin-arm64
darwin-x64
darwin-x64-baseline
win32-arm64
win32-x64
win32-x64-baseline
```

### Bun compile 各平台预估

| 平台 | 瘦身后体积 (Bun) | Deno compile |
|------|------------------|--------------|
| linux-arm64 | 55-65MB | 25-35MB |
| linux-x64 | 55-65MB | 25-35MB |
| darwin-arm64 | 55-65MB | 25-35MB |
| darwin-x64 | 55-65MB | 25-35MB |
| win32-x64 | 60-70MB | 30-40MB |

### 总下载包大小 (12个平台)

| 方案 | 单平台 | 总计 (12平台压缩包) |
|------|--------|---------------------|
| Bun 当前 | 144MB | ~800MB |
| Bun 瘦身极限 | 55-70MB | ~350MB |
| Deno compile | 25-35MB | ~150MB |

---

## 七、最终建议

### 短期: Bun 瘦身极限 (55-70MB)

1. 移除 18 个非核心 Provider SDK
2. 移除 TUI/serve/mcp/github 等命令
3. 移除 effect/shiki/web-tree-sitter 依赖
4. 外置 models-snapshot

**体积**: 55-70MB  
**周期**: 2-3 周  
**风险**: 中

### 中期: 迁移 Deno compile (25-35MB) ✅ 达标

1. 将 TypeScript 代码迁移至 Deno 兼容
2. 使用 Deno compile 打包
3. 保持最小命令集

**体积**: 25-35MB  
**周期**: 4-6 周  
**风险**: 中高

### 实施路径

```
Week 1-2: 移除非核心命令和 Provider
Week 3:   移除重型依赖，精简至最小集
Week 4:   Bun 版本发布 (55-70MB)
Week 5-8: Deno 迁移
Week 9:   Deno 版本发布 (25-35MB)
```

---

## 八、核心 CLI 最终形态

```bash
# 最小核心命令
openteams-cli run              # 运行 Agent
openteams-cli upgrade          # 升级版本
openteams-cli --version        # 版本信息
openteams-cli --help           # 帮助

# 扩展命令 (需安装插件)
@openteams/tui                 # TUI 界面
@openteams/server              # 本地服务器
@openteams/mcp                 # MCP 协议
@openteams/github              # GitHub 集成
@openteams/provider-*          # 其他 AI 提供商
```

### package.json 最小化

```json
{
  "name": "openteams-cli",
  "version": "2.0.0",
  "bin": { "openteams-cli": "./bin/cli.js" },
  "dependencies": {
    "@ai-sdk/openai": "2.0.89",
    "@ai-sdk/anthropic": "2.0.65",
    "ai": "5.0.124",
    "zod": "4.1.8"
  },
  "optionalDependencies": {
    "@openteams/tui": "workspace:*",
    "@openteams/provider-google": "workspace:*"
  }
}
```

---

## 九、总结

| 目标 | 可达成 | 方案 |
|------|--------|------|
| ≤30MB | ⚠️ Bun 无法达标 | 需切换至 Deno compile |
| 55-70MB | ✅ Bun 可达标 | 移除非核心，精简依赖 |
| 25-35MB | ✅ Deno 可达标 | 迁移运行时 |

**建议优先级**:
1. 先实施 Bun 瘦身极限版本 (55-70MB)
2. 评估用户反馈
3. 推进 Deno 迁移以达成 30MB 目标