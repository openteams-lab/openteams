<div align="center">
  <img src="images/openteams-logo.png" alt="openteams" width="100">
</div>

<div align="center">
  <img src="images/characters_black.png" alt="openteams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>規劃、建置、交付——不再只靠一個 AI，而是與你的 AI 團隊並肩完成</h5>

  <p>
    openteams 是一款開源、以本機為優先的 AI 桌面應用程式，協助獨立開發者透過一支可控的 AI 團隊，更快地規劃、建置和交付軟體。
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
    <a href="https://doc.openteams-lab.com">文件</a>
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
  <video src="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590" controls autoplay muted playsinline width="100%">
    <a href="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590">觀看產品影片</a>
  </video>
</div>

## openteams 到底是什麼？

你已經在使用 Claude Code、Codex、Gemini CLI 或其他程式設計 Agent。單獨使用時都沒問題。接著你開啟第二個終端機、第三個終端機：同一份背景要反覆說明，結果要從一個視窗搬到另一個視窗，誰在修改什麼全靠自己記。很快，你管理的就不再是工作，而是這些 Agent：變更散落在不同會話中，專案優先順序記錄在別處，Token 用量與實際交付的內容彼此脫節。

openteams 補上的是這些 Agent 周邊缺少的能力：**一個讓它們對話和交接工作的共享空間、一份你能查看並控制的執行計畫，以及一套將專案事項與 Agent 產出連結起來、但不把專案路線圖交給 Agent 的輕量本機記錄。**

| openteams **是** | openteams **不是** |
| --- | --- |
| 一個連接你現有程式設計 Agent 的本機優先工作區 | 一個新模型，或 Claude Code、Codex、Gemini CLI 的替代品 |
| 一個讓 Agent 對話、交接任務並共享上下文的會話 | 一堆仍然需要你手動協調的獨立聊天視窗 |
| 一份由開發者維護、與 Agent 會話關聯的事項清單 | 一套完整的專案管理系統，或由 Agent 自行修改的路線圖 |
| 一套可以逐步查看、審查、中斷和重試的工作流程 | 一個提交後只能等待結果的黑盒大型提示詞 |
| 可以分別審查、合併或捨棄的隔離 worktree | 多個 Agent 同時修改同一工作區，彼此干擾 |
| 能看清 Agent 交付、用量和成本的建置統計 | 只顯示消耗、不記錄產出的 Token 計數器 |

**具體來說，安裝後你會得到：** 用於輕量協作和計畫執行的聊天會話、開箱即用的團隊工作流程範本、把工作內容連結到會話且由開發者掌控的事項、用於隔離並行任務的獨立工作區，以及詳細的建置統計。

```text
沒有 openteams                    使用 openteams

Claude ─ 終端 A ─┐                Claude ─┐
Codex ── 終端 B ─┼─ 由你傳話      Codex ──┼─ 共享會話
Gemini ─ 終端 C ─┘                Gemini ─┘

計畫：放在別處                   事項 ── 會話 ── 建置產出
```

## 為什麼選擇 openteams

現在讓 Agent 寫出程式碼並不難，難的是把這些工作管好：上下文能不能接上、執行到哪一步、並行任務會不會互相覆蓋、接下來該做什麼，以及這次開發到底花了多少。

openteams 把 Agent 和相關對話放在同一個會話裡。任務複雜時，工作流程模式會顯示步驟和相依關係，你可以單獨審查或重試其中一步，不必全部重來。如果多個會話同時工作，還可以為每個會話使用獨立的 Git worktree，讓未完成的變更彼此隔離，最後再決定合併還是捨棄。

專案方向始終由開發者決定。事項記錄你選定的工作，並連結 Agent 實際執行這些工作的會話；Agent 負責執行，但不會替你修改計畫。工作完成後，建置統計會把交付結果和本次使用的 Token、成本放在一起顯示。

