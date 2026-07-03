<div align="center">
  <img src="../frontend/public/logos/logo_blue.svg" alt="OpenTeams" width="100">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>計画し、構築し、届ける——ひとつの AI ではなく、AI チームとともに</h5>

  <p>
    複数の AI エージェントが同じコンテキストを共有します——チャットで自由に協働することも、可視化され、レビューでき、再試行できるワークフローで複雑なタスクを編成することもできます。
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
<div align="center">
  <video src="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d" controls width="100%">
    <a href="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d">製品動画を見る</a>
  </video>
</div>

## openteams とは

**openteams** は、オープンソースのマルチエージェント協業ワークスペースです。Claude Code、Codex、Gemini CLI など複数の AI コーディングエージェントを一つの共有セッションに集め、会話し、コンテキストを共有し、チームとして一緒に作業できるようにします。軽量な Free Chat でエージェントと協業することも、見える計画、ステップ単位の制御、組み込みレビューを備えた構造化 Workflows で複雑なタスクを編成することもできます。すべてはあなた自身のローカルワークスペースで実行されます。

## openteams が必要な理由

AI エージェントは、計画、コーディング、レビュー、テストにおいてますます強力になっています。しかし、エージェントの出力が増えたからといって、それが自動的に出荷できる成果になるわけではありません。

**複数のエージェントを管理するのは大変です。** ターミナルを行き来し、新しいエージェントごとにコンテキストを説明し直し、あるプロンプトの出力を次のプロンプトへコピーし、衝突する diff を調整する必要があります。複数エージェントをさばく混乱に、あなたの集中力が削られていきます。

**エージェントの実行は見えにくく、制御しにくいものです。** Claude Code に「この機能を作って」と指示すると、15 分走り続けます。その間、どのサブタスクを試したのか、どれが通ったのか、どれを黙って諦めたのかは分かりません。現在の多くのコーディングエージェントは、複雑なタスクを一つの巨大な実行として扱います。実行前に見える計画はなく、途中で個別ステップを承認または却下する方法もなく、失敗したステップだけを再試行する方法もありません。何かが壊れたら、最初からやり直すことになります。

**openteams** は、この二つの問題を解決します。エージェントは**同じコンテキストを共有**するため、引き継ぎで作業が失われません。複雑なタスクは**見える、制御できるワークフロー**になります。実行前に計画を調整し、各ステップの実行を見守り、任意のノードで承認、却下、再試行、リダイレクトできます。

> 本当のレバレッジは、エージェントの数を増やすことではありません。見える複雑な計画と、制御できるステップによって、それらをオーケストレーションすることです。

## よくあるユースケース

あなたが「ワークスペースに GitHub issue 同期を追加して」と入力します。


1. **Lead agent が要件を明確にします:** 同期方向（一方向か双方向か）、競合処理（スキップ、上書き、ログ記録）、マッピングする issue フィールドを質問します。あなたは、一方向 pull、競合はログ記録、title/body/labels/status をマッピング、と確認します。
2. **Lead agent がアプローチを設計し、実行計画を作ります:** 計画には 5 つのステップが表示されます。`Backend: OAuth + GitHub API` → `Backend: Sync Engine` → `Frontend: Sync Status UI` → `Integration Tests` → `Final Review`。各ステップには明確な範囲、担当エージェント、受け入れ基準があります。
3. **あなたが計画をレビューして承認します:** コードが実行される前に、ステップを調整し、依存関係を並べ替え、担当エージェントを変更できます。
4. **エージェントが実行し、あなたは進捗をリアルタイムで確認します:** `Backend: OAuth` が最初に実行されます。完了すると、`Sync Engine` と `Frontend: Sync Status UI` が並列で開始されます。各ステップはワークフローグラフ上で状態、diff、ログを表示します。
5. **完了した各ステップをレビューして承認します:** `Backend: OAuth` が完了します。diff を確認し、token refresh ロジックを見て承認します。次のステップが進みます。
6. **ステップが失敗したら、そのステップだけを再試行します:** `Integration Tests` は、同期エンジンが ISO 形式ではなく生の timestamp を返したため失敗します。エラーログを確認し、`Integration Tests` ステップだけを再試行します。他のワークフローはそのままです。
7. **最終レビューと受け入れ:** すべてのステップが通ります。全体の diff、成果物、テスト結果を確認して受け入れます。
8. **Free Chat でフォローアップ:** 2 日後、ユーザーが同期ステータスバッジの点滅を報告します。Free Chat を開き、`@Frontend Agent the sync status badge flickers when polling — debounce the state update` と送ります。ワークフローなしで 1 ターンで修正されます。

## クイックスタート
### インストール
#### npx

```bash
npx openteams-web
```

