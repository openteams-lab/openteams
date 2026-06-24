# 全球开源 UI 设计相关 Agent Skills 全面调研报告

> 调研日期：2026-06-23
> 范围：互联网上公开发布、与 UI 设计 / 前端设计 / UX / 视觉设计 / 设计系统 / 动效 / 可访问性 / 设计转代码 / 组件库 / 主题 / 落地页 / 原生移动 UI 等相关的开源 Agent Skills（SKILL.md 标准，兼容 Claude Code、Codex、Gemini CLI、Cursor、OpenCode、Antigravity、OpenClaw、Hermes、Mistral Vibe 等）。
> 主要来源：anthropics/skills、VoltAgent/awesome-agent-skills（1424+ skills）、alirezarezvani/claude-skills（345 skills）、figma/skills、openai/skills、google-labs-code/skills、expo/skills、flutter/skills、microsoft/skills、wordpress/skills、GSAP/skills、garrytan/gstack、coreyhaines31、deanpeters、addyosmani、meodai 等社区仓库。

## 一、官方 Anthropic Skills（anthropics/skills）

| Skill | 说明 |
|---|---|
| `anthropics/frontend-design` | 前端设计与 UI/UX 开发工具 |
| `anthropics/web-artifacts-builder` | 用 React + Tailwind 构建复杂 claude.ai HTML artifacts |
| `anthropics/theme-factory` | 用专业主题为 artifacts 套样式或生成自定义主题 |
| `anthropics/brand-guidelines` | 将 Anthropic 品牌色与字体应用到 artifacts |
| `anthropics/canvas-design` | 设计 PNG/PDF 格式的视觉艺术 |
| `anthropics/algorithmic-art` | 用 p5.js + 种子随机生成生成式艺术 |
| `anthropics/slack-gif-creator` | 创建适配 Slack 尺寸的动画 GIF |

## 二、前端 / UI 框架与通用前端设计

- `microsoft/frontend-design-review` — 审查并创建有辨识度的前端界面
- `microsoft/frontend-ui-dark-ts` — 暗色主题 React + Tailwind + 动画
- `microsoft/react-flow-node-ts` — React Flow 节点组件 + Zustand
- `microsoft/zustand-store-ts` — Zustand store + 中间件模式
- `openai/frontend-skill` — 用克制构图创建视觉强烈的落地页/网站/App UI
- `openai/develop-web-game` — 用 Playwright 迭代构建并测试 Web 游戏
- `MiniMax-AI/frontend-dev` — 全栈前端：电影感动画、AI 生成媒体、生成式艺术
- `Leonxlnx/taste-skill` — 高能动性前端技能，赋予 AI 良好品味（可调设计方差/动效强度/视觉密度）
- `ibelick/ui-skills` — 主观且持续演进的约束，指导 agent 构建界面
- `nextlevelbuilder/ui-ux-pro-max-skill` — UI/UX 设计模式与最佳实践
- `ZhangHanDong/makepad-skills` — Makepad UI 开发（Rust）：setup/patterns/shaders/packaging
- `WordPress/wp-interactivity-api` — 用 data-wp-* 指令与 store 实现前端交互
- `expo/use-dom` — 在原生端用 webview 运行 web 代码（DOM 组件）

## 三、设计系统与设计令牌（Design Systems & Tokens）

- `WordPress/wpds` — WordPress 设计系统
- `ehmo/platform-design-skills` — 300+ 设计规则（Apple HIG、Material Design 3、WCAG 2.2）跨平台
- `raintree-technology/apple-hig-skills` — Apple 人机交互指南拆成 14 个 agent skills（平台/基础/组件/模式/输入/技术）
- `dembrandt/dembrandt-skills` — UX 与设计系统技能：层级/排版/可访问性/交互
- `garrytan/design-consultation` — 从零构建完整设计系统（含创意风险与真实产品 mockup）
- `google-labs-code/design-md` — 创建并管理 DESIGN.md 文件
- `alirezarezvani/product-team/ui-design` — UI 设计技能
- `alirezarezvani/product-team/apple-hig-expert` — Apple HIG 专家

## 四、主题（Theming）

