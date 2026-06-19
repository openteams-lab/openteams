# DESIGN_MAIN.md

## 设计定位

本项目当前页面是偏工程工作台的产品界面，整体应保持克制、紧凑、可扫描，而不是营销页或强装饰视觉。界面重点是让用户快速在项目导航、会话、工作流页面、设置和关联文件之间切换，并在长时间工作中保持低干扰。

设计关键词：

- 工具型：信息密度较高，避免大面积宣传式 hero、装饰图形和过度卡片化。
- 低噪音：背景、边框、文字层级都使用设计变量，不使用突兀色块。
- 可扫描：标题、列表、状态、文件路径、数字信息保持明确层级。
- 可伸缩：tab、右侧栏、成员头像、文件名都需要随容器宽度响应。
- 双主题：深色为默认，浅色模式必须完整继承同一套变量。

## 设计变量

全局 token 来源于 `src/index.css`，新增页面或组件应优先使用 CSS 变量，而不是直接写固定颜色。

### 字体

- 正文字体：`Inter`
- 等宽字体：`JetBrains Mono`
- 工作台根节点使用 `font-sans antialiased`
- 文件路径、成本、快捷键、计数、模型名等技术信息使用 `font-mono`

### 色彩

基础背景：

- `--canvas`：应用最外层背景、侧边栏背景、会话主背景
- `--surface-1`：一级浮层、输入框、列表项、卡片内层
- `--surface-2`：页面内容包裹框背景、选中面
- `--surface-3`：hover、弱强调背景、胶囊计数背景
- `--surface-4`：更高一级的弱背景，仅在局部需要时使用

边框：

- `--hairline`：默认细边框
- `--hairline-strong`：强调边框、输入框 focus 前边框、浮层边框
- `--hairline-tertiary`：较强的弱分隔线，谨慎使用

文字：

- `--ink`：主要文字
- `--ink-muted`：正文/说明文字
- `--ink-subtle`：次级文字、图标默认态
- `--ink-tertiary`：标签、时间、空态、辅助数字

品牌色：

- `--primary`：主操作、激活图标、focus ring
- `--primary-hover`：主操作 hover
- `--primary-tint`：主色浅背景
- `--success`：成功状态

状态色：

- 关联文件 `M`：amber
- 关联文件 `A`：emerald
- 关联文件 `D`：rose
- 错误提示：red 透明背景加 red 边框

## 应用布局

根布局见 `src/App.tsx`：

- 页面占满视口：`h-screen w-screen overflow-hidden`
- 左侧导航固定宽度：桌面端 `w-56`，移动端使用抽屉
- 主工作区外边距：移动端 `p-2`，桌面端 `md:p-3`
- 主内容由顶部 tab 区和下方内容框组成：`gap-2`
- tab 区高度：`h-10`
- 内容包裹框统一使用小圆角矩形：
  - `rounded-lg`
  - `border border-[var(--hairline)]`
  - `bg-[var(--surface-2)]`
  - 常规页面 `p-4 md:p-6 overflow-y-auto`
  - 设置页使用 `p-0 overflow-hidden`，让设置页面铺满包裹区域

## 左侧导航

左侧导航见 `src/components/ProjectSidebar.tsx`。

### 区域结构

- 背景使用 `--canvas`
- 顶部控制区高度 `h-10`
- 项目切换区使用小尺寸大圆角项目头像：
  - 蓝色 `--primary` 背景
  - 无额外外边框
  - 尺寸紧凑，圆角偏大
- 主列表区域使用较大的垂直空白分组：`space-y-5.5`
- 分组之间优先用空白分隔，不用分隔线

### 标签与列表项

- 分组 label：`text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-tertiary)]`
- 导航 item：`text-[14px]`，高度紧凑，圆角 `rounded-md`
- item 默认态：透明边框、`text-[var(--ink-subtle)]`
- item hover：`bg-[var(--surface-1)] text-[var(--ink)]`
- item active：`border-[var(--hairline)] bg-[var(--surface-1)] font-medium text-[var(--ink)]`
- active 图标使用 `--primary`

## Tab 区

tab 区见 `src/App.tsx`。