openteams 想做的不是再多接幾個 Agent，而是讓你隨時知道：現在在做什麼，變更在哪裡，下一步是什麼，以及這些結果花了多少。

## 快速開始
### 安裝
#### 桌面應用（推薦）

請從 GitHub Releases 下載適合你平臺的最新版本。

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-windows-x64.msi)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-macos.dmg)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-linux-amd64.deb)

**macOS：** 目前的 macOS 版本尚未使用 Apple Developer ID 簽署及公證。瀏覽器會為從網際網路下載的 App 加上隔離屬性，因此即使下載檔案完好，Gatekeeper 仍可能提示 openteams「已損壞」。將 `openteams.app` 拖入 `/Applications` 後，請僅在確認它來自 openteams 官方 GitHub Release 時執行：

```bash
xattr -dr com.apple.quarantine /Applications/openteams.app
```

這個命令只會移除 openteams 的隔離屬性，不會在系統範圍停用 Gatekeeper。

#### npx

```bash
npx openteams-web
```

### 設定供應商

**openteams** 內建 openteams CLI Agent。你可以在應用程式中透過 `Settings → Provider Config → Add Provider` 設定模型供應商。參考文件：

⚙️ [供應商設定](https://doc.openteams-lab.com/advanced-usage/custom-provider)

你也可以連接以下 openteams 支援的程式設計 Agent：

| Agent | 安裝範例 |
| --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Gemini CLI | `npm i -g @google/gemini-cli` |
| Codex | `npm i -g @openai/codex` |
| Qwen Code | `npm i -g @qwen-code/qwen-code` |
| OpenCode | `npm i -g opencode-ai` |

📚 [更多 Agent 安裝指南](https://doc.openteams-lab.com/getting-started)

## 重要更新
- **2026.05.20 (v0.4.4)**
  - 工作流程模式 beta 版
- **2026.05.07 (v0.3.22)**
  - 支援一鍵將群組聊天會話中的成員儲存為預設團隊
- **2026.04.14 (v0.3.15)**
  - 工作區文件變更查看器
- **2026.04.06 (v0.3.12)**
  - 啟用深色 UI 模式
  - 修復 openteams-cli 並行處理問題
- **2026.04.02 (v0.3.10)**
  - 實作應用程式內版本更新
  - 文件網站已上線

## 路線圖

openteams 正在積極開發中。接下來我們會朝這些方向推進：

- [ ] **領域專家型 AI 員工** — 推出更多具備專業領域知識、能夠解決專業問題的 AI 員工。
- [ ] **高產出的 AI 團隊** — 由高效的專家型 AI 員工組成，可針對特定業務自訂生產工作流程，將需求端到端轉換為可交付成果。
- [ ] **整合更多 Agent** — 整合更多常用 Agent，例如 Kilo Code、hermes-agent 和 openclaw。

***願景：把 Token 消耗轉化為真正的生產力。***

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
| AI 員工與 AI 團隊 | 把 Token 直接轉化為生產力。每個 AI 員工或團隊都擁有特定領域的專業知識，能將通用模型提升為領域專家——不只是生成文字，而是真正產出可交付的工作成果。 |
| 多 Agent 工作區 | 把多個 AI Agent 帶入同一個共享會話，不再在多個視窗之間來回切換。 |
| 共享上下文 | Agent 基於同一份對話和專案上下文工作。 |
| 自由聊天模式 | 使用 `@` 進行直接、輕量的 Agent 協作。 |
| 工作流程模式 | 將複雜任務轉換為結構化步驟、相依關係、審查、重試和驗收。 |
| 可見執行 | 查看每個 Agent 正在做什麼，以及工作卡在哪裡。 |
| 審查與重試 | 審查某一步的結果，精確重試失敗的任務，無需重新啟動整個專案。 |
| 事項管理 | 記錄並排序由開發者掌控的工作項目，從 GitHub 同步事項，並建立或連結執行會話。 |
| 隔離工作區 | 在獨立的 Git worktree 中執行不同會話的任務，再分別審查、合併或捨棄結果，避免互相干擾。 |
| 建置統計 | 對照 Bug 修復和功能交付情況，查看不同會話與模型的 Token 用量和成本明細。 |
| 產物與軌跡 | 將日誌、diff、對話記錄和生成的產物附加到工作上。 |
| 本機工作區執行 | Agent 在你設定的工作區中工作，執行記錄儲存在 `.openteams/` 下。 |

## 適合誰

openteams 適合：

- 正在使用多個程式設計 Agent、但已經厭倦來回切換和協調的開發者
- 需要讓 Agent 執行過程可審查、可重現的技術負責人

它不只是一個收納更多 Agent 的容器，而是把 Agent 變成真正能協作交付的工作團隊。

## 技術堆疊

| 層 | 技術 |
| --- | --- |
| 前端 | React, TypeScript, Vite, Tailwind CSS |
| 後端 | Rust |
| 桌面端 | Tauri |
| 資料庫 | SQLx 管理的關聯式 schema |
| 工作流程 UI | React Flow |

## 本機開發

### 前置條件

- **Rust** >= 1.75
- **Node.js** >= 18
- **pnpm** >= 8

### macOS、Linux 和 Windows

```bash
# Clone the repository
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
npm run dev
# build
pnpm --filter frontend build
pnpm desktop:build
```

### 在本機建置 `openteams-cli`

如果你需要編譯本機 `openteams-cli` 二進位檔，而不是使用內建或已發布的版本，請使用以下命令。
建置產物會放在 binaries 目錄中。

```bash
# From the repository root
bun run ./scripts/build-openteams-cli.ts
```

## 貢獻

歡迎貢獻，也歡迎分享可供其他開發者學習和重複使用的 AI 團隊工作流程。你可以這樣開始：

1. **尋找 Issue** — 查看 [Good First Issues](https://github.com/openteams-lab/openteams/labels/good%20first%20issue) 尋找適合新手的任務，或瀏覽開放中的 Issue。
2. **開發前先討論** — 在提交大型 PR 前，請先開啟 Issue 或 Discussion，以便確認方向。
3. **遵循程式碼風格** — 提交前請執行：

```bash
pnpm run format
pnpm run check
pnpm run lint
```

4. **提交 PR** — 說明你修改了什麼以及為什麼修改。如有相關 Issue，請一併連結。

完整指南請見 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 授權條款

openteams 基於 Apache License 2.0 發布。簡單來說，你可以：

- 免費用於個人、教育、內部或商業專案；
- 複製、修改原始碼，並在此基礎上繼續開發；
- 以原始碼或編譯後軟體的形式分發原版或修改版；
- 整合到閉源產品中並收費，無需因此公開產品的其餘程式碼。

如果你再散布 openteams 或其修改版，需要附上授權條款副本，保留相關著作權和署名聲明，並清楚標明修改過的檔案。

另外還有三點：

- **品牌：** 你可以使用程式碼，但不能冒充 openteams 官方，也不能把 openteams 的名稱或商標當成自己的品牌。
- **專利：** 程式碼貢獻者授權你使用其貢獻內容必然涵蓋的專利，因此不能利用這些專利阻止你使用 openteams。作為交換，如果你以「openteams 侵犯我的專利」為由提起訴訟，你將失去這項專利保護。失效的只是專利授權，不是一般的程式碼使用權；未涉及專利訴訟的使用者通常不受影響。
- **風險：** 軟體免費按現狀提供。是否符合你的需求、使用中會不會出現問題，都需要你自行判斷並承擔風險；專案方不提供保固或賠償。

本節僅為易於理解的摘要，具有法律效力的條款以 [LICENSE](../LICENSE) 文件為準。

完整法律條款請見 [LICENSE](../LICENSE)。
