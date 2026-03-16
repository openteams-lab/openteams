<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320">

  <p><strong>チームとしてエージェントを実行し、AI時代に効率を倍増させる。</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams"><img alt="npm" src="https://img.shields.io/npm/v/openteams?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://docs.openteams.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="https://your-demo-link.com">デモを見る</a> |
    <a href="#クイックスタート">クイックスタート</a> |
    <a href="https://docs.openteams.com">ドキュメント</a>
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

![OpenTeams Demo](../images/demo.gif)

**1分間クイックスタートガイド**

1. プリセットチームをインポートし、各メンバーのベースエージェントを選択。
2. チームの各メンバーのワークスペースを設定。
3. `@mentions`で特定のメンバーにメッセージを送信。

---

## クイックスタート

### オプション A: npxで実行

```bash
# web
npx openteams-web
```

### オプション B: デスクトップアプリをダウンロード

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### 要件

**少なくとも1つのAIエージェントをインストールする必要があります：**

| Agent | インストール |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [その他のエージェントインストールガイド](https://docs.openteams.com/getting-started)

---

## 機能

| 機能 | 内容 |
|--|--|
| **対応エージェント** | `Claude Code`、`Gemini CLI`、`Codex`、`Qwen Code`、`Amp`、`Cursor Agent`、`Copilot`、`Droid`、`Kimi Code`、`OpenCode`など10種類のコーディングエージェントランタイムに対応。他のエージェントも統合中。|
| **共有グループチャットコンテキスト** | すべての参加者が同じ会話履歴から作業でき、別々のウィンドウ間でプロンプトをコピー＆ペーストする必要がありません。 |
| **並列実行** | 複数のエージェントが同じ共有セッション内で同時に同じタスクに取り組めます。異なるエージェントが最も得意なタスクを処理します。 |
| **自律的コラボレーション** | エージェントは互いに`@mention`し、作業を引き継ぎ、チャット内で直接調整できます。 |
| **内蔵AIメンバー** | エンジニアリング、マーケティング、ライティング、研究、コンテンツ制作など、160以上の内蔵AIメンバーから始められます。 |
| **内蔵AIチームプリセット** | 一般的なワークフローに対応する8つのすぐに使えるチームプリセットが用意されています。 |
| **チームガイドライン** | 誰がリードするか、誰が誰と話せるか、コラボレーションをどう進めるかを定義できます。AIチームとチームガイドラインをカスタマイズ。 |
| **スキルライブラリ** | 1000以上の内蔵スキルをエージェントに装備でき、必要に応じて独自のスキルをインポート可能。 |
| **完全ローカル実行** | エージェントはローカルワークスペースに対して実行され、ランタイム成果物はそのワークスペースの`.openteams/`内に保存されます。データプライバシーの心配はありません。 |

### 並列エージェント実行

*同じ共有コンテキストで複数のエージェントを実行し、並列実行でデリバリーを加速。*

![OpenTeams parallel](../images/parallel.gif)

### 自律的エージェントコラボレーション

*OpenTeamsはエージェントが固定されたワークフローを強制せずに直接メッセージを送り合うことを可能にします。より構造が必要な場合は、チームガイドラインを追加してコミュニケーションを制御し、リードエージェントを任命するか、全員が自由にコラボレーションできるようにします。コミュニケーションパターンは完全にユースケース次第です。*

![OpenTeams collaborate](../images/collaborate.gif)

### AIメンバー

*OpenTeamsには、エンジニアリング、マーケティング、ライティング、コンテンツ制作など、160以上の内蔵AIメンバーが含まれています。異なるチームに組み合わせ、カスタマイズし、あなたの働き方に合った役割の組み合わせを構築できます。ロスターを継続的に拡張・改善していきます。*

![OpenTeams members](../images/members.gif)

### AIチーム

*OpenTeamsには一般的なワークフロー用の8つの内蔵チームプリセットが付属しており、すぐに始められます。チームを作成する際にチームガイドラインを定義することをお勧めします。これにより、グループの運営方法とコラボレーションが一致します。*

![OpenTeams team](../images/team.gif)

### スキルライブラリ

*OpenTeamsには1000以上の内蔵スキルが含まれており、異なるAIメンバーに組み合わせて割り当てることができます。自分で作成したスキルをインポートしてエージェントに直接適用することもできます。実際の本番環境で機能する能力に焦点を当ててスキルライブラリを拡張し続けます。*

![OpenTeams skills](../images/skills.gif)

---

## なぜ私たちが優れているか

凡例：✅ 完全サポート | 🟡 部分サポート | ❌ サポートなし

| **機能** | 従来の単一エージェント | マルチウィンドウワークフロー | Claude Code Agent Team | OpenTeams |
|--|--|--|--|--|
| **並列性**| ❌ なし、順次 | 🟡 部分、手動 | ✅ あり、Claudeサブエージェント | ✅ あり、自動 |
| **共有コンテキスト** | ❌ なし | ❌ なし、コピー＆ペースト | 🟡 部分、サブエージェントコンテキスト分割 | ✅ あり、常に同期 |
| **マルチモデルコラボレーション** | ❌ なし | 🟡 部分、手動切り替え | ❌ なし、Claudeのみ | ✅ あり、Claude + Gemini + Codex + その他 |
| **エージェント引き継ぎ** | ❌ なし | ❌ なし、手動調整 | 🟡 部分、Claude内での委譲 | ✅ あり、直接`@mentions` |
| **定義済みAIメンバー** | ❌ なし | ❌ なし | ❌ なし | ✅ あり、160以上のメンバー |
| **チームマネージャー** | ❌ なし | ❌ なし | ❌ なし | ✅ あり、チームガイドラインをカスタマイズ |
| **あなたの労力** | 🔴 高 | 🔴 非常に高い | 🟠 中程度 | 🟢 低 |

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

# 3. 開発サーバーを起動（Rustバックエンド + Reactフロントエンド）
pnpm run dev

# 4. フロントエンドをビルド
pnpm --filter frontend build

# 5. デスクトップアプリをビルド
pnpm desktop:build
```

#### Windows (PowerShell): バックエンドとフロントエンドを別々に起動

`pnpm run dev`はWindows PowerShellでは実行できません。以下のコマンドを使用してバックエンドとフロントエンドを別々に起動してください。

```bash
# 1. リポジトリをクローン
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 依存関係をインストール
pnpm i

# 3. TypeScript型を生成
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
$env:FRONTEND_PORT = <ターミナルAで生成されたフロントエンドポート>
$env:BACKEND_PORT = <ターミナルAで生成されたバックエンドポート>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

フロントエンドページを開く：`http://localhost:<FRONTEND_PORT>`（例：`http://localhost:3001`）。

## リリースノートとロードマップ

### V0.2

- ~~[x] マルチエージェントグループチャットと共有コンテキスト~~
- ~~[x] 並列エージェント実行~~
- ~~[x] エージェント@mentionと自律的コラボレーション~~
- ~~[x] 10種類のコーディングエージェントランタイム対応（Claude Code、Gemini CLI、Codex、Qwen Code、Amp、Cursor Agent、Copilot、Droid、Kimi Code、OpenCode）~~
- ~~[x] デスクトップアプリ（Windows、macOS、Linux）~~
- ~~[x] npx経由のWebアプリ~~
- ~~[x] 多言語対応（EN、ZH、JA、KO、FR、ES）~~

### V0.3

- ~~[x] フロントエンドインターフェースの全面改訂~~
- ~~[x] 160以上の内蔵AIメンバー~~
- ~~[x] 8つの内蔵AIチームプリセット~~
- ~~[x] チームルール設定~~
- ~~[x] 1000以上の内蔵スキル~~
- ~~[x] 完全ローカル実行とワークスペース分離~~
- ~~[x] 入力プロトコルの再定義~~

### ロードマップ

- [ ] OpenTeamsユースケースに最適化されたCode Agentバックエンド
- [ ] 高効率チームコラボレーションフレームワークの構築
- [ ] より多くのエージェント統合（Cursor、Windsurfなど）
- [ ] より強力なすぐに使えるAIチームを追加
- [ ] より強力なスキルを追加
- [ ] 高度に最適化されたカスタマイズ版を提供


## 貢献

貢献を歓迎します！[Issues](https://github.com/openteams-lab/openteams/issues)で必要なものを確認するか、[Discussion](https://github.com/openteams-lab/openteams/discussions)でディスカッションを開始してください。

1. Fork -> featureブランチ -> PR
2. 大きな変更の前にissueを開いてください
3. [Code of Conduct](../CODE_OF_CONDUCT.md)に従ってください

## コミュニティ

| | |
|--|--|
| **バグ報告** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **ディスカッション** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **コミュニティチャット** | [Discord](https://discord.gg/MbgNFJeWDc) |

## 謝辞

[Vibe Kanban](https://www.vibekanban.com/)を基盤として構築しました。優れたオープンソース基盤を提供してくれたチームに感謝します。

また、内蔵スキルエコシステムの形成に貢献してくれた[ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)、エージェントの役割設計とチーム構成のインスピレーションを与えてくれた[msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)にも感謝します。