# 全球开源 DESIGN.md 专项项目全面调研报告

> 调研日期：2026-06-23
> 范围：互联网上**单独以 DESIGN.md 为核心**开源的项目（DESIGN.md 是 Google Stitch 提出的纯文本设计系统文档格式，让 AI 编码 agent 读取后生成视觉一致的 UI）。
> 主要来源：GitHub `design-md` topic（85 仓库）、`awesome-design-md` 搜索（133 仓库）、各仓库 README。
> 背景：DESIGN.md 由 Google Stitch 提出（[stitch.withgoogle.com/docs/design-md/overview](https://stitch.withgoogle.com/docs/design-md/overview/)），与 `AGENTS.md`（教 agent 如何构建项目）对应——`DESIGN.md` 教设计 agent 项目应如何"看起来和感觉"。

## 一、DESIGN.md 精选集合（品牌/网站设计系统提取）

| 仓库 | Stars | 规模 | 说明 |
|---|---|---|---|
| `VoltAgent/awesome-design-md` | 92.3k | 73 个品牌 | 头部仓库。从真实网站提取的 DESIGN.md 集合，覆盖 AI/LLM、开发工具、后端/DevOps、SaaS、设计工具、金融/加密、电商、媒体、汽车、复古 Web 等。每个含 `DESIGN.md` + `preview.html` + `preview-dark.html`，遵循 Stitch 格式并扩展 9 节（视觉主题/色彩/排版/组件/布局/深度/Do's & Don'ts/响应式/Agent Prompt 指南）。配套站点 getdesign.md 可请求特定网站。 |
| `VoltAgent/awesome-claude-design` | 2.8k | 68 个 | 68 个即用型设计系统灵感（DESIGN.md 格式），丢进项目即可一键 scaffold 完整 UI。 |
| `HU-UH/awesome-design-md` | 280 | 55 个 | 55 个精选网站设计系统 DESIGN.md（中文），供 AI Agent 生成匹配 UI。 |
| `kzhrknt/awesome-design-md-jp` | 779 | — | 日文 UI 的 DESIGN.md 集合，扩展 Google Stitch 格式以支持 CJK 排版。 |
| `fchangjun/awesome-design-md-cn` | 119 | — | 中文版，Stitch 提出的设计系统文档格式——用纯文本 Markdown 记录设计系统。 |
| `Meliwat/awesome-design-md-pre-paywall` | 34 | — | VoltAgent/awesome-design-md 引入 getdesign.md 链接前的快照（免费回退）。 |
| `Meliwat/awesome-ios-design-md` | 71 | 200 个 | 200 个生产级 DESIGN.md，覆盖全球最佳 App，框架中立 + SwiftUI/Jetpack Compose/Expo 三种变体。 |
| `pikespeak/awesome-ios-design-md` | 0 | 8 个 App | iOS 设计系统（SwiftUI + Expo），覆盖 Instagram/DoorDash/Spotify/Duolingo/TikTok 等 8 大 App。 |
| `skyeweis/awesome-design-md` | 3 | — | 基于 VoltAgent/awesome-design-md 的 DESIGN.md 设计系统集合。 |
| `rohitg00/awesome-claude-design` | 767 | — | Claude Design DESIGN.md prompts，按美学家族分类，含 remix 配方、技能、视频拆解、X 信号、社区观点。 |
| `kwakseongjae/oh-my-design` | 265 | 326 个 | 一条命令把 326 个手校公司 DESIGN.md + skills 装进 Claude Code/Codex/Cursor/OpenCode。MIT，零 AI 调用。含 17 skills + 16 sub-agents + 激活 hooks，支持 MCP。 |

## 二、DESIGN.md + SKILL.md 双文件设计技能集

| 仓库 | Stars | 规模 | 说明 |
|---|---|---|---|
| `bergside/awesome-design-skills` | 1.4k | 67 个 | 67 个 DESIGN.md + SKILL.md 设计技能文件，供 Claude Design/Google Stitch/Codex/Cursor 等。每个技能含 `SKILL.md`（agent 指令：令牌/组件规则/可访问性/质量门）+ `DESIGN.md`（人类可读设计意图）。配套 TypeUI CLI（`npx typeui.sh pull <slug>`）与预览站 typeui.sh/design-skills。67 个技能覆盖：Agentic/Ant/Application/Artistic/Bento/Bold/Brutalism/Cafe/Claymorphism/Claude/Clean/Codex/Colorful/Contemporary/Corporate/Cosmic/Creative/Dashboard/Dithered/Doodle/Dramatic/Editorial/Elegant/Energetic/Enterprise/Expressive/Fantasy/Fiction/Flat/Friendly/Futuristic/Glassmorphism/Gradient/Immersive/Impeccable/Levels/Lingo/Luxury/Material/Matrix/Minimal/Modern/Mono/Neon/Neobrutalism/Neumorphism/Pacman/Paper/Perspective/Premium/Professional/Publication/Refined/Retro/Riso/Sega/Shadcn/Simple/Sketch/Skeumorphism/Sleek/Spacious/Storytelling/Terracotta/Tetris/Vibrant/Vintage。 |
| `bergside/typeui` | 1.2k | — | "Build better UI with AI"——TypeUI CLI 与技能注册表，与 awesome-design-skills 配套。 |
| `bergside/design-md-chrome` | 2.3k | — | Chrome 扩展：从任意网站提取样式并生成 DESIGN.md 与设计 skills（基于 TypeUI），供 Claude/Codex/Gemini 等。 |
| `bergside/design-md-figma` | 118 | — | Figma 插件：提取本地样式指南并生成 DESIGN.md 与 SKILL.md，供 Claude Code/Codex/Cursor 等。 |
| `albertzhangz10/design-system-skill` | 21 | — | Claude Code skill：从任意设计参考（图片/PDF/链接/截图）生成 design.md、design-guidelines.md、design-components.md。 |
| `albertzhangz10/figma-design-system-to-design-md` | 34 | — | Figma design tokens → 结构化 design.md，供 AI 辅助编码（Cursor/Claude Code/Copilot）。 |

## 三、DESIGN.md 生成 / 提取工具（从网站/Figma 反向生成）

| 仓库 | Stars | 说明 |
|---|---|---|
| `dembrandt/dembrandt` | 2k | 一条命令把任意网站设计系统提取成令牌（logo/色彩/排版/边框等），含 DESIGN.md 输出。TypeScript。 |
| `arvindrk/extract-design-system` | 77 | 从公开网站提取设计令牌（色彩/排版/间距/圆角/阴影），生成 JSON 与 CSS 自定义属性。可作为 AI agent skill（Claude/Cursor/Codex）与独立 CLI。 |
| `sunil-dsb/design.md` | 46 | 从任意网站生成 DESIGN.md、Tailwind 主题、令牌、prompts。TypeScript。 |
| `adityarajdigital/designmd` | 46 | 从任意 URL 提取真实设计系统（色彩/排版/间距/断点）为可移植 DESIGN.md。 |
| `hasi98/designpull` | 41 | 用 AI 视觉从任意网站生成 Google Stitch 兼容的 DESIGN.md。自带 key（Gemini/OpenAI/Claude/Ollama），无后端无成本。 |
| `yuvrajangadsingh/brandmd` | 32 | "Stop Claude Code/Cursor from guessing UI"——把任意网站设计系统提取成 Stitch-ready DESIGN.md。 |

## 四、DESIGN.md 衍生 / 垂直应用

| 仓库 | Stars | 说明 |
|---|---|---|
| `maitty8879/xhs-cover-md` | 33 | 把任意公司 DESIGN.md 转成小红书封面，9 种品牌风格（Apple/Claude/Figma/Notion/Tesla/Raycast/Airbnb 等）。 |
| `SlideSpeak/presentation-design-prompts` | 21 | 免费 presentation slide design.md，可粘贴进 ChatGPT/Claude 等 AI 工具。 |
| `hirokaji/jp-ui-contracts` | 65 | 日文 UI 设计契约：DESIGN.md 模板、CSS 配方、日文界面校验规则（CJK 排版）。 |

## 五、Google Stitch 官方 DESIGN.md 规范（源头）

- **概念提出**：Google Stitch —— [stitch.withgoogle.com/docs/design-md/overview](https://stitch.withgoogle.com/docs/design-md/overview/)
- **规范文档**：[stitch.withgoogle.com/docs/design-md/specification](https://stitch.withgoogle.com/docs/design-md/specification/)
- **Google Labs 官方 skill**：`google-labs-code/design-md`（在 VoltAgent/awesome-agent-skills 中收录）——创建并管理 DESIGN.md 文件，配套 `enhance-prompt`（用设计规范词汇增强 prompt）、`react-components`（Stitch→React）、`shadcn-ui`、`stitch-loop`（迭代设计转代码反馈循环）、`remotion`（从 Stitch 设计生成走查视频）。
- **DESIGN.md 标准 9 节**（来自 awesome-design-md）：① 视觉主题与氛围 ② 色彩调色板与角色 ③ 排版规则 ④ 组件样式 ⑤ 布局原则 ⑥ 深度与层级 ⑦ Do's & Don'ts ⑧ 响应式行为 ⑨ Agent Prompt 指南。

## 六、统计小结

- 本次共收录 **26 个**单独以 DESIGN.md 为核心的开源项目（去重）。
- 覆盖 **4 大类**：① 品牌/网站设计系统精选集合（11 个）② DESIGN.md + SKILL.md 双文件设计技能集（6 个）③ DESIGN.md 生成/提取工具（6 个）④ DESIGN.md 衍生/垂直应用（3 个）。
- 头部仓库 VoltAgent/awesome-design-md（92.3k stars）收录 73 个品牌 DESIGN.md；kwakseongjae/oh-my-design 收录 326 个公司 DESIGN.md；bergside/awesome-design-skills 收录 67 个设计风格 SKILL.md+DESIGN.md。
- 含 CJK 本地化项目 4 个（日文 2、中文 2）：kzhrknt/awesome-design-md-jp、hirokaji/jp-ui-contracts、HU-UH/awesome-design-md、fchangjun/awesome-design-md-cn。
- 含工具链项目 4 个：bergside/typeui（CLI）、bergside/design-md-chrome（Chrome 扩展）、bergside/design-md-figma（Figma 插件）、kwakseongjae/oh-my-design（一键安装器 + MCP）。

## 七、与上一份报告的关系

本报告聚焦"单独开源 DESIGN.md 的项目"，是对上一份《全球开源 UI 设计 Agent Skills 全面调研报告》中"设计系统与设计令牌"分类的补充与深化。上一份报告聚焦 SKILL.md 标准的 agent skills，本份聚焦 DESIGN.md 标准（Google Stitch 提出）的设计系统文档项目。两者关系：`AGENTS.md`（构建）+ `DESIGN.md`（外观）+ `SKILL.md`（技能）共同构成 AI 编码 agent 的上下文三件套。