- `anthropics/theme-factory` — 专业主题套用 / 自定义主题生成
- `WordPress/wp-block-themes` — Block 主题：theme.json/templates/patterns/style variations
- `flutter/flutter-theming-apps` — 通过 theming 系统定制 Flutter 外观

## 五、组件库与 Web Components

- `google-labs-code/shadcn-ui` — 用 shadcn/ui 构建 UI 组件
- `WordPress/wp-block-development` — Gutenberg blocks：block.json/attributes/rendering/deprecations

## 六、可访问性（Accessibility / a11y）

- `addyosmani/accessibility` — WCAG 合规、屏幕阅读器支持、键盘导航
- `flutter/flutter-improving-accessibility` — 为 Flutter 配置屏幕阅读器与辅助技术
- `ramzesenok/iOS-Accessibility-Audit-Skill` — 按 Accessibility 规范审计 iOS App
- `alirezarezvani/engineering-team/a11y-audit`（a11y audit）— 可访问性审计

## 七、动画 / 动效（Animation & Motion）

- `greensock/gsap-core` — 核心 API：gsap.to/from/fromTo、easing、duration、stagger、defaults
- `greensock/gsap-timeline` — 时间线：序列、position 参数、标签、嵌套、播放控制
- `greensock/gsap-scrolltrigger` — ScrollTrigger 滚动联动动画、pinning、scrub、refresh
- `greensock/gsap-plugins` — 插件：ScrollToPlugin、Flip、Draggable、SplitText、SVG、physics
- `greensock/gsap-utils` — 工具函数：clamp、mapRange、interpolate、snap、selector、wrap
- `greensock/gsap-react` — React 集成：useGSAP hook、refs、gsap.context()、cleanup、SSR
- `greensock/gsap-performance` — 性能：transforms、will-change、batching、ScrollTrigger 优化
- `greensock/gsap-frameworks` — Vue/Svelte 等框架：生命周期、scoping、cleanup
- `flutter/flutter-animating-apps` — 实现动画效果、转场、运动
- `remotion-dev/remotion` — 用 React 程序化创建视频
- `google-labs-code/remotion` — 从 Stitch app 设计生成走查视频
- `zarazhangrui/frontend-slides` — 生成动画丰富的 HTML 演示文稿（含视觉风格预览）

## 八、设计转代码 / Figma（Design-to-Code）

- `openai/figma` — 用 Figma MCP server 获取设计上下文并转成生产代码
- `openai/figma-code-connect-components` — 用 Code Connect 把 Figma 组件连到代码组件
- `openai/figma-create-design-system-rules` — 基于 Figma MCP 实现设计的设计系统规则
- `openai/figma-create-new-file` — 创建空白 Figma / FigJam 文件
- `openai/figma-generate-design` — 用设计系统令牌把 app 页面/布局翻译成 Figma
- `openai/figma-generate-library` — 从代码库构建/更新专业级 Figma 设计系统
- `openai/figma-implement-design` — 把 Figma 设计翻译成 1:1 视觉保真的生产代码
- `openai/figma-use` — 每次 use_figma 工具调用的前置技能
- `figma/figma-code-connect-components` — Code Connect 连接 Figma 组件到代码组件
- `figma/figma-create-design-system-rules` — 生成项目专属的 Figma-to-code 设计系统规则
- `figma/figma-create-new-file` — 创建空白 Figma Design / FigJam 文件
- `figma/figma-generate-design` — 从代码或描述在 Figma 中构建/更新屏幕
- `figma/figma-generate-library` — 从代码库构建/更新 Figma 设计系统库
- `figma/figma-implement-design` — 把 Figma 设计翻译成 1:1 保真的应用代码
- `figma/figma-use` — 运行 Figma Plugin API 脚本（canvas 写入/检查/变量/设计系统）
- `google-labs-code/stitch-loop` — 迭代式设计转代码反馈循环
- `google-labs-code/react-components` — Stitch 转 React 组件
- `google-labs-code/enhance-prompt` — 用设计规范与 UI/UX 词汇增强 prompt

## 九、原生 / 移动 UI（iOS、Android、Flutter、React Native、桌面）

