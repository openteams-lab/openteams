# Hardcode 识别文档

审计时间：2026-05-28

范围：`src`、`README.md`、`.env.example`、`package.json`。本次只整理代码中的硬编码点，不改业务逻辑。

## 总览

当前项目仍保留较多原型阶段硬编码，主要集中在本地 mock 数据、演示用 UI 文案、默认状态、模型/供应商列表、价格与成本展示、延迟与随机回复模拟、静态资源/上下文示例、后端 API 路径常量等位置。

优先级建议：

| 优先级 | 类型 | 原因 |
| --- | --- | --- |
| P0 | 伪密钥、账号邮箱、供应商 key mask | 容易误导真实密钥处理或暴露个人信息示例 |
| P1 | mock 会话/任务/成员/工作流、随机回复 | 影响真实后端集成时的数据来源边界 |
| P1 | 模型名、供应商、团队角色、路由策略 | 后端或配置中心接管前容易与真实能力不一致 |
| P2 | UI 文案、导航、空态/错误态英文文案 | 已有 i18n，但仍有大量未国际化字符串 |
| P2 | 数字阈值、价格、延迟、成本公式 | 影响产品规则维护与测试稳定性 |
| P3 | Tailwind 尺寸/布局常量、CSS token | 多数属于视觉实现，可视设计系统情况决定是否提取 |

## 明细

### 1. 本地 mock seed 数据

位置：`src/data.ts`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| 3-44 | `initialTasks` 固定任务、模型、成本、状态 | 真实任务列表接入后仍可能作为 fallback 展示，容易混淆数据来源 | 保留为 mock fixture，但标注为 demo-only；真实数据由 API 或 mapper 输入 |
| 46-51 | `initialMembers` 固定成员、头像、模型名 | 团队成员和模型能力被写死 | 接入后端成员/agent 配置，mock 放入 fixture 文件 |
| 53-59 | `initialSessions` 固定会话 | 默认 active session 与 mock session 强耦合 | 使用后端 session 列表或空态 |
| 61-161 | `initialMessages` 固定聊天内容、时间、模型 | 演示内容包含文件名、版本号、API key 问答等业务假设 | 作为开发 fixture 隔离，生产环境不加载 |
| 163-168 | `initialProviders` 固定供应商和 key mask | 包含类真实 key 前缀，容易误导安全边界 | 只显示后端返回的 masked key；示例 key 用明显占位符 |
| 170-176 | `initialStrategies` 固定路由策略 | 策略规则和推荐状态写死 | 由后端策略配置或前端配置文件驱动 |
| 178-204 | `mockAgentRepliesByMention` 随机 agent 回复池 | 真实聊天失败时会伪造 agent 行为 | fallback 只提示失败或进入离线演示模式 |

### 2. App 布局和导航中的演示数据

位置：`src/App.tsx`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| 28 | 默认页面 `workspace` | 可接受，但建议集中到路由常量 | 提取为 `DEFAULT_APP_PAGE` |
| 31-47 | preset 点击后写死任务、成本、头像、toast | 演示 workflow 与真实任务流程耦合 | 将 preset 定义移到配置/fixture；真实创建走 API |
| 57-58, 67-68, 77-78, 93-94 | 页面标题/说明直接写 JSX | i18n 覆盖不完整 | 补充 locale key |
| 133, 137 | 项目名 `my-saas`、`side-tool` | 工作区项目列表写死 | 从 workspace/project API 或 config 获取 |
| 151, 155 | Ship counter 固定 `5`、`12` | 统计数据不可信 | 由后端指标或真实任务状态计算 |
| 215, 236, 239-243 | Settings/Operations Map 文案和导航数组 | 导航结构散落在组件中 | 提取为常量并走 i18n |
| 229 | 文案 `璁剧疆` 显示疑似编码异常 | 可能是乱码硬编码 | 修复源文件编码或替换为 i18n key |
| 360-362 | 关闭 session 只 `console.log` 并 toast | 未实现核心交互，属于 TODO 硬编码假行为 | 接入 archive/delete API 或隐藏未完成按钮 |

### 3. WorkspaceContext 默认状态、模拟流程和随机逻辑