- tab 不因左侧导航打开页面而新增无关 tab；导航打开页面应替换当前 tab。
- 所有从左侧导航打开的页面都进入 tab 模型，包括设置、AI team、GitHub 等。
- tab 容器跟随主题，使用 `bg-[var(--canvas)]`，浅色模式不得残留纯黑。
- tab 宽度随 tab 区整体宽度自适应：
  - `flex: 1 1 clamp(7rem, 22%, 15rem)`
  - `min-w-0 max-w-60`
  - 文本必须 `truncate`
- tab 高度 `h-8`，整体区域 `h-9`
- active tab：`bg-[var(--surface-3)] text-[var(--ink)] font-semibold shadow-sm`
- inactive tab：透明背景，`opacity-75`，hover 时提升背景和文字层级
- tab 关闭按钮仅在 hover 或 active 时清晰显示，使用 lucide `X`
- 新增会话 tab 按钮为 `h-8 w-8` 图标按钮

## 页面内容规范

通用页面见 `src/pages/*Page.tsx`。

- 常规页面宽度：`max-w-6xl mx-auto`
- 页面段落间距：`space-y-6`
- 页面标题区：
  - 外层 `pb-4 mb-2`
  - `h1` 使用 `text-base font-bold tracking-tight text-[var(--ink)]`
  - 描述使用 `text-xs text-[var(--ink-subtle)] mt-1`
- GitHub 占位页面保持空白占位：`h-full min-h-[320px] w-full`
- 设置页不额外加背景色和直角边框，由外层内容包裹框提供背景和圆角裁切

## 会话工作区

会话页面见 `src/components/FreeChatWorkspace.tsx`。

### 主结构

- 嵌入态占满父容器，不重复加外层卡片背景
- 非嵌入态可使用 `rounded-xl border bg-[var(--canvas)]`
- 会话主区域 `p-4`
- 消息列表使用 `ScrollArea`，底部输入框固定在最底部，不能随消息列表滚动

### 消息样式

- 消息间距：`space-y-4`，单条消息头像和内容 `gap-3`
- 用户头像：圆形，`--primary` 背景，白色 `YOU`
- Agent 头像：圆形，`--mono-bg` 背景，`--mono-border` 边框
- 发送者名称：`text-[11px] font-semibold`
- 时间：`text-[10px] font-mono text-[var(--ink-tertiary)]`
- 正文消息：`text-[13px] leading-relaxed text-[var(--ink-muted)]`
- 行内代码：`text-[11px] font-mono`，使用 `--mono-bg` 和 `--mono-border`
- @mention：使用 `--primary`，hover 使用 `--primary-hover`

### 输入框

- 输入框区域固定在底部，外层 `shrink-0`
- 输入框视觉为圆角胶囊卡片：
  - `rounded-3xl`
  - `border border-[var(--hairline-strong)]`
  - `bg-[var(--surface-1)]`
  - `min-h-[95px]`
  - focus 使用 `--primary` 边框和 1px ring
- textarea 文本 `text-[11px]`，透明背景，无原生边框
- 底部工具栏使用图标按钮和小号胶囊按钮
- 发送按钮启用态使用 `--primary`，禁用态使用 `--surface-3` 和 `--ink-tertiary`

## 右侧会话栏

右侧栏包含“会话成员”和“关联文件”，见 `src/components/FreeChatWorkspace.tsx`。

### 布局与开关

- 默认宽度 `280px`
- 可拖拽范围：`256px` 到 `420px`
- 桌面端使用三列 grid：主内容、`6px` 拖拽分隔线、右侧栏
- 移动/窄屏时右侧栏进入下方行布局
- 右侧栏开关按钮固定在右侧栏右上角，不随内部内容位置变化
- 分隔线只用于拖拽宽度，不作为区域视觉分割
- “会话成员”和“关联文件”之间用较大的空白间隔，而不是分隔线

### 会话成员

- 标题：`text-[14px] font-semibold`
- 头像轨道高度：`h-9`
- 成员头像：`h-7 w-7 rounded-full`
- 默认收起态至少显示 5 个成员头像
- 成员过多时显示 `...`，且 `+` 邀请按钮必须始终紧挨可点击
- 点击 `...` 后展开为可横向滚动成员列表
- 展开后使用明确的收起图标，当前为 lucide `ChevronsLeft`
- hover 展开成员名时不得改变垂直布局高度
- 滚动条不得挤压成员上下空间，必要时保留底部 padding

