<div align="center">
  <img src="../frontend/public/logos/logo_blue.svg" alt="OpenTeams" width="100">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>規劃、構建、交付——不再只靠一個 AI，而是與你的 AI 團隊並肩完成</h5>

  <p>
    多個 AI 智能體共享同一份上下文——既可以通過聊天自由協作，也可以用可視、可審查、可重試的工作流來編排複雜任務。
  </p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="images/openteams-wechat-community.png"><img alt="WeChat" src="https://img.shields.io/badge/WeChat-Join%20Group-07C160?style=flat-square&logo=wechat&logoColor=white" /></a>
    <a href="images/openteams-feishu-community.png"><img alt="Feishu/Lark" src="https://img.shields.io/badge/Feishu%2FLark-Join%20Group-3370FF?style=flat-square" /></a>
    <a href="https://doc.openteams-lab.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="#快速開始">快速開始</a> |
    <a href="https://doc.openteams-lab.com">文檔</a> 
  </p>

  <p align="center">
    <a href="../README.md">English</a> |
    <a href="./README_zh-Hans.md">簡體中文</a> |
    <a href="./README_zh-Hant.md">繁體中文</a> |
    <a href="./README_ja.md">日本語</a> |
    <a href="./README_ko.md">한국어</a> |
    <a href="./README_fr.md">Français</a> |
    <a href="./README_es.md">Español</a>
  </p>
</div>

---
<div align="center">
  <video src="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d" controls width="100%">
    <a href="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d">觀看產品影片</a>
  </video>
</div>

## 什麼是 openteams

**openteams** 是一款開源的多智能體協作應用。它支持把 Claude Code、Codex、Gemini CLI 等多個 AI 編程智能體帶入同一個共享會話，讓它們可以交流、共享上下文，並像團隊一樣協同工作。你可以通過輕量的自由聊天模式與智能體進行對話式協作，也可以通過結構化的工作流圖表來編排複雜任務，做到計劃可視化、任務級控制和可追溯審查等。所有內容都在你自己的本地工作區中運行，無需擔心隱私問題。

## 爲什麼選擇 openteams

AI 智能體已經越來越擅長規劃、編碼、審查和測試。但更多智能體輸出，並不意味着會自動變成真正交付的工作。

**管理多個 Agent 令人疲憊。** 你在終端之間反覆切換，每換一個 Agent 都要重新交代背景，把上一個 Agent 的輸出手動搬到下一個的提示詞裏，還要人肉合併相互矛盾的 diff。你的注意力在多個 Agent 的混亂切換中被消耗殆盡。

**Agent 的執行過程既看不見，也控不住。** 你讓 Claude Code「把這個功能做完」，它跑了 15 分鐘。你完全不知道它拆了哪些子任務、哪些跑通了、哪些被它悄悄跳過了。當前大多數編程 Agent 把複雜任務當作一次性的黑盒執行——執行前沒有可見計劃，執行中無法逐步審批或否決，失敗了也沒法只重試出問題的那一步。一旦出錯，只能從頭再來。

**openteams** 同時解決這兩個問題。所有Agent在同一個會話總**共享同一份上下文**，你再也不用反覆在多個Agent中進行來回切換倒騰了。複雜任務會變成**可見、可控的工作流圖表**——你可以在執行前審閱和調整計劃，實時觀察每個步驟的進展，並隨時介入任意節點：批准、拒絕、重試或重新指派。

> 真正的生產力槓桿不在於擁有更多 Agent，而在於用一份看得見的計劃和一組控得住的步驟來編排指揮它們。

## 常見使用場景

你輸入：“給工作區增加 GitHub issue 同步功能。”


1. **主 Agent 澄清需求：** 它會詢問同步方向（單向還是雙向？）、衝突處理方式（跳過、覆蓋還是記錄？），以及要映射哪些 issue 字段。你確認：單向拉取、記錄衝突、映射 title/body/labels/status。
2. **主 agent 設計方案並生成執行計劃：** 計劃顯示 5 個步驟：`Backend: OAuth + GitHub API` → `Backend: Sync Engine` → `Frontend: Sync Status UI` → `Integration Tests` → `Final Review`。每一步都有明確範圍、分配的智能體和驗收標準。
3. **你審查並批准計劃：** 在任何代碼運行前，你可以調整步驟、重排依賴或重新分配智能體。
4. **智能體執行，你實時觀察進度：** `Backend: OAuth` 先運行。完成後，`Sync Engine` 和 `Frontend: Sync Status UI` 並行啓動。每個步驟都會在工作流圖上顯示狀態、diff 和日誌。
5. **你審查並批准每個完成的步驟：** `Backend: OAuth` 完成後，你檢查 diff，看到 token refresh 邏輯，然後批准。後續步驟繼續推進。
6. **某一步失敗，你只重試該步驟：** `Integration Tests` 失敗，因爲同步引擎返回了原始時間戳而不是 ISO 格式。你查看錯誤日誌，然後只重試 `Integration Tests` 這一步。其餘工作流保持不變。
7. **最終審查與驗收：** 所有步驟通過。你審查完整 diff、產物和測試結果，然後接受。
8. **通過自由聊天模式跟進：** 兩天後，用戶反饋同步狀態徽標在輪詢時閃爍。你打開自由聊天模式：`@Frontend Agent 的同步狀態標誌在輪詢時會閃爍 —— 請對狀態更新進行防抖處理。`。一輪修復完成，不需要啓動工作流。

