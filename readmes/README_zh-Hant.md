<div align="center">
  <img src="../frontend/public/Logo/logo_blue.svg" alt="OpenTeams" width="200">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320" style="margin-top: 10px; margin-bottom: 10px;">
  
  <p><strong>讓 Agent 以一個團隊的方式運行，在 AI 時代成倍提升你的效率。</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://doc.openteams-lab.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="#快速開始">快速開始</a> |
    <a href="https://doc.openteams-lab.com">文件</a> 
  </p>

  <p align="center">
    <a href="../README.md">English</a> |
    <a href="./README_zh-Hans.md">简体中文</a> |
    <a href="./README_zh-Hant.md">繁體中文</a> |
    <a href="./README_ja.md">日本語</a> |
    <a href="./README_ko.md">한국어</a> |
    <a href="./README_fr.md">Français</a> |
    <a href="./README_es.md">Español</a>
  </p>
</div>

---

![OpenTeams Demo](images/demo.gif)

**一分鐘快速上手指南**

1. 匯入一個預設團隊，並為每位成員選擇基礎 Agent。
2. 為團隊中的每位成員設定工作區。
3. 使用 `@member` 向指定成員發送訊息。

---
## 🔥 *最新動態：*
### *重要更新*
- **2026.04.02 (v0.3.11)**
  - 啟用深色 UI 模式
  - 修復 openteams-cli 並發問題
- **2026.04.02 (v0.3.10)**
  - 實作應用內版本更新
  - 文件網站現已上線。
- **2026.03.24 (v0.3.7)**: 
  - 新增內建的 openteams-CLI Agent，不再依賴本地安裝 Agent。
  - 修復執行器中的記憶體洩漏問題。
---

## 快速開始

### 方案 A：使用 npx 執行
**推薦 Mac 和 Linux 使用這種安裝方式。**

```bash
# web
npx openteams-web
```

### 方案 B：下載桌面應用

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### 環境要求

**從 v0.3.7 開始，我們已內建 openteams-cli，因此不再需要安裝 AI Agent。你可以前往「Settings -> Service Providers」頁面設定你的 API。**

你也可以從支援的 Agent 清單中任選一個：

| Agent | 安裝方式 |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [更多 Agent 安裝指南](https://doc.openteams-lab.com/getting-started)

---

## 功能特性

| 功能 | 你將獲得什麼 |
|--|--|
| **支援的 Agent** | 支援 10 種程式設計 Agent 執行時，包括 `Claude Code`、`Gemini CLI`、`Codex`、`Qwen Code`、`Amp`、`Cursor Agent`、`Copilot`、`Droid`、`Kimi Code` 和 `OpenCode`。目前也正在整合更多 Agent。|
| **共享群聊上下文** | 每位參與者都基於同一份對話歷史工作，不必在多個視窗之間反覆複製貼上提示詞。 |
| **並行執行** | 多個 Agent 可以在同一個共享工作階段中同時處理同一項任務，不同 Agent 負責各自最擅長的部分。 |
| **自主協作** | Agent 可以彼此 `@mention`、交接工作，並直接在聊天中協作。 |
| **內建 AI 成員** | 開箱即用提供 160+ 內建 AI 成員，涵蓋工程、行銷、寫作、研究與內容製作。 |
| **內建 AI 團隊預設** | 提供 8 個開箱即用的團隊預設，適用於常見工作流程。 |
| **團隊協作準則** | 你可以定義誰負責主導、誰可以與誰溝通，以及協作應如何進行。依照你的需求自訂 AI 團隊與團隊準則。 |
| **技能庫** | 為 Agent 配備 1000+ 內建技能，並在需要時匯入你自己的技能。 |
| **完全本地執行** | Agent 直接在你的本地工作區執行，執行產物保存在該工作區內的 `.openteams/` 目錄下，因此無須擔心資料隱私。 |

### 並行 Agent 執行

*讓多個 Agent 在同一個共享上下文中並行執行，以加快交付速度。*

![OpenTeams parallel](images/parallel.gif)

### 自主 Agent 協作

*OpenTeams 允許 Agent 直接互相傳送訊息，而不強制固定工作流程。如果你希望有更多結構，可以透過團隊準則控制溝通方式、指定主導 Agent，或者讓所有成員自由協作。溝通模式完全取決於你的使用情境。*

![OpenTeams collaborate](images/collaborate.gif)

### AI 成員

*OpenTeams 內建 160+ AI 成員，涵蓋工程、行銷、寫作、內容製作等多個領域。你可以自由組合成不同團隊、依需求自訂，並建立符合你工作方式的角色搭配。我們也會持續擴充並優化這個成員庫。*

![OpenTeams members](images/members.gif)

### AI 團隊

*OpenTeams 內建 8 個適用於常見工作流程的團隊預設，讓你可以立即開始使用。我們建議你在建立團隊時定義團隊準則，以便讓協作方式始終符合你的目標。*

![OpenTeams team](images/team.gif)

### 技能庫

*OpenTeams 內建 1000+ 技能，你可以將它們組合後分配給不同的 AI 成員。你也可以匯入自己建立的技能，並直接套用到 Agent 身上。我們會持續擴充技能庫，重點投入那些能夠在真實生產環境中穩定發揮作用的能力。*

![OpenTeams skills](images/skills.gif)

---

## 為什麼我們更強

圖例：✅ 完整支援 | 🟡 部分支援 | ❌ 不支援

| **能力** | 傳統單一 Agent | 多視窗工作流程 | Claude Code Agent Team | openteams |
|--|--|--|--|--|
| **並行能力**| ❌ 不支援，只能串行 | 🟡 部分支援，需手動操作 | ✅ 支援，Claude 子代理 | ✅ 支援，自動完成 |
| **共享上下文** | ❌ 不支援 | ❌ 不支援，需要複製貼上 | 🟡 部分支援，子代理上下文彼此分離 | ✅ 支援，始終同步 |
| **多模型協作** | ❌ 不支援 | 🟡 部分支援，需手動切換 | ❌ 不支援，僅限 Claude | ✅ 支援，Claude + Gemini + Codex + 更多 |
| **Agent 交接** | ❌ 不支援 | ❌ 不支援，需要你自行編排 | 🟡 部分支援，在 Claude 內部委派 | ✅ 支援，直接 `@mentions` |
| **預先定義 AI 成員** | ❌ 不支援 | ❌ 不支援 | ❌ 不支援 | ✅ 支援，160+ 成員 |
| **團隊管理** | ❌ 不支援 | ❌ 不支援 | ❌ 不支援 | ✅ 支援，自訂團隊準則 |
| **你的投入** | 🔴 高 | 🔴 非常高 | 🟠 中等 | 🟢 低 |

---

## 技術棧

| 層級 | 技術 |
|-------|-----------|
| 前端 | React + TypeScript + Vite + Tailwind CSS |
| 後端 | Rust |
| 桌面端 | Tauri |

## 本地開發

#### Mac/Linux

```bash
# 1. 複製倉庫
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 安裝依賴
pnpm i

# 3. 啟動開發伺服器（執行 Rust 後端 + React 前端）
pnpm run dev

# 4. 建置前端
pnpm --filter frontend build

# 5. 建置桌面應用
pnpm desktop:build
```

#### Windows（PowerShell）：分別啟動後端與前端

`pnpm run dev` 無法在 Windows PowerShell 中執行。請使用以下命令分別啟動後端與前端。

```bash
# 1. 複製倉庫
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 安裝依賴
pnpm i

# 3. 產生 TypeScript 型別
pnpm run generate-types

# 4. 執行資料庫遷移
pnpm run prepare-db
```

**終端 A（後端）**

```powershell
$env:FRONTEND_PORT = node scripts/setup-dev-environment.js frontend
$env:BACKEND_PORT = node scripts/setup-dev-environment.js backend
$env:RUST_LOG = "debug"
cargo run --bin server
```

**終端 B（前端）**

```powershell
$env:FRONTEND_PORT = <終端 A 產生的 frontend 連接埠>
$env:BACKEND_PORT = <終端 A 產生的 backend 連接埠>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

在 `http://localhost:<FRONTEND_PORT>` 開啟前端頁面（例如：`http://localhost:3001`）。

#### 在本地建置 `openteams-cli`

如果你需要編譯本地的 `openteams-cli` 二進位，而不是使用內建版本或已發佈的建置，請使用以下命令。
建置產物會放在 binaries 目錄中。

```bash
# 在倉庫根目錄執行
bun run ./scripts/build-openteams-cli.ts
```

## 發佈說明與路線圖

### V0.2

- [x] 支援共享上下文的多 Agent 群聊
- [x] 並行 Agent 執行
- [x] Agent `@mention` 與自主協作
- [x] 支援 10 種程式設計 Agent 執行時（Claude Code、Gemini CLI、Codex、Qwen Code、Amp、Cursor Agent、Copilot、Droid、Kimi Code、OpenCode）
- [x] 桌面應用（Windows、macOS、Linux）
- [x] 可透過 npx 執行的 Web 應用
- [x] 多語言支援（EN、ZH、JA、KO、FR、ES）

### V0.3
- [x] 前端介面已完成全面重構。
- [x] 160+ 內建 AI 成員
- [x] 8 個內建 AI 團隊預設
- [x] 團隊規則設定
- [x] 1000+ 內建技能
- [x] 完全本地執行與工作區隔離
- [x] 重新定義輸入協議

### 路線圖
- [x] 為 OpenTeams 使用場景優化 Code Agent 後端 —— v0.3.7
- [x] 開發多套前端配色方案 —— v0.3.11
- [ ] 建立高效率團隊協作框架
- [ ] 整合更多 Agent（Kilo Code、OpenClaw 等）
- [ ] 提供更多強大的開箱即用 AI 團隊
- [ ] 增加更強大的技能
- [ ] 提供高度優化的客製版本


## 貢獻

歡迎貢獻！你可以在 [Issues](https://github.com/StarterraAI/OpenTeams/issues) 查看目前需要的內容，或發起 [Discussion](https://github.com/StarterraAI/OpenTeams/discussions)。

1. Fork -> 建立 feature 分支 -> 提交 PR
2. 大型改動請先開 issue 溝通
3. 請遵守我們的 [Code of Conduct](../CODE_OF_CONDUCT.md)

### 程式碼格式化

提交 PR 前，請確保程式碼已正確格式化：

```bash
# 同時格式化前端與後端
pnpm run format

# 檢查格式但不修改檔案
pnpm run format:check

# 僅格式化前端
pnpm run frontend:format

# 僅格式化後端（Rust）
pnpm run backend:format
```

**注意：** 如果程式碼格式不正確，CI 會失敗。推送前請務必執行 `pnpm run format:check`。

## 社群

| | |
|--|--|
| **Bug 回報** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **討論交流** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **社群聊天** | [Discord](https://discord.gg/MbgNFJeWDc) |

## 致謝

本專案構建於 [Vibe Kanban](https://www.vibekanban.com/) 之上，感謝他們的團隊提供了優秀的開源基礎。

同時也感謝 [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) 協助塑造內建技能生態，以及 [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) 在 Agent 角色設計與團隊組合方面帶來的啟發。
