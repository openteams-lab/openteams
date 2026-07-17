<div align="center">
  <img src="../frontend/public/logos/logo_blue.svg" alt="openteams" width="100">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="openteams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>計画し、構築し、届ける——ひとつの AI ではなく、AI チームとともに</h5>

  <p>
    openteams は、個人開発者が自分で制御できる AI チームとともに、ソフトウェアをより速く計画、構築、リリースするための、オープンソースかつローカルファーストの AI デスクトップアプリです。
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

**openteams** は、オープンソースのマルチエージェント協業ワークスペースです。Claude Code、Codex、Gemini CLI など複数の AI コーディングエージェントを一つの共有セッションに集め、会話し、コンテキストを共有し、チームとして作業できるようにします。軽量な Free Chat で協業することも、見える計画、ステップ単位の制御、追跡可能なレビューを備えた構造化ワークフローで複雑なタスクを編成することもできます。オプションの分離ワークスペースでは、セッションごとに専用の Git worktree を作成し、エージェントが互いに干渉せず独立したタスクを実行できます。openteams は実行だけでなく、アイデアからリリースまでの全体も管理します。Issue で進捗と優先順位を把握し、GitHub の作業項目を同期し、各 Issue を実行セッションに紐づけられます。作業完了後は、ビルド統計が成果とセッション、モデル、タスクごとの Token 使用量やコストを結びつけ、出力と効率を明確に示します。すべてはあなた自身のローカルワークスペースで実行されます。

## openteams が必要な理由

AI エージェントは、計画、コーディング、レビュー、テストにおいてますます強力になっています。しかし、エージェントの出力が増えたからといって、それが自動的に出荷できる成果になるわけではありません。

**複数のエージェントを管理するのは大変です。** ターミナルを行き来し、新しいエージェントごとにコンテキストを説明し直し、あるプロンプトの出力を次のプロンプトへコピーし、衝突する diff を調整する必要があります。複数エージェントをさばく混乱に、あなたの集中力が削られていきます。

**エージェントの実行は見えにくく、制御しにくいものです。** Claude Code に「この機能を作って」と指示すると、15 分走り続けます。その間、どのサブタスクを試したのか、どれが通ったのか、どれを黙って諦めたのかは分かりません。現在の多くのコーディングエージェントは、複雑なタスクを一つの巨大な実行として扱います。実行前に見える計画はなく、途中で個別ステップを承認または却下する方法もなく、失敗したステップだけを再試行する方法もありません。何かが壊れたら、最初からやり直すことになります。

**共有ワークスペースでは、独立したタスク同士が衝突します。** 複数のセッションが同じファイルを同時に変更すると、未完成の変更が別のタスクへ混ざり、エージェント同士が干渉し、それぞれの成果を個別にレビュー、マージすることが難しくなります。

**エージェント主導の開発では、プロジェクト全体を見失いがちです。** 一つの機能が完成しても、次に何をするかは頭の中や散らばったプロンプトにしか残っていないことがあります。すべての作業が新しいチャットから始まると、ロードマップ全体や優先順位が見えにくくなり、一貫したリリースへ進んでいるか判断できません。

**Token 使用量は数えられても、価値とは結びつきにくいものです。** Token はエージェント、セッション、モデルごとに消費されますが、合計値だけでは修正したバグ数や提供した機能数は分かりません。コストと成果を結びつけなければ、エージェント開発が本当に効率化しているか判断できません。

**openteams** は、開発プロセス全体を明確で制御可能にします。同じセッション内のエージェントはコンテキストを共有するため、切り替えや説明の繰り返しが不要です。複雑なタスクは**見える、制御できるワークフロー**になり、実行前の計画調整、各ステップの監視、任意のノードの承認、却下、再試行、リダイレクトができます。

分離ワークスペースはセッションごとに専用の Git worktree を用意し、未完成の変更を共有せずに独立したタスクを実行できます。各セッションの成果を個別にレビューし、必要に応じてマージまたは破棄できます。

Issue 管理はロードマップを開発者の手に戻します。必要な作業を記録して優先順位を付け、Issue から軽量な実行セッションを直接作成または紐づけられます。Issue はエージェントが勝手に変更せず、開発者が管理するため、次に何をするかとプロジェクトの進捗について、常に自分で管理する信頼できる情報源を持てます。

ビルド統計は、投入と成果の間にフィードバックループを作ります。今週修正したバグ数、提供した機能数、消費した Token 数を、セッションやモデル別の内訳とともに表示します。何を使ったかだけでなく、その投入から何が生まれたかも分かります。

> 本当のレバレッジは、エージェントの数を増やすことではありません。何に取り組ませ、どう実行し、その成果がコストに見合うかを制御し続けることです。

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
  <a href="images/openteams-wechat-community.png"><img alt="openteams WeChat コミュニティグループ QR コード" src="images/openteams-wechat-community.png" width="260"></a>
  <a href="images/openteams-feishu-community.png"><img alt="openteams Feishu/Lark コミュニティグループ QR コード" src="images/openteams-feishu-community.png" width="260"></a>
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
| Issue 管理 | 開発者が管理する作業項目を記録して優先順位を付け、GitHub から Issue を同期し、実行セッションを作成または紐づけます。 |
| 分離ワークスペース | セッションごとの独立した Git worktree でタスクを実行し、他の作業へ干渉せずに成果をレビュー、マージ、破棄できます。 |
| ビルド統計 | 修正したバグ数や提供した機能数と、セッション、モデルごとの Token 使用量やコストを比較できます。 |
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

### macOS、Linux、Windows

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

openteams は Apache License 2.0 のもとで公開されています。簡単に言えば、次のことができます。

- 個人、教育、社内、商用プロジェクトで無料で使用する。
- ソースコードをコピー、変更し、それをもとに開発する。
- 元の版または変更版を、ソースコードやコンパイル済みソフトウェアとして配布する。
- 独自のクローズドソース製品へ組み込んで販売し、製品の他のコードは非公開のままにする。

openteams またはその変更版を再配布する場合は、ライセンスの写しを同梱し、関連する著作権表示と帰属表示を残し、変更したファイルを明示してください。

ほかに知っておくべき点は三つあります。

- **ブランド：** コードは使用できますが、openteams 公式を名乗ったり、openteams の名称や商標を自分のブランドとして使ったりすることはできません。
- **特許：** コードのコントリビューターは、自分のコードに必然的に関係する特許を理由に、あなたが openteams を使うことを妨げないと約束します。その代わり、「openteams が自分の特許を侵害している」として訴訟を起こすと、この特許保護を失います。失効するのは特許の許諾だけで、通常のコード利用許可ではありません。特許訴訟を行わない一般の利用者には、基本的に影響しません。
- **リスク：** ソフトウェアは無料で現状のまま提供されます。用途に合うか、使用上の問題やリスクを受け入れられるかは利用者自身が判断し、プロジェクトは保証や損害の補償を行いません。

完全な法的条件は [LICENSE](../LICENSE) を参照してください。
