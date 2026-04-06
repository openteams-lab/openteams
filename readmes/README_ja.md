<div align="center">
  <img src="../frontend/public/Logo/logo_blue.svg" alt="OpenTeams" width="200">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320" style="margin-top: 10px; margin-bottom: 10px;">
  
  <p><strong>エージェントを1つのチームとして動かし、AI時代の効率を何倍にも高めましょう。</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://doc.openteams-lab.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="#クイックスタート">クイックスタート</a> |
    <a href="https://doc.openteams-lab.com">ドキュメント</a> 
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

**1分でわかるクイックスタートガイド**

1. プリセットチームをインポートし、各メンバーのベース Agent を選びます。
2. チーム内の各メンバーにワークスペースを設定します。
3. `@member` を使って特定のメンバーにメッセージを送ります。

---
## 🔥 *最新情報：*
### *重要アップデート*
- **2026.04.02 (v0.3.11)**
  - ダーク UI モードを有効化
  - openteams-cli の並行実行に関する問題を修正
- **2026.04.02 (v0.3.10)**
  - アプリ内アップデートを実装
  - ドキュメントサイトを公開
- **2026.03.24 (v0.3.7)**: 
  - 内蔵の openteams-CLI Agent を追加し、ローカルに Agent をインストールする必要をなくしました。
  - エグゼキューターのメモリリーク問題を修正しました。
---

## クイックスタート

### オプション A: npx で実行
**このインストール方法は Mac と Linux におすすめです。**

```bash
# web
npx openteams-web
```

### オプション B: デスクトップアプリをダウンロード

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### 動作要件

**v0.3.7 以降は openteams-cli が内蔵されているため、AI Agent を別途インストールする必要はありません。「Settings -> Service Providers」ページで API を設定できます。**