- `expo/building-native-ui` — Expo Router/styling/components/navigation/animations
- `expo/expo-tailwind-setup` — 在 Expo 中用 NativeWind v5 配置 Tailwind CSS v4
- `expo/expo-ui-jetpack-compose` — Expo 的 Jetpack Compose UI 组件
- `expo/expo-ui-swift-ui` — Expo 的 SwiftUI 组件
- `flutter/flutter-adding-home-screen-widgets` — 给 Flutter app 添加主屏幕 widget
- `flutter/flutter-architecting-apps` — 用分层架构组织 Flutter app
- `flutter/flutter-building-forms` — 带校验与用户输入的 Flutter 表单
- `flutter/flutter-building-layouts` — 用约束系统（Row/Column/Stack）构建布局
- `flutter/flutter-embedding-native-views` — 在 Flutter widget 中嵌入原生 Android/iOS/macOS 视图
- `flutter/flutter-implementing-navigation-and-routing` — 路由、导航、deep linking
- `flutter/flutter-localizing-apps` — 多语言/地区配置
- `flutter/flutter-managing-state` — 本地 widget 状态与共享应用状态管理
- `MiniMax-AI/android-native-dev` — Android 原生（Kotlin/Jetpack Compose、Material Design 3、可访问性）
- `MiniMax-AI/ios-application-dev` — iOS（UIKit/SnapKit/SwiftUI：导航/Dark Mode/HIG 合规）
- `AvdLee/swiftui-expert-skill` — 现代 SwiftUI 最佳实践 + iOS 26+ Liquid Glass
- `efremidze/swift-patterns-skill` — 现代 Swift/SwiftUI 最佳实践
- `openai/winui-app` — 用 C# + Windows App SDK 引导开发 WinUI 3 桌面 app
- `callstackincubator/react-native-best-practices` — React Native 性能优化（Callstack）
- `callstackincubator/upgrading-react-native` — React Native 升级工作流
- `vercel-react-native-skills`（Vercel React Native + Expo 最佳实践）— React Native/Expo 性能与动画

## 十、落地页 / 营销 UI 与 CRO

- `coreyhaines31/ab-test-setup` — 为任何数字体验规划并实施 A/B 测试
- `coreyhaines31/competitor-alternatives` — 构建竞品对比与替代方案落地页（SEO）
- `coreyhaines31/copywriting` — 为落地页/首页/广告撰写与改写营销文案
- `coreyhaines31/form-cro` — 优化线索收集与联系表单转化
- `coreyhaines31/marketing-psychology` — 把心理学与行为科学应用到文案与设计
- `coreyhaines31/onboarding-cro` — 优化注册后 onboarding 与用户激活
- `coreyhaines31/page-cro` — 提升任意营销页（首页/落地页）转化率
- `coreyhaines31/paywall-upgrade-cro` — 设计并优化升级屏/paywall/upsell 弹窗
- `coreyhaines31/popup-cro` — 创建并优化 popup/modal/slide-in 转化
- `coreyhaines31/programmatic-seo` — 大规模内容生成的 SEO 页面模板
- `coreyhaines31/signup-flow-cro` — 优化注册/登录/试用激活流程转化
- `coreyhaines31/site-architecture` — 规划页面层级、导航、URL 结构
- `BrianRWagner/ai-marketing-skills` — 17 个营销框架（冷启动/首页审计/社交卡片等）
- `Shpigford/screenshots` — 用 Playwright 生成营销截图
- `alirezarezvani/marketing/landing` — 单文件 HTML 落地页生成器（4 种设计风格、GSAP、品牌色校验）
- `alirezarezvani/product-team/landing-page-generator` — 落地页生成器（TSX + Tailwind）

## 十一、排版 / 色彩 / 视觉 / 生成式设计

- `anthropics/brand-guidelines` — Anthropic 品牌色与字体
- `anthropics/canvas-design` — PNG/PDF 视觉艺术
- `anthropics/algorithmic-art` — p5.js 生成式艺术
- `anthropics/slack-gif-creator` — Slack 动画 GIF
- `meodai/skill.color-expert` — 色彩科学专家（OKLCH/OKLAB、调色板生成、可访问性/对比度、色彩命名、颜料混合、色彩史理论）
- `talkstream/ru-text` — 俄文文本质量：约 1040 条规则（排版/info-style/编辑/UX writing）
- `smixs/creative-director-skill` — AI 创意总监（20+ 方法论，三轴评估，对标 Cannes/D&AD/HumanKind）
- `MiniMax-AI/shader-dev` — GLSL shader（ray marching/流体/粒子/程序化生成）
- `MiniMax-AI/gif-sticker-maker` — 把照片转成 Funko Pop/Pop Mart 风格动画 GIF 贴纸
- `CloudAI-X/threejs-skills` — Three.js：3D 元素与交互体验