位置：`src/context/WorkspaceContext.tsx`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| 155, 237 | localStorage key `openteams-design-mode` | 可接受，但应集中管理 | 提取到 storage key 常量 |
| 162 | 默认语言 `zh` | 默认语言不可配置 | 从浏览器语言、用户设置或配置读取 |
| 164-195 | 默认 session、策略、onboard type | 与 mock id 强耦合 | 从 API 首项或配置默认值推导 |
| 199-207 | `smartRouting/showCost/showExplanation/warnOverDollar` 和统计数字 `8.42/4.20/37` | 产品规则与统计值写死 | 设置项和指标由 config/API 驱动 |
| 210 | 默认 settings tab `providers` | 可接受，但建议常量化 | 提取为 `DEFAULT_SETTINGS_TAB` |
| 227-231 | toast 固定 3000ms | UI 行为参数分散 | 提取为 UI 常量 |
| 449-491 | 根据关键词/mention 选择 mock responder | 业务路由逻辑伪造 | 真实路由由后端决定；前端仅展示结果 |
| 494-537 | `Date.now()` id、600/1500ms 延迟、随机回复、随机成本/Token | 不稳定且伪造计费 | mock 模式隔离；真实计费只使用后端返回 |
| 593-609 | `mainMembersMap`、默认 avatar、固定 `$0.15` | 成员角色映射和成本写死 | 用 agent profile + 后端 plan step 字段 |
| 631-665 | retry workflow 固定 step/cost/toast/timer | 工作流状态机完全模拟 | 接入 workflow execution 状态 API |
| 668-681 | 新成员 id、状态、roleDetail 文案本地拼接 | 成员创建未持久化 | 调用成员 API；前端仅乐观更新 |
| 684-697 | provider key mask 和 toast 本地拼接 | 密钥处理应由后端完成 | 前端不生成 mask；提交后显示后端返回结果 |

### 4. FreeChat 工作区中的上下文示例和工作流转换

位置：`src/components/FreeChatWorkspace.tsx`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| 62-70 | `handleTurnIntoWorkflow` 固定生成 5 个任务 | 从聊天生成工作流是假实现 | 调用后端 plan/generate API |
| 82, 387 | 固定只展示前 3 个成员 | UI 行为规则写死 | 提取为常量或分页/展开 |
| 121-123 | workspace fallback 路径 `.` | 对真实工作区可能不明确 | 缺少 workspace_dir 时显示阻塞/空态 |
| 135 | fallback 标题 `No active session` | 未国际化 | 补充 i18n |
| 140 | repo `indiebob/my-saas` | 仓库信息写死 | 从 workspace config 或 git API 获取 |
| 144 | 周成本公式 `weeklyCost * 7` | 指标口径写死 | 后端返回周期化指标 |
| 153, 162-165, 173-175, 186-189 等 | loading/empty/error/fallback 英文硬编码 | i18n 不完整 | 统一走 locale |
| 261, 342 | 附件/语音 toast 只是演示 | 功能状态被伪装成 ready | 未接入前显示 disabled 或 coming soon |
| 447-454 | `AvatarLoader.tsx`、`UserProfile.tsx` 固定上下文文件 | 工作区上下文不真实 | 使用 `workspaceChanges` 或文件 API 返回结果 |

### 5. Onboarding 和订阅页中的固定产品配置

位置：`src/components/OnboardingPro.tsx`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| 31-71 | 不同项目类型的推荐角色、模型、tip 固定 | 推荐逻辑无法随后端能力变化 | 从 templates/config/API 读取 |
| 81-88 | 根据角色名判断运行状态并生成 member name | 角色规则写死 | 由模板定义或后端返回 |
| 91-99, 277 | early bird 数量纯前端递减 | 营销库存不可信 | 从订阅/营销 API 获取并更新 |
| 292-338 | Free/Pro 价格 `$0/$9/$19`、周期 `/month` | 定价硬编码 | 接入 billing/pricing config |
| 302, 306, 310, 349, 353 | 功能权益文案硬编码 | i18n 和定价配置不完整 | 放入 locale 或远端配置 |
| 367 | Pro 按钮 active 文案硬编码且疑似编码异常 | 影响多语言和展示质量 | 使用 locale key 并修复编码 |

### 6. Dialog 默认输入、模型选项和表单文案

位置：`src/components/DialogManager.tsx`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| 29-31 | 新任务默认标题、详情、成员 chips | 表单默认值是业务假设 | 改为空值/模板选择，或从 preset 传入 |
| 34-39 | 新成员、新 provider 默认值和伪 key | 可能误导真实密钥输入 | 默认空值，placeholder 使用安全占位 |
| 185-189 | chip 列表和 labelMap 固定 | 团队角色不可配置 | 从成员/角色 API 获取 |
| 286-290 | 模型下拉选项固定 | 模型清单易过期 | 使用 provider models API |
| 348, 354, 360, 366 | Provider 表单 label/placeholder 硬编码 | i18n 不完整 | 补充 locale key |

### 7. Settings 页中的账号、菜单和语言硬编码