### 关联文件

- 标题：`text-[14px] font-semibold`
- 计数胶囊：`text-[13px] font-mono`
- 文件列表项：
  - 高度 `h-8`
  - 背景 `bg-[var(--surface-1)]`
  - 圆角 `rounded-md`
  - hover 使用 `bg-[var(--surface-3)]`
  - 字号统一 `13px`
- 文件路径使用 `font-mono text-[13px] truncate`
- 只有发生截断时才显示原生 `title` tooltip
- 增删数字使用等宽字体：
  - additions：emerald
  - deletions：rose
- 文件状态使用末尾单字母：
  - `M` 修改
  - `A` 新增/未追踪
  - `D` 删除
- 列表项点击后进入 diff 预览流程；当前为 mock toast

## 设置页面

设置页由 `src/pages/SettingsPage.tsx` 承载，内部为 `SettingsWorkspace`。

- 设置页不应再包一层直角背景或独立背景色
- 页面必须铺满外层圆角包裹区域：`h-full w-full`
- 左侧设置导航可使用内部边框和滚动
- 表单项、主题卡、供应商列表使用 `--surface-1`/`--surface-2` 和 `--hairline`
- toggle 使用主色表示开启，弱背景表示关闭

## 卡片、边框与圆角

- 页面级包裹框：`rounded-lg`
- 工具或模块卡片：`rounded-xl`
- 列表项、导航项、按钮：`rounded-md`
- 小徽标、计数、状态：`rounded-full` 或小 `rounded`
- 不要把页面 section 做成一层又一层的浮动卡片
- 只有重复项、弹窗、工具面板适合使用卡片
- 分隔信息优先用空白和层级，少用横线/竖线

## 图标与按钮

- 图标优先使用 `lucide-react`
- 纯图标操作必须有 `aria-label`，必要时加 `title`
- 明确命令可使用 icon + text，例如 `Update Plan`
- 收起/展开、关闭、发送、语音、添加等操作使用熟悉图标
- 不要用文字按钮替代已有明确图标语义的操作

## 滚动条

滚动条统一通过 `src/components/ScrollArea.tsx` 使用。

- 默认样式类：`ot-scroll-area-styled`
- 隐藏样式类：`ot-scroll-area-hidden`
- 滚动条宽高：`5px`
- thumb：`var(--hairline-strong)`
- hover thumb：`var(--ink-tertiary)`
- track：透明
- 不使用带箭头的滚动条样式
- 需要横向滚动的区域使用 `orientation="horizontal"`
- 不希望出现滚动条的头像收起态使用 `scrollbar="hidden"`

## 状态提示

状态提示见 `src/components/ResourceState.tsx`。

- loading、empty、fallback 使用中性提示：
  - `rounded-lg border`
  - `bg-[var(--surface-1)]`
  - `text-[11px]`
- error 使用红色透明背景和红色边框
- compact 状态不展示 detail
- retry 按钮使用小号等宽文字和边框按钮
- 会话页不应显示无意义的后端 workflow 警告占位

## 响应式规则

- 桌面端显示固定左侧栏；移动端用抽屉
- 主内容必须 `min-w-0 min-h-0`，避免 flex/grid 子项撑破容器
- 长文本默认 `truncate`，必要时通过 tooltip 补充
- tab、关联文件栏、成员头像数量都应随容器宽度响应
- 宽度变化时不要出现内容重叠或垂直抖动

## 新增页面检查清单

新增或修改页面时，应逐项确认：

- 是否使用 `--canvas`、`--surface-*`、`--ink-*`、`--hairline*` 等变量
- 深色和浅色模式是否都自然适配
- 页面是否进入统一 tab 和圆角内容包裹框
- 文字是否遵循当前字号层级
- 是否避免了嵌套卡片和无意义分隔线
- 是否使用 lucide 图标和必要的 `aria-label`
- 长文本是否有 `truncate`、`min-w-0` 和合理 tooltip
- 滚动区域是否使用 `ScrollArea`
- 空态、加载态、错误态是否与 `ResourceStateNotice` 风格一致
- 移动端和窄宽度下是否不会重叠、裁切或抖动