## 快速開始
### 安裝
#### npx

```bash
npx openteams-web
```

#### 桌面應用

請從 GitHub Releases 下載適合你平臺的最新版本。

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### 配置提供商

**openteams** 內置 openteams CLI 智能體。你可以在應用中通過 `menu->setting->provider config->add provider` 配置模型提供商。參考文檔：

⚙️ [提供商配置](https://doc.openteams-lab.com/advanced-usage/custom-provider)

你也可以連接以下openteams支持的編程智能體：

| Agent | 安裝示例 |
| --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Gemini CLI | `npm i -g @google/gemini-cli` |
| Codex | `npm i -g @openai/codex` |
| Qwen Code | `npm i -g @qwen-code/qwen-code` |
| OpenCode | `npm i -g opencode-ai` |

📚 [更多智能體安裝指南](https://doc.openteams-lab.com/getting-started)

### 30 秒上手
**前置條件：配置一個 API 服務提供商，或安裝任意一個openteams支持的 Code Agent。**

*第 1 步。* 創建一個羣聊會話。添加一個或多個成員，併爲每個成員分配模型和角色。

*第 2 步。* 在自由聊天模式中，用 `@` 提及任意成員來發送消息或分配任務。

*第 3 步。* 切換到工作流模式。與主agent討論需求、細化方案，並生成執行計劃。

*第 4 步。* 啓動執行，並在每個任務節點完成時審查結果。

## 工作模式

**openteams** 提供兩種協作模式，因爲不是所有任務都需要同樣的結構化程度。可以類比 **Claude Code 的 Plan 與 Build 模式**，但這裏是面向多 Agent 團隊的：想讓 Agent 自由探索討論時用自由聊天模式，需要可靠、可預期的執行時用工作流模式。

### 自由聊天模式

在自由聊天模式中，你用 `@` 給任意 Agent 發送任務，Agent 之間也可以自由傳遞消息。協作規則由你定義的團隊協議約束——誰負責什麼、如何交接、遵循哪些標準。

**自由聊天模式**適合小修復、快速審查，以及不值得啓動完整工作流的探索性討論。

![](images/free_chat.png)

### 工作流模式

工作流模式專爲複雜任務設計——當任務需要拆分爲多個子任務，且你需要全程觀察進度、在每一步保持可控執行時，它就是最佳選擇。

主 Agent 負責驅動規劃階段：澄清需求、設計方案、制定執行計劃，並將任務分配給合適的 Agent。最終生成一張可視化的工作流圖，包含步驟、依賴關係、審查節點、重試機制和驗收點。

![](images/openteams-workflow.png)

工作流模式不會讓 Agent 鬆散地串聯運行，而是把工作轉化爲有狀態的執行圖。

**注意：工作流模式會消耗更多 token。請確保你的 token 餘額充足。**

## 重要更新
- **2026.05.20 (v0.4.4)**
  - 工作流模式 beta 版
- **2026.05.07 (v0.3.22)**
  - 支持一鍵將羣聊會話中的成員保存爲預設團隊
- **2026.04.14 (v0.3.15)**
  - 工作區文件變更查看器
- **2026.04.06 (v0.3.12)**
  - 啓用深色 UI 模式
  - 修復 openteams-cli 併發問題
- **2026.04.02 (v0.3.10)**
  - 實現應用內版本更新
  - 文檔網站已上線

## 路線圖

openteams 正在積極開發中。接下來我們會朝這些方向推進：

- [ ] **專家型的AI員工** — 推出更多擁有專業領域知識，能解決專業問題的AI員工。
- [ ] **高產出的AI團隊** — 由高效的專家AI員工組成，可針對特定業務定製化生產工作流程，端到端將需求轉換爲產出結果。
- [ ] **集成更多智能體** — 集成更多常用Agent，如Kilo code, hermes-agent, openclaw等。

***願景：把 token 消耗轉化爲真正的生產力。***

有功能建議，或想參與塑造產品方向？歡迎[發起討論](https://github.com/openteams-lab/openteams/discussions)。

## 社區

- [GitHub Issues](https://github.com/openteams-lab/openteams/issues)：bug 報告和功能請求
- [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions)：產品想法和問題
- [Discord](https://discord.gg/openteams)：社區聊天
- [Linux.do](https://linux.do)：友情連結，感謝提供社群交流支援
- 社區群：

<p>
  <a href="images/openteams-wechat-community.png"><img alt="openteams 微信交流群二維碼" src="images/openteams-wechat-community.png" width="260"></a>
  <a href="images/openteams-feishu-community.png"><img alt="openteams 飛書交流群二維碼" src="images/openteams-feishu-community.png" width="260"></a>
</p>

## 核心功能

| 功能 | 含義 |
| --- | --- |
| AI 員工與 AI 團隊 | 把 token 直接轉化爲生產力。每個 AI 員工或團隊都擁有特定領域的專業知識，能將通用模型提升爲領域專家——不只是生成文本，而是真正產出可交付的工作成果。 |
| 多智能體工作區 | 把多個 AI 智能體帶入同一個共享會話，不再在多個窗口之間來回切換。 |
| 共享上下文 | 智能體基於同一份對話和項目上下文工作。 |
| 自由聊天模式 | 使用 `@` 進行直接、輕量的智能體協作。 |
| 工作流模式 | 將複雜任務轉換爲結構化步驟、依賴、審查、重試和驗收。 |
| 可見執行 | 看到每個智能體正在做什麼，以及工作卡在哪裏。 |
| 審查與重試 | 審查某一步的結果，精確重試失敗的任務，無需重啓整個項目。 |
| 產物與軌跡 | 將日誌、diff、轉錄和生成的產物附加到工作上。 |
| 本地工作區執行 | 智能體在你配置的工作區中工作，運行記錄保存在 `.openteams/` 下。 |

## 適合誰

openteams 適合：

- 正在使用多個編程智能體、但已經厭倦來回切換和協調的開發者
- 需要讓智能體執行過程可審查、可重現的技術負責人

它不只是一個收納更多 Agent 的容器，而是把 Agent 變成真正能協作交付的工作團隊。

## 技術棧

| 層 | 技術 |
| --- | --- |
| 前端 | React, TypeScript, Vite, Tailwind CSS |
| 後端 | Rust |
| 桌面端 | Tauri |
| 數據庫 | SQLx 管理的關係型 schema |
| 工作流 UI | React Flow |

## 本地開發

### 前置條件

- **Rust** >= 1.75
- **Node.js** >= 18
- **pnpm** >= 8

### Mac/Linux

```bash
# Clone the repository
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
pnpm run dev
# build
pnpm --filter frontend build
pnpm desktop:build
```

### Windows (PowerShell)：分別啓動後端和前端

`pnpm run dev` 無法在 Windows PowerShell 中運行。請使用以下命令分別啓動後端和前端。

```powershell
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
pnpm run generate-types
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
$env:FRONTEND_PORT = <terminal A generated frontend port>
$env:BACKEND_PORT = <terminal A generated backend port>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

在 `http://localhost:<FRONTEND_PORT>` 打開前端頁面（例如：`http://localhost:3001`）。

### 本地構建 `openteams-cli`

如果你需要編譯本地 `openteams-cli` 二進制文件，而不是使用內置或已發佈的構建，請使用以下命令。
構建產物會放在 binaries 目錄中。

```bash
# From the repository root
bun run ./scripts/build-openteams-cli.ts
```

## 貢獻

歡迎貢獻。你可以這樣開始：

1. **尋找 issue** — 查看 [Good First Issues](https://github.com/openteams-lab/openteams/labels/good%20first%20issue) 尋找適合新手的任務，或瀏覽開放 issue。
2. **開發前先討論** — 在提交大型 PR 前，請先開啓 issue 或 discussion，以便對齊方向。
3. **遵循代碼風格** — 提交前請運行：

```bash
pnpm run format
pnpm run check
pnpm run lint
```

4. **提交 PR** — 說明你改了什麼以及爲什麼改。如有相關 issue，請一併鏈接。

完整指南請見 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 許可證

本專案使用 Apache License 2.0。完整條款請見 [LICENSE](../LICENSE)，其中包含版權與再散布要求。

你可以拿來用、改、發布、商用，也可以放進閉源產品裡。需要保留版權聲明和授權條款，改過的地方要說明。不能刪掉必要聲明，不能拿專案所有者的名字或商標當背書；如果你因為這個專案發起專利訴訟，Apache-2.0 給你的專利授權可能會終止。軟體按原樣提供，不承諾擔保。