位置：`src/components/SettingsWorkspace.tsx`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| 9-16 | `languageOptions` 标签硬编码，且部分疑似乱码 | 影响语言切换体验 | 修复编码，语言名可作为常量集中管理 |
| 69-70, 74, 100, 114, 130 等 | 设置页多处标题说明硬编码或乱码 | i18n 不完整 | 全部接入 locale |
| 108-126 | 主题预览色值 `#010102/#0f1011/#fbfbfc/#e3e5ea` | 与 CSS token 可能重复 | 从设计 token 读取或集中常量 |
| 158-167 | 邮箱 `liumingyuan.myliu@gmail.com`、角色、key 状态 | P0：个人账号和状态示例写死 | 删除个人邮箱；从 account API/config 获取 |
| 181-193 | 快捷键说明和按键硬编码，且疑似乱码 | 快捷键未真实绑定 | 用快捷键配置源或隐藏未实现项 |
| 366-385 | settings menu 分组、disabled 状态写死 | 设置结构散落 | 提取 menu config 并接 i18n/feature flags |

### 8. Routing/Dropdown 展示中的固定选择规则

位置：`src/components/DropdownsWorkspace.tsx`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| 4, 28, 57 | 直接使用 `initialStrategies` 而非 context `strategies` | 后端或状态更新后不会同步 | 使用 context 中的 `strategies` |
| 19, 23 | dropdown 默认打开 | 展示态硬编码 | 根据产品交互决定默认关闭或配置 |
| 25 | 默认 agent `mem-1` | 与 mock 成员 id 绑定 | 以当前 session agent 首项作为默认 |
| 34-35 | active/available 按数组 slice 划分 | 成员状态判断不可靠 | 根据 member status 或 session assignment 字段 |
| 72, 158, 204-205, 232-233, 258-260 | 标题、空态、帮助文本硬编码 | i18n 不完整 | 补充 locale key |

### 9. Tokens 页中的 token 列表

位置：`src/components/TokensWorkspace.tsx`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| 6-15, 18 | token key 列表写死，且默认值疑似乱码 | 新增/删除 CSS token 时容易漏同步 | 从 `index.css` token 清单或共享常量生成 |
| 31-33 | 读取 token 延迟 100ms | DOM 同步依赖 magic number | 用 `requestAnimationFrame` 或 effect 顺序保证 |
| 40 | copy toast 文案硬编码 | i18n 不完整 | 补充 locale key |

### 10. API 路径常量

位置：`src/lib/api.ts`、`src/lib/cliConfigApi.ts`

| 行号 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| `src/lib/api.ts` 68-689 | `/api/info`、`/api/chat/*`、`/api/workflow/*` 等路径散落在 wrapper 方法中 | 路径集中在 API 层，风险可控，但后端契约变化时需逐个修改 | 保持在 API adapter，不要下沉到组件；必要时抽 endpoint 常量 |
| `src/lib/cliConfigApi.ts` 21-106 | `/api/config/cli*` 路径 | 同上 | 同上 |
| `src/lib/apiCore.ts` 31, 46 | 通用错误文案硬编码 | 可接受但未 i18n | 面向用户展示时由 UI 层转换 |

### 11. 外部资源和环境示例

| 位置 | 内容 | 风险 | 建议 |
| --- | --- | --- | --- |
| `src/index.css:1` | Google Fonts URL | 第三方资源依赖写死，可能影响离线/内网环境 | 评估是否自托管字体或使用系统字体 fallback |
| `.env.example:1` | `GEMINI_API_KEY` 示例说明 | 可接受，但当前前端依赖中存在 `@google/genai`、`dotenv`、`express`，需确认是否仍用于前端 | 清理无用依赖或补充服务端说明 |
| `README.md:31` | 明确 `src/data.ts` 为 demo seed data | 与当前发现一致 | 保持，但建议补充 mock/fallback 行为说明 |

## 编码异常观察

多处输出出现疑似乱码，例如 `鈫?`、`鈥?`、`涓枃`、`璁剧疆` 等。它们可能是文件编码读取问题，也可能已经写入源码。建议单独做一次编码修复审计，优先检查：

- `src/data.ts`
- `src/App.tsx`
- `src/context/WorkspaceContext.tsx`
- `src/components/FreeChatWorkspace.tsx`
- `src/components/DialogManager.tsx`
- `src/components/SettingsWorkspace.tsx`
- `src/components/TokensWorkspace.tsx`
- `README.md`

## 建议拆分治理任务

1. 建立 `src/fixtures` 或 `src/mocks`，将演示数据从运行状态逻辑中隔离。
2. 将默认 UI 状态、storage key、toast duration、展示数量、价格等 magic numbers 提取到 `src/config`。
3. 将模型、供应商、团队角色、策略、pricing 等可变业务配置改为 API 或配置文件驱动。
4. 完成 i18n 扫描，把组件中的用户可见硬编码文案迁移到 `src/locales`。
5. 删除或替换个人邮箱、伪 key 和未实现功能的“ready”提示。
6. 梳理 mock fallback 策略：真实后端失败时不应伪造成功状态或计费结果。