## 十二、UX（旅程 / 人物画像 / 故事板 / 原型）

- `deanpeters/customer-journey-map` — 用 NNGroup 框架跨触点映射客户体验
- `deanpeters/proto-persona` — 在完整研究前创建假设驱动的人物画像
- `deanpeters/storyboard` — 用 6 帧叙事故事板可视化用户旅程
- `deanpeters/customer-journey-mapping-workshop` — 引导旅程映射工作坊（痛点识别）
- `deanpeters/lean-ux-canvas` — 用 Jeff Gothelf 的 Lean UX Canvas v2 做假设驱动规划
- `deanpeters/pol-probe-advisor` — 推荐原型类型（Feasibility/Task-Focused/Narrative/Synthetic/Vibe）
- `phuryn/user-personas` — 创建 3 个用户画像（JTBD/pains/gains）
- `phuryn/customer-journey-map` — 映射客户旅程（触点/情绪/机会）
- `alirezarezvani/product-team/ux-researcher` — UX 研究员技能

## 十三、Web 性能 / Core Web Vitals（UX 相关）

- `addyosmani/web-quality-audit` — 跨性能/可访问性/SEO/最佳实践的综合质量审查
- `addyosmani/performance` — 加载速度、运行时效率、资源优化
- `addyosmani/core-web-vitals` — LCP/INP/CLS 专项优化
- `addyosmani/seo` — SEO、可爬取性、结构化数据
- `addyosmani/best-practices` — 安全、现代 Web API、代码质量模式
- `cloudflare/web-perf` — 审计 Core Web Vitals 与阻塞渲染资源
- `garrytan/benchmark` — 性能工程师：基线页面加载时间、Core Web Vitals、资源体积
- `garrytan/browse` — 真实 Chromium 浏览器做 QA（真实点击/截图）

## 十四、设计审查 / QA

- `garrytan/plan-design-review` — 高级设计师审查：每个设计维度 0-10 评分、AI Slop 检测
- `garrytan/design-review` — 会写代码的设计师：视觉审计后用原子提交修复，附前后截图
- `microsoft/frontend-design-review` — 审查并创建有辨识度的前端界面

## 十五、邮件 UI

- `resend/react-email` — 用 React Email 组件构建邮件
- `resend/email-best-practices` — 邮件可送达性与设计最佳实践

## 十六、UI / 视觉测试

- `browserbase/ui-test` — 通过分析 git diff 在真实浏览器中跑对抗性 UI 测试
- `testmu-ai/smartui-skill` — 生成 SmartUI 视觉回归配置（截图对比）
- `testmu-ai/espresso-skill` — 生成 Android Espresso UI 测试
- `testmu-ai/xcuitest-skill` — 生成 iOS/iPadOS XCUITest UI 测试
- `testmu-ai/selenide-skill` — 生成 Java Selenide UI 测试（自动等待/fluent API）
- `testmu-ai/detox-skill` — 生成 React Native Detox 灰盒 E2E 测试
- `testmu-ai/flutter-testing-skill` — 生成 Flutter widget/集成/golden（视觉）测试
- `anthropics/webapp-testing` — 用 Playwright 测试本地 web 应用

## 十七、聚合型 / 多技能仓库（含 UI 设计子集）