#### デスクトップアプリ

GitHub Releases から、お使いのプラットフォーム向けの最新リリースをダウンロードしてください。

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### プロバイダー設定

**openteams** には、組み込みの openteams CLI エージェントが含まれています。アプリ内の `menu->setting->provider config->add provider` からモデルプロバイダーを設定できます。

⚙️ [プロバイダー設定](https://doc.openteams-lab.com/advanced-usage/custom-provider)

次のような対応コーディングエージェントも接続できます。

| Agent | インストール例 |
| --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Gemini CLI | `npm i -g @google/gemini-cli` |
| Codex | `npm i -g @openai/codex` |
| Qwen Code | `npm i -g @qwen-code/qwen-code` |
| OpenCode | `npm i -g opencode-ai` |

📚 [その他のエージェントインストールガイド](https://doc.openteams-lab.com/getting-started)

### 30 秒で始める
**前提条件: API サービスプロバイダーを設定するか、対応している Code Agent をインストールしてください。**

*step 1.* グループチャットセッションを作成します。1 人以上のメンバーを追加し、それぞれにモデルと役割を割り当てます。

*step 2.* Free Chat モードで、`@` を使って任意のメンバーにメッセージまたはタスクを送ります。

*step 3.* Workflow モードに切り替えます。lead agent と要件を話し合い、解決策を調整し、実行計画を生成します。

*step 4.* 実行を開始し、各タスクノードが完了するたびに結果をレビューします。

## 作業モード

**openteams** は二つの協業モードをサポートします。すべてのタスクが同じレベルの構造を必要とするわけではないからです。これは **Claude Code の Plan モードと Build モード**をマルチエージェントチーム向けにしたもの、と考えると分かりやすいでしょう。自由に探索や議論をしたいときは自由協業を、信頼できる予測可能な実行が必要なときは構造化ワークフローを選びます。

### Free Chat

自由チャットモードでは、`@` で任意のエージェントにタスクを送り、エージェント同士も自由にメッセージをやり取りできます。協業は、あなたが定義するチームプロトコルによって管理されます。誰が何を担当するか、どのように引き継ぐか、どの基準に従うかを定められます。

**free chat mode** は、小さな修正、簡単なレビュー、完全なワークフローを使うほどではない探索的な議論に向いています。

![](images/free_chat.png)

### Workflow

Workflow モードは、複雑なタスクをサブタスクに分解し、進捗を観察し、各ステップで実行を制御したい場合に向いています。

Lead agent が計画フェーズを進めます。要件を明確にし、アプローチを設計し、実行計画を定義し、適切なエージェントにタスクを割り当てます。その結果、ステップ、依存関係、レビュー、再試行、受け入れポイントを持つ見えるワークフローが得られます。

![](images/openteams-workflow.png)

エージェントを緩いチェーンで実行させるのではなく、**openteams** は作業を状態を持つ実行グラフに変換します。

**注意: Workflow モードはより多くの token を消費します。token 残高が十分であることを確認してください。**

## 主な更新
- **2026.05.20 (v0.4.4)**
  - Workflow モード beta 版
- **2026.05.07 (v0.3.22)**
  - グループチャットセッションのメンバーを、ワンクリックでプリセットチームとして保存できるようにしました
- **2026.04.14 (v0.3.15)**
  - Workspace File Change Viewer
- **2026.04.06 (v0.3.12)**
  - ダーク UI モードを有効化
  - openteams-cli の並行処理の問題を修正
- **2026.04.02 (v0.3.10)**
  - アプリ内バージョン更新を実装
  - ドキュメントサイトを公開

## ロードマップ

openteams は活発に開発されています。今後は次の方向へ進んでいきます。

- [ ] **専門性を持つ AI workers** — 専門領域の知識を持ち、専門的な課題を解決できる AI workers をさらに提供します。
- [ ] **高いアウトプットを出す AI team** — 効率的な専門 AI workers で構成され、特定のビジネス向けに生産ワークフローをカスタマイズし、要件をエンドツーエンドで成果物へ変換します。
- [ ] **より多くのエージェント統合** — Kilo code、hermes-agent、openclaw など、よく使われる Agent をさらに統合します。

***ビジョン: token 消費を本当の生産性へ変える。***

機能リクエストや方向性への提案がある場合は、[ディスカッションを開いてください](https://github.com/openteams-lab/openteams/discussions)。

## コミュニティ

- [GitHub Issues](https://github.com/openteams-lab/openteams/issues): バグ報告と機能リクエスト
- [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions): プロダクトのアイデアと質問
- [Discord](https://discord.gg/openteams): コミュニティチャット
- [Linux.do](https://linux.do): 相互リンク。コミュニティ交流のサポートに感謝します
- コミュニティグループ:

<p>
  <a href="images/openteams-wechat-community.png"><img alt="OpenTeams WeChat コミュニティグループ QR コード" src="images/openteams-wechat-community.png" width="260"></a>
  <a href="images/openteams-feishu-community.png"><img alt="OpenTeams Feishu/Lark コミュニティグループ QR コード" src="images/openteams-feishu-community.png" width="260"></a>
</p>

## コア機能

| 機能 | 意味 |
| --- | --- |
| AI 従業員と AI チーム | token を本当の生産性へ変えます。各 AI 従業員やチームは分野固有の専門性を持ち、汎用モデルを専門家へ高めます。単にテキストを生成するのではなく、成果を出す準備ができています。 |
| マルチエージェントワークスペース | 複数の AI エージェントを一つの共有セッションに集め、別々のウィンドウを行き来する必要をなくします。 |
| 共有コンテキスト | エージェントは同じ会話とプロジェクトコンテキストをもとに作業します。 |
| Free Chat | `@` を使って、直接かつ軽量にエージェントと協業できます。 |
| Workflow モード | 複雑なタスクを、構造化されたステップ、依存関係、レビュー、再試行、受け入れに変換します。 |
| 見える実行 | 各エージェントが何をしているか、どこで作業が止まっているかを確認できます。 |
| レビューと再試行 | ステップをレビューし、必要なタスクだけを再試行し、プロジェクト全体のやり直しを避けます。 |
| 成果物とトレース | ログ、diff、トランスクリプト、生成された成果物を作業に紐づけて保持します。 |
| ローカルワークスペース実行 | エージェントは設定済みのワークスペースに対して作業し、実行記録は `.openteams/` 配下に保存されます。 |

## 対象ユーザー

openteams は次のような人やチームに向いています。

- 複数のコーディングエージェントを使っていて、その切り替えや調整に疲れている開発者
- エージェント実行をレビュー可能かつ再現可能にしたい技術リード

これは単にエージェントを集める場所ではありません。エージェントを機能するチームに変える方法です。

## 技術スタック

| レイヤー | 技術 |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Rust |
| Desktop | Tauri |
| Database | SQLx-managed relational schema |
| Workflow UI | React Flow |

## ローカル開発

### 前提条件

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

### Windows (PowerShell): backend と frontend を別々に起動する

`pnpm run dev` は Windows PowerShell では実行できません。以下のコマンドで backend と frontend を別々に起動してください。

```powershell
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
pnpm run generate-types
pnpm run prepare-db
```

**Terminal A (backend)**

```powershell
$env:FRONTEND_PORT = node scripts/setup-dev-environment.js frontend
$env:BACKEND_PORT = node scripts/setup-dev-environment.js backend
$env:RUST_LOG = "debug"
cargo run --bin server
```

**Terminal B (frontend)**

```powershell
$env:FRONTEND_PORT = <frontend port generated from terminal A>
$env:BACKEND_PORT = <backend port generated from terminal A>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

frontend は `http://localhost:<FRONTEND_PORT>` で開けます（例: `http://localhost:3001`）。

### `openteams-cli` をローカルでビルドする

組み込み版または公開済みビルドではなく、ローカルの `openteams-cli` バイナリをコンパイルしたい場合は、次のコマンドを使ってください。
ビルド成果物は binaries ディレクトリに配置されます。

```bash
# From the repository root
bun run ./scripts/build-openteams-cli.ts
```

## コントリビューション

コントリビューションを歓迎します。始め方は次の通りです。

1. **issue を探す** — 初心者向けのタスクは [Good First Issues](https://github.com/openteams-lab/openteams/labels/good%20first%20issue) を確認するか、open issue を見てください。
2. **実装前に相談する** — 大きな pull request を開く前に、方向性を合わせるため issue または discussion を開いてください。
3. **コードスタイルに従う** — 提出前に次を実行してください。

```bash
pnpm run format
pnpm run check
pnpm run lint
```

4. **PR を送る** — 何を、なぜ変更したのかを書いてください。関連 issue があればリンクしてください。

完全なガイドは [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。

## ライセンス

このプロジェクトは Apache License 2.0 で公開されています。著作権表示や再配布の条件を含む全文は
[LICENSE](../LICENSE) を確認してください。

このプロジェクトは使う、変更する、配布する、販売する、クローズドソース製品に組み込むことができます。著作権表示とライセンス本文は残し、変更した場合は何を変えたか分かるようにしてください。必要な表示を消したり、プロジェクト所有者の名前や商標を推薦のように使ったりしてはいけません。また、このプロジェクトについて特許訴訟を起こすと、Apache-2.0 の特許許諾が続かない可能性があります。ソフトウェアは現状のまま提供され、保証はありません。