⚙️ [プロバイダー設定のドキュメントを参照してください。](https://doc.openteams-lab.com/ja/advanced-usage/custom-provider)

また、対応 Agent の一覧から好きなものを選んで使うこともできます。

| Agent | インストール方法 |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [その他の Agent インストールガイド](https://doc.openteams-lab.com/getting-started)

---

## 機能

| 機能 | 得られるもの |
|--|--|
| **対応 Agent** | `Claude Code`、`Gemini CLI`、`Codex`、`Qwen Code`、`Amp`、`Cursor Agent`、`Copilot`、`Droid`、`Kimi Code`、`OpenCode` を含む 10 種類のコーディング Agent ランタイムに対応しています。さらに多くの Agent も統合中です。|
| **共有グループチャットコンテキスト** | すべての参加者が同じ会話履歴をもとに作業できるため、別ウィンドウ間でプロンプトをコピーして回す必要がありません。 |
| **並列実行** | 複数の Agent が同じ共有セッションの中で同時に同じタスクへ取り組めます。各 Agent が得意な部分を担当します。 |
| **自律的な協調** | Agent 同士が `@mention` し、作業を引き継ぎ、チャットの中で直接連携できます。 |
| **内蔵 AI メンバー** | エンジニアリング、マーケティング、ライティング、リサーチ、コンテンツ制作を含む 160+ の内蔵 AI メンバーをすぐに利用できます。 |
| **内蔵 AI チームプリセット** | 一般的なワークフロー向けに、すぐ使える 8 つのチームプリセットを用意しています。 |
| **チーム運用ガイドライン** | 誰が主導するか、誰と誰が会話できるか、どのように協力を進めるかを定義できます。自分のやり方に合わせて AI チームとガイドラインを調整できます。 |
| **スキルライブラリ** | 1000+ の内蔵スキルを Agent に割り当てられ、必要に応じて自作スキルも取り込めます。 |
| **完全ローカル実行** | Agent はあなたのローカルワークスペース上で動作し、実行成果物はそのワークスペース内の `.openteams/` に保存されます。データプライバシーを心配する必要はありません。 |

### 並列 Agent 実行

*複数の Agent を同じ共有コンテキストで並列に動かし、作業の完了をより速くします。*

![OpenTeams parallel](images/parallel.gif)

### 自律的な Agent 協調

*OpenTeams では、固定ワークフローを強制することなく、Agent 同士が直接メッセージを送り合えます。より構造化したい場合は、チームガイドラインを追加してコミュニケーションを制御したり、リード Agent を指定したり、全員を自由に協調させたりできます。コミュニケーションの形は、あなたのユースケース次第です。*

![OpenTeams collaborate](images/collaborate.gif)

### AI メンバー

*OpenTeams には、エンジニアリング、マーケティング、ライティング、コンテンツ制作など、160+ の内蔵 AI メンバーが用意されています。自由に組み合わせてチームを作り、必要に応じて調整し、自分の働き方に合った役割構成を組み立てられます。今後もこのラインナップを継続的に拡充・改善していきます。*

![OpenTeams members](images/members.gif)

### AI チーム

*OpenTeams には、一般的なワークフロー向けの 8 つのチームプリセットが最初から含まれており、すぐに使い始められます。チームを作成する際には、協力の進め方があなたの目的に沿うよう、チームガイドラインを定義することをおすすめします。*

![OpenTeams team](images/team.gif)

### スキルライブラリ

*OpenTeams には 1000+ のスキルが内蔵されており、さまざまな AI メンバーに組み合わせて割り当てられます。自分で作成したスキルをインポートして Agent に直接適用することもできます。スキルライブラリは、実運用でしっかり機能する能力を重視して今後も拡張していきます。*

![OpenTeams skills](images/skills.gif)

---

## なぜ OpenTeams が優れているのか

凡例：✅ フルサポート | 🟡 一部サポート | ❌ 非対応

| **能力** | 従来の単一 Agent | マルチウィンドウ運用 | Claude Code Agent Team | openteams |
|--|--|--|--|--|
| **並列性**| ❌ 非対応、逐次実行のみ | 🟡 一部対応、手動 | ✅ 対応、Claude サブエージェント | ✅ 対応、自動 |
| **共有コンテキスト** | ❌ 非対応 | ❌ 非対応、コピー＆ペーストが必要 | 🟡 一部対応、サブエージェントごとに分断 | ✅ 対応、常に同期 |
| **マルチモデル協調** | ❌ 非対応 | 🟡 一部対応、手動切り替え | ❌ 非対応、Claude のみ | ✅ 対応、Claude + Gemini + Codex + その他 |
| **Agent の引き継ぎ** | ❌ 非対応 | ❌ 非対応、自分でオーケストレーション | 🟡 一部対応、Claude 内で委譲 | ✅ 対応、直接 `@mentions` |
| **定義済み AI メンバー** | ❌ 非対応 | ❌ 非対応 | ❌ 非対応 | ✅ 対応、160+ メンバー |
| **チーム運用管理** | ❌ 非対応 | ❌ 非対応 | ❌ 非対応 | ✅ 対応、チームガイドラインをカスタマイズ |
| **必要な手間** | 🔴 高い | 🔴 非常に高い | 🟠 中程度 | 🟢 低い |

---

## 技術スタック

| レイヤー | 技術 |
|-------|-----------|
| フロントエンド | React + TypeScript + Vite + Tailwind CSS |
| バックエンド | Rust |
| デスクトップ | Tauri |

## ローカル開発

#### Mac/Linux

```bash
# 1. リポジトリをクローン
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 依存関係をインストール
pnpm i

# 3. 開発サーバーを起動（Rust バックエンド + React フロントエンド）
pnpm run dev

# 4. フロントエンドをビルド
pnpm --filter frontend build

# 5. デスクトップアプリをビルド
pnpm desktop:build
```

#### Windows（PowerShell）：バックエンドとフロントエンドを別々に起動

`pnpm run dev` は Windows PowerShell では実行できません。以下のコマンドを使ってバックエンドとフロントエンドを別々に起動してください。

```bash
# 1. リポジトリをクローン
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 依存関係をインストール
pnpm i

# 3. TypeScript 型を生成
pnpm run generate-types

# 4. データベースマイグレーションを実行
pnpm run prepare-db
```

**ターミナル A（バックエンド）**

```powershell
$env:FRONTEND_PORT = node scripts/setup-dev-environment.js frontend
$env:BACKEND_PORT = node scripts/setup-dev-environment.js backend
$env:RUST_LOG = "debug"
cargo run --bin server
```

**ターミナル B（フロントエンド）**

```powershell
$env:FRONTEND_PORT = <ターミナル A で生成された frontend ポート>
$env:BACKEND_PORT = <ターミナル A で生成された backend ポート>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

`http://localhost:<FRONTEND_PORT>` でフロントエンドを開きます（例：`http://localhost:3001`）。

#### `openteams-cli` をローカルでビルド

内蔵版や公開済みビルドではなく、ローカルの `openteams-cli` バイナリをビルドしたい場合は、以下のコマンドを使ってください。
ビルド成果物は binaries ディレクトリに配置されます。

```bash
# リポジトリのルートで実行
bun run ./scripts/build-openteams-cli.ts
```

## リリースノートとロードマップ

### V0.2

- [x] 共有コンテキスト付きマルチ Agent グループチャット
- [x] 並列 Agent 実行
- [x] Agent `@mention` と自律的な協調
- [x] 10 種類のコーディング Agent ランタイム対応（Claude Code、Gemini CLI、Codex、Qwen Code、Amp、Cursor Agent、Copilot、Droid、Kimi Code、OpenCode）
- [x] デスクトップアプリ（Windows、macOS、Linux）
- [x] npx で使える Web アプリ
- [x] 多言語対応（EN、ZH、JA、KO、FR、ES）

### V0.3
- [x] フロントエンド UI の全面刷新
- [x] 160+ の内蔵 AI メンバー
- [x] 8 つの内蔵 AI チームプリセット
- [x] チームルール設定
- [x] 1000+ の内蔵スキル
- [x] 完全ローカル実行とワークスペース分離
- [x] 入力プロトコルの再定義

### ロードマップ
- [x] OpenTeams 向けに最適化した Code Agent バックエンド —— v0.3.7
- [x] 複数のフロントエンド配色を開発 —— v0.3.11
- [ ] 高効率なチーム協調フレームワークの構築
- [ ] より多くの Agent 統合（Kilo Code、OpenClaw など）
- [ ] より強力ですぐ使える AI チームの追加
- [ ] より強力なスキルの追加
- [ ] 高度に最適化されたカスタム版の提供


## コントリビュート

コントリビューションを歓迎します。必要な内容は [Issues](https://github.com/StarterraAI/OpenTeams/issues) を確認するか、[Discussion](https://github.com/StarterraAI/OpenTeams/discussions) を始めてください。

1. Fork -> feature ブランチを作成 -> PR を送る
2. 大きな変更の前には issue を立ててください
3. [Code of Conduct](../CODE_OF_CONDUCT.md) を守ってください

### コード整形

PR を送る前に、コードが正しく整形されていることを確認してください。

```bash
# フロントエンドとバックエンドを両方整形
pnpm run format

# ファイルを変更せずに整形状態を確認
pnpm run format:check

# フロントエンドのみ整形
pnpm run frontend:format

# バックエンドのみ整形（Rust）
pnpm run backend:format
```

**注意：** コード整形が正しくないと CI は失敗します。push 前に必ず `pnpm run format:check` を実行してください。

## コミュニティ

| | |
|--|--|
| **バグ報告** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **ディスカッション** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **コミュニティチャット** | [Discord](https://discord.gg/MbgNFJeWDc) |

## 謝辞

本プロジェクトは [Vibe Kanban](https://www.vibekanban.com/) をベースに構築されています。優れたオープンソース基盤を提供してくれたチームに感謝します。

また、内蔵スキルエコシステムの形成を後押ししてくれた [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) と、Agent の役割設計やチーム構成に関する着想を与えてくれた [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) にも感謝します。