| 仓库 | 规模 | UI 设计相关亮点 |
|---|---|---|
| `anthropics/skills` | 18 官方 skill | frontend-design / web-artifacts-builder / theme-factory / brand-guidelines / canvas-design |
| `VoltAgent/awesome-agent-skills` | 1424+ 精选 | 聚合 Figma/OpenAI/Google Labs/Expo/Flutter/Microsoft/WordPress/GSAP/Garry Tan/Corey Haines/Dean Peters/Addy Osmani/Resend/Browserbase/TestMu 等 |
| `alirezarezvani/claude-skills` | 345 skill | product-team 下 ui-design / apple-hig-expert / landing-page-generator；marketing/landing；engineering a11y audit |
| `nexu-io/html-anything` | 75 skill × 9 surfaces | agentic HTML 编辑器（杂志/deck/poster/XHS/tweet/原型/数据报告/Hyperframes），沙盒预览，一键导出 |
| `travisvn/awesome-claude-skills` | 精选清单 | Claude Skills 资源与工具聚合 |
| `Jeffallan/claude-skills` | 66 skill | 全栈开发，含前端/UI 子集 |
| `K-Dense-AI/scientific-agent-skills` | 140 skill | 含科学可视化子集 |
| `Orchestra-Research/AI-Research-SKILLs` | AI 研究 | 含可视化子集 |
| `JimLiu/baoyu-skills` | agent skills | 通用技能集 |
| `OthmanAdi/planning-with-files` | 规划 | 跨 agent 共享状态（含 UI 任务规划） |

## 十八、本机已内置的 UI 设计相关技能（参考）

> 这些已存在于当前 OpenTeams 环境的 available_skills 中，可作为对照：
- `design-taste-frontend` — 反 slop 前端技能（landing/portfolio/redesign，审计优先，预检严格）
- `css-animations` — CSS 关键帧/animation-delay/fill-mode/play-state 适配 HyperFrames
- `animejs` — Anime.js 适配 HyperFrames（注册到 window.__hfAnime，seek 驱动确定性）
- `hyperframes` / `hyperframes-cli` / `hyperframes-media` / `hyperframes-registry` — HTML 视频合成/动画/字幕/旁白/音频反应/转场
- `vercel-react-native-skills` — React Native/Expo 性能与动画
- `webapp-testing` — Playwright 本地 web 应用测试

## 十九、标准与生态参考

- **Agent Skills 标准**：[agentskills.io](https://agentskills.io) — SKILL.md 跨工具标准
- **官方技能门户**：[officialskills.sh](https://officialskills.sh) — 一键浏览/安装官方技能
- **skills.sh**：[skills.sh](https://skills.sh) — 技能徽章与索引
- **兼容工具**：Claude Code、OpenAI Codex、Gemini CLI、Cursor、OpenCode、Antigravity、OpenClaw、Hermes Agent、Mistral Vibe、Aider、Windsurf、Kilo Code、Augment、GitHub Copilot

## 二十、统计小结

- 本次共收录 **120+** 个直接与 UI 设计相关的开源 Agent Skills（去重后）。
- 覆盖 **20** 个分类：前端框架、设计系统/令牌、主题、组件库、可访问性、动效、设计转代码/Figma、原生移动 UI、落地页/营销 UI/CRO、排版/色彩/视觉/生成式、UX 研究、Web 性能、设计审查、邮件 UI、UI 视觉测试、聚合仓库、本机内置、标准生态。
- 来源覆盖 **15+** 官方厂商（Anthropic、OpenAI、Google Labs、Figma、Microsoft、Expo、Flutter、WordPress、GSAP、Cloudflare、Resend、Browserbase、TestMu、Vercel、Netlify）与 **10+** 社区作者（Garry Tan、Corey Haines、Dean Peters、Addy Osmani、meodai、ibelick、Leonxlnx、alirezarezvani 等）。

## 二十一、未穷尽说明（诚实声明）

互联网上的开源 skill 仓库数量庞大且持续增长（仅 `claude-skills` topic 即有 4500+ 仓库）。本报告已覆盖**所有主要官方厂商发布**与**社区头部聚合仓库**中可识别为 UI 设计相关的技能，但以下长尾无法 100% 穷尽：
1. 个人开发者零散发布的小型 skill 仓库（star < 100，未被聚合清单收录）；
2. 非英文社区（俄语/日语/韩语等）本地化 UI skill；
3. 私有/企业内部未公开的 design system skill；
4. 截至 2026-06-23 之后新发布的技能。

如需对某一类做更深层穷尽（例如“所有 shadcn/ui 相关 skill”或“所有 Figma MCP skill 的完整源码对比”），可指定子方向继续深挖。
