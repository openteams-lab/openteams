# OpenCode 迁移到 OpenTeams-CLI 合并方案

## 背景
- **opencode 最新版本**: v1.4.3（位于 `E:\workspace\projectSS\opencode`）
- **openteams-cli 基础版本**: v1.2.27（位于 `E:\workspace\projectSS\openteams\openteams-cli`）
- **版本跨度**: 1.2.27 → 1.4.3（1.2.27, 1.2.x, 1.3.x, 1.4.x）

## 版本依赖差异

| 依赖项 | opencode (1.4.3) | openteams-cli (1.2.27) |
|-------|-----------------|----------------------|
| 工作区包 | `@opencode-ai/*` | `@openteams/*` |
| effect | 4.0.0-beta.46 | 4.0.0-beta.35 |
| ai SDK | 5.0.158 | 5.0.124 |
| @effect/platform-node | 4.0.0-beta.46 | 4.0.0-beta.35 |

---

## 方案A：选择性同步（推荐）

### 核心思路
保留 openteams-cli 的定制代码，用 opencode 的包逐步替换基础包，然后同步差异。

### 步骤 1：依赖升级
```json
// openteams-cli/package.json 修改
{
  "workspaces": {
    "packages": [
      "packages/opencode",    // 用 opencode 包替代
      "packages/sdk/js",
      "packages/util",
      "packages/plugin",
      "packages/script"
    ]
  },
  "catalog": {
    "@effect/platform-node": "4.0.0-beta.46",  // 升级
    "effect": "4.0.0-beta.46",                  // 升级
    "ai": "5.0.158",                            // 升级
    // ... 其他 catalog 依赖同步
  }
}
```

### 步骤 2：工作区包重命名
将 `packages/openteams-cli` 中对 `@openteams/*` 的引用改为 `@opencode-ai/*`:
- `@openteams/sdk` → `@opencode-ai/sdk`
- `@openteams/util` → `@opencode-ai/util`
- `@openteams/plugin` → `@opencode-ai/plugin`
- `@openteams/script` → `@opencode-ai/script`

### 步骤 3：代码同步
直接用 opencode 的包替换 openteams-cli 对应的包：
- `packages/openteams-cli` → 用 `packages/opencode` 替代
- `packages/sdk` → 用 `packages/sdk/js` 替代
- `packages/util` → 用 `packages/util` 替代
- `packages/plugin` → 用 `packages/plugin` 替代
- `packages/script` → 用 `packages/script` 替代

### 步骤 4：评估并迁移定制代码

#### openteams-cli 特有模块清单：
| 模块 | 路径 | 说明 | 迁移建议 |
|-----|-----|------|---------|
| project/ | src/project/ | 项目状态管理 | **保留** - openteams 特有 |
| file/ | src/file/ | 文件处理 | **保留** - 可能有定制 |
| filesystem/ | src/filesystem/ | 文件系统封装 | **保留** - 可能有定制 |
| flag/ | src/flag/ | 特性开关 | **保留** - openteams 特有 |
| cli/ | src/cli/ | 命令行界面 | **保留** - openteams 特有 |
| config/ | src/config/ | 配置管理 | **保留** - openteams 特有 |
| effect/ | src/effect/ | Effect 运行时 | **合并** - 对比差异后保留 |

#### 合并策略：
1. 对每个定制模块，对比 opencode 1.2.27 和 1.4.3 的差异
2. 将 opencode 的新功能/修复 cherry-pick 到 openteams-cli
3. 确保 API 兼容性

### 优点
- 风险最小
- 保留所有 openteams 定制
- 可以逐步验证

### 缺点
- 需要较多手动工作
- 依赖对比工具

---

## 方案B：完整替换

### 核心思路
用 opencode 仓库完全替换 openteams-cli 工作区，保留必要配置。

### 步骤：
1. 删除 `openteams-cli/packages/` 下所有包
2. 将 `opencode/packages/` 下所有包复制到 `openteams-cli/packages/`
3. 替换所有 `@opencode-ai/*` 命名空间为 `@openteams/*`
4. 添加 openteams 特定配置（AGENTS.md, 特殊构建配置等）
5. 逐个解决兼容性问题

### 优点
- 一次性获得所有新功能
- 代码干净

### 缺点
- 风险大
- 可能破坏现有功能
- 需要大量修复工作

---

## 方案C：逐模块迁移

### 核心思路
对比 opencode 1.2.27 → 1.4.3 的每个模块变更，逐个迁移。

### 步骤：
1. 生成 opencode 1.2.27 → 1.4.3 的完整 diff
2. 按模块优先级排序：
   - 高优先级：tool/, skill/, storage/, sync/
   - 中优先级：lsp/, mcp/, share/
   - 低优先级：util/, format/
3. 逐个模块 cherry-pick 变更

### 优点
- 精细控制
- 易于回滚

### 缺点
- 工作量大
- 容易遗漏依赖

---

## 推荐执行顺序

```
1. 创建备份
2. 方案A步骤1：升级依赖版本
3. 方案A步骤2：重命名工作区引用
4. 方案A步骤3：替换基础包
5. 方案A步骤4：逐个评估并迁移定制模块
6. 运行测试验证
7. 如有问题，回滚并尝试方案C
```

---

## 需要注意的风险

1. **Effect 版本升级**: beta.35 → beta.46 可能存在 breaking changes
2. **AI SDK 版本升级**: 5.0.124 → 5.0.158 API 可能有变化
3. **工作区包命名空间**: 从 `@openteams/*` 改为 `@opencode-ai/*`
4. **数据库 schema 变更**: 如果有 storage/schema 变更需要迁移
5. **新增依赖**: opencode 1.4.3 可能引入了新的依赖