<div align="center">
  <img src="images/openteams-logo.png" alt="openteams" width="100">
</div>

<div align="center">
  <img src="images/characters_black.png" alt="openteams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>計画し、構築し、届ける——1つの AI エージェントではなく、AI チームとともに</h5>

  <p>
    openteams は、個人開発者が自分で管理できる AI チームとともに、ソフトウェアをより速く計画、構築、リリースするための、オープンソースかつローカルファーストの AI デスクトップアプリです。
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
  <video src="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590" controls autoplay muted playsinline width="100%">
    <a href="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590">製品動画を見る</a>
  </video>
</div>

## openteams とは？

すでに Claude Code、Codex、Gemini CLI などのコーディングエージェントを使っているでしょう。どれも単独なら問題なく働きます。そこで二つ目のターミナルを開き、さらに三つ目を開きます。同じコンテキストを繰り返し伝え、結果を別のウィンドウへ運び、誰が何を変更しているかを自分で覚えておきます。やがて、仕事ではなくエージェントを管理することになります。変更は複数のセッションに散らばり、プロジェクトの優先順位は別の場所にあり、トークン使用量は実際に提供された成果と結び付いていません。

openteams は、そうしたエージェントの周りに足りないものを補います。**エージェントが会話して作業を引き継げる一つの共有スペース、開発者が確認して操作できる実行計画、そしてロードマップをエージェントに渡さず、プロジェクトのタスクとエージェントの成果を結ぶ軽量なローカル記録です。**

| openteams **であるもの** | openteams **ではないもの** |
| --- | --- |
| いま使っているコーディングエージェントをつなぐローカルファーストのワークスペース | 新しいモデルや、Claude Code、Codex、Gemini CLI の代替品 |
| エージェントが会話し、仕事を引き継ぎ、同じコンテキストを保てる共有セッション | 自分で調整し続ける必要がある、ばらばらのチャット画面 |
| 開発者が管理し、エージェントのセッションに関連付ける Issue リスト | 本格的なプロジェクト管理ツールや、エージェントが書き換えるロードマップ |
| ステップごとに確認、レビュー、中断、再試行できるワークフロー | 完了まで中身が見えない一つの大きなプロンプト |
| 個別にレビュー、マージ、破棄できる分離 worktree | 複数のエージェントが同じワークスペースを変更して干渉し合う状態 |
| エージェントの成果、使用量、コストが分かるビルド統計 | 何を構築したか分からないトークンカウンター |

**インストールすると、具体的には次が使えます。** 軽い協業と計画的な実行に対応するチャットセッション、すぐに使えるチームワークフローテンプレート、作業をセッションに結び付けて開発者が管理する Issue、並行タスクを分離する独立ワークスペース、そして詳細なビルド統計です。

```text
openteams なし                    openteams あり

Claude ─ terminal A ─┐            Claude ─┐
Codex ── terminal B ─┼─ 自分で中継 Codex ─┼─ 共有セッション
Gemini ─ terminal C ─┘            Gemini ─┘

計画：別の場所                    Issue ── session ── ビルド成果
```

## openteams が必要な理由

エージェントにコードを書かせること自体は、もう難しくありません。難しいのは、その仕事をきちんと管理することです。コンテキストが引き継がれているか、いま何が進んでいるか、並行作業がぶつからないか、次に何をするか、そしてどれだけコストがかかったかを把握する必要があります。

openteams はエージェントと会話を一つのセッションにまとめます。複雑なタスクでは、Workflow モードがステップと依存関係を表示するため、すべてをやり直さずに必要な部分だけをレビュー、再試行できます。複数のセッションを同時に動かす場合は、それぞれに専用の Git worktree を用意し、未完成の変更を分けたまま、あとでマージまたは破棄できます。

プロジェクトの方向を決めるのは、あくまで開発者です。Issue には開発者が選んだ作業を記録し、エージェントが実行するセッションを紐づけます。エージェントは作業を進めますが、計画を書き換えることはありません。作業後は、ビルド統計で成果とトークン使用量、コストをまとめて確認できます。

openteams が目指すのは、エージェントの数を増やすことではありません。何を作っているのか、変更はどこにあるのか、次に何をするのか、そしていくらかかったのかを、いつでも分かるようにすることです。

## クイックスタート
### インストール
#### デスクトップアプリ（推奨）

GitHub Releases から、お使いのプラットフォーム向けの最新リリースをダウンロードしてください。

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-windows-x64.msi)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-macos.dmg)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-linux-amd64.deb)

**macOS：** 現在の macOS リリースは、Apple Developer ID による署名および公証が行われていません。ブラウザはインターネットからダウンロードした App に隔離属性を付与するため、ダウンロードが破損していなくても、Gatekeeper が openteams を「壊れている」と表示する場合があります。`openteams.app` を `/Applications` にドラッグした後、それが openteams 公式 GitHub Release から入手したものだと確認できる場合に限り、次を実行してください：

```bash
xattr -dr com.apple.quarantine /Applications/openteams.app
```

このコマンドは openteams の隔離属性だけを削除し、Gatekeeper をシステム全体で無効にはしません。

#### npx

```bash
npx openteams-web
```

### プロバイダー設定

**openteams** には、組み込みの openteams CLI エージェントが含まれています。アプリ内の `Settings → Provider Config → Add Provider` からモデルプロバイダーを設定できます。

⚙️ [プロバイダー設定](https://doc.openteams-lab.com/advanced-usage/custom-provider)

次のような対応コーディングエージェントも接続できます。

| エージェント | インストール例 |
| --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Gemini CLI | `npm i -g @google/gemini-cli` |
| Codex | `npm i -g @openai/codex` |
| Qwen Code | `npm i -g @qwen-code/qwen-code` |
| OpenCode | `npm i -g opencode-ai` |

📚 [その他のエージェントインストールガイド](https://doc.openteams-lab.com/getting-started)

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

- [ ] **専門性を持つ AI ワーカー** — 専門領域の知識を持ち、専門的な課題を解決できる AI ワーカーをさらに提供します。
- [ ] **高い成果を生み出す AI チーム** — 効率的な専門 AI ワーカーで構成され、特定のビジネス向けに生産ワークフローをカスタマイズし、要件をエンドツーエンドで成果物へ変換します。
- [ ] **より多くのエージェント統合** — Kilo Code、hermes-agent、openclaw など、よく使われるエージェントをさらに統合します。

***ビジョン：トークン消費を本当の生産性へ変える。***

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
| AI 従業員と AI チーム | トークンを本当の生産性へ変えます。各 AI 従業員やチームは分野固有の専門性を持ち、汎用モデルを専門家へ高めます。テキスト生成にとどまらず、実際の成果物を納品できます。 |
| マルチエージェントワークスペース | 複数の AI エージェントを一つの共有セッションに集め、別々のウィンドウを行き来する必要をなくします。 |
| 共有コンテキスト | エージェントは同じ会話とプロジェクトコンテキストをもとに作業します。 |
| Free Chat | `@` を使って、直接かつ軽量にエージェントと協業できます。 |
| Workflow モード | 複雑なタスクを、構造化されたステップ、依存関係、レビュー、再試行、受け入れに変換します。 |
| 見える実行 | 各エージェントが何をしているか、どこで作業が止まっているかを確認できます。 |
| レビューと再試行 | ステップをレビューし、必要なタスクだけを再試行し、プロジェクト全体のやり直しを避けます。 |
| Issue 管理 | 開発者が管理する作業項目を記録して優先順位を付け、GitHub から Issue を同期し、実行セッションを作成または紐づけます。 |
| 分離ワークスペース | セッションごとの独立した Git worktree でタスクを実行し、他の作業へ干渉せずに成果をレビュー、マージ、破棄できます。 |
| ビルド統計 | 修正したバグ数や提供した機能数と、セッション、モデルごとのトークン使用量やコストを比較できます。 |
| 成果物とトレース | ログ、diff、トランスクリプト、生成された成果物を作業に紐づけて保持します。 |
| ローカルワークスペース実行 | エージェントは設定済みのワークスペースに対して作業し、実行記録は `.openteams/` 配下に保存されます。 |

## 対象ユーザー

openteams は次のような人やチームに向いています。

- 複数のコーディングエージェントを使っていて、その切り替えや調整に疲れている開発者
- エージェント実行をレビュー可能かつ再現可能にしたい技術リード

これは単にエージェントを集める場所ではありません。エージェントを実際に協働できるチームに変える方法です。

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

コントリビューションを歓迎します。他の人が学び、応用できる再利用可能な AI チームワークフローの共有も歓迎します。始め方は次の通りです。

1. **Issue を探す** — 初心者向けのタスクは [Good First Issues](https://github.com/openteams-lab/openteams/labels/good%20first%20issue) を確認するか、未解決の Issue を見てください。
2. **実装前に相談する** — 大きな pull request を開く前に、方向性を合わせるため Issue または Discussion を開いてください。
3. **コードスタイルに従う** — 提出前に次を実行してください。

```bash
pnpm run format
pnpm run check
pnpm run lint
```

4. **PR を送る** — 何を、なぜ変更したのかを書いてください。関連する Issue があればリンクしてください。

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

この節は平易な言葉による要約です。法的には [LICENSE](../LICENSE) の条項が優先されます。

完全な法的条件は [LICENSE](../LICENSE) を参照してください。
