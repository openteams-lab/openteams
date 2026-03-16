<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320" style="margin-top: 15px; margin-bottom: 15px;">

  <p><strong>팀으로 에이전트를 실행하고, AI 시대에 효율을 배가하세요.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams"><img alt="npm" src="https://img.shields.io/npm/v/openteams?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://docs.openteams.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="https://your-demo-link.com">데모 보기</a> |
    <a href="#빠른-시작">빠른 시작</a> |
    <a href="https://docs.openteams.com">문서</a>
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

**1분 퀵스타트 가이드**

1. 프리셋 팀을 가져오고 각 멤버의 기본 에이전트를 선택합니다.
2. 팀의 각 멤버에 대한 워크스페이스를 설정합니다.
3. `@mentions`로 특정 멤버에게 메시지를 보냅니다.

---

## 빠른 시작

### 옵션 A: npx로 실행

```bash
# web
npx openteams-web
```

### 옵션 B: 데스크톱 앱 다운로드

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### 요구사항

**최소 하나의 AI 에이전트가 설치되어 있어야 합니다:**

| Agent | 설치 |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [더 많은 에이전트 설치 가이드](https://docs.openteams.com/getting-started)

---

## 기능

| 기능 | 제공 내용 |
|--|--|
| **지원 에이전트** | `Claude Code`, `Gemini CLI`, `Codex`, `Qwen Code`, `Amp`, `Cursor Agent`, `Copilot`, `Droid`, `Kimi Code`, `OpenCode` 등 10가지 코딩 에이전트 런타임을 지원합니다. 다른 에이전트도 통합 중입니다.|
| **공유 그룹 채팅 컨텍스트** | 모든 참여자가 같은 대화 기록에서 작업하므로 별도의 창에서 프롬프트를 복사하여 붙여넣을 필요가 없습니다. |
| **병렬 실행** | 여러 에이전트가 같은 공유 세션에서 동시에 같은 작업을 처리할 수 있습니다. 각 에이전트가 가장 잘하는 작업을 처리합니다. |
| **자율적 협업** | 에이전트가 서로 `@mention`하고, 작업을 인계하며, 채팅 내에서 직접 조정할 수 있습니다. |
| **내장 AI 멤버** | 엔지니어링, 마케팅, 작문, 연구, 콘텐츠 제작 등 160개 이상의 내장 AI 멤버로 시작할 수 있습니다. |
| **내장 AI 팀 프리셋** | 일반적인 워크플로우를 위한 8개의 바로 사용 가능한 팀 프리셋이 제공됩니다. |
| **팀 가이드라인** | 누가 리드하는지, 누가 누구와 대화할 수 있는지, 협업을 어떻게 진행할지 정의할 수 있습니다. AI 팀과 팀 가이드라인을 사용자 정의하세요. |
| **스킬 라이브러리** | 1000개 이상의 내장 스킬로 에이전트를 장비할 수 있으며, 필요할 때 자신의 스킬을 가져올 수 있습니다. |
| **완전 로컬 실행** | 에이전트가 로컬 워크스페이스에서 실행되며, 런타임 아티팩트는 해당 워크스페이스의 `.openteams/`에 저장됩니다. 데이터 프라이버시에 대해 걱정할 필요가 없습니다. |

### 병렬 에이전트 실행

*동일한 공유 컨텍스트에서 여러 에이전트를 실행하고 병렬로 실행하여 전달 속도를 높입니다.*

![OpenTeams parallel](../images/parallel.gif)

### 자율적 에이전트 협업

*OpenTeams는 에이전트가 고정된 워크플로우를 강제하지 않고 직접 메시지를 주고받을 수 있게 합니다. 더 많은 구조가 필요하면 팀 가이드라인을 추가하여 통신을 제어하고, 리드 에이전트를 지정하거나, 모두가 자유롭게 협업할 수 있게 합니다. 통신 패턴은 전적으로 사용 사례에 달려 있습니다.*

![OpenTeams collaborate](../images/collaborate.gif)

### AI 멤버

*OpenTeams는 엔지니어링, 마케팅, 작문, 콘텐츠 제작 등 160개 이상의 내장 AI 멤버를 포함합니다. 다른 팀으로 조합하고, 사용자 정의하고, 작업 방식에 맞는 역할 조합을 구축하세요. 계속해서 라인업을 확장하고 개선할 것입니다.*

![OpenTeams members](../images/members.gif)

### AI 팀

*OpenTeams는 일반적인 워크플로우를 위한 8개의 내장 팀 프리셋과 함께 제공되어 즉시 시작할 수 있습니다. 팀을 만들 때 팀 가이드라인을 정의하여 그룹이 운영되길 원하는 방식과 협업이 일치하도록 하는 것을 권장합니다.*

![OpenTeams team](../images/team.gif)

### 스킬 라이브러리

*OpenTeams는 1000개 이상의 내장 스킬을 포함하여 다른 AI 멤버에게 조합하여 할당할 수 있습니다. 직접 만든 스킬을 가져와서 에이전트에 직접 적용할 수도 있습니다. 실제 프로덕션 환경에서 작동하는 기능에 초점을 맞춰 스킬 라이브러리를 계속 확장할 것입니다.*

![OpenTeams skills](../images/skills.gif)

---

## 왜 우리가 더 나은가

범례: ✅ 완전 지원 | 🟡 부분 지원 | ❌ 지원 없음

| **기능** | 전통적 단일 에이전트 | 멀티 윈도우 워크플로우 | Claude Code Agent Team | OpenTeams |
|--|--|--|--|--|
| **병렬성**| ❌ 없음, 순차 | 🟡 부분, 수동 | ✅ 있음, Claude 서브에이전트 | ✅ 있음, 자동 |
| **공유 컨텍스트** | ❌ 없음 | ❌ 없음, 복사하여 붙여넣기 | 🟡 부분, 서브에이전트 컨텍스트 분할 | ✅ 있음, 항상 동기화 |
| **멀티 모델 협업** | ❌ 없음 | 🟡 부분, 수동 전환 | ❌ 없음, Claude만 | ✅ 있음, Claude + Gemini + Codex + 기타 |
| **에이전트 인계** | ❌ 없음 | ❌ 없음, 수동 조정 | 🟡 부분, Claude 내 위임만 | ✅ 있음, 직접 `@mentions` |
| **사전 정의된 AI 멤버** | ❌ 없음 | ❌ 없음 | ❌ 없음 | ✅ 있음, 160개 이상의 멤버 |
| **팀 관리자** | ❌ 없음 | ❌ 없음 | ❌ 없음 | ✅ 있음, 팀 가이드라인 사용자 정의 |
| **당신의 노력** | 🔴 높음 | 🔴 매우 높음 | 🟠 중간 | 🟢 낮음 |

---

## 기술 스택

| 레이어 | 기술 |
|-------|-----------|
| 프론트엔드 | React + TypeScript + Vite + Tailwind CSS |
| 백엔드 | Rust |
| 데스크톱 | Tauri |

## 로컬 개발

#### Mac/Linux

```bash
# 1. 저장소 클론
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 의존성 설치
pnpm i

# 3. 개발 서버 시작 (Rust 백엔드 + React 프론트엔드 실행)
pnpm run dev

# 4. 프론트엔드 빌드
pnpm --filter frontend build

# 5. 데스크톱 앱 빌드
pnpm desktop:build
```

#### Windows (PowerShell): 백엔드와 프론트엔드를 별도로 시작

`pnpm run dev`는 Windows PowerShell에서 실행할 수 없습니다. 다음 명령을 사용하여 백엔드와 프론트엔드를 별도로 시작하세요.

```bash
# 1. 저장소 클론
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 의존성 설치
pnpm i

# 3. TypeScript 타입 생성
pnpm run generate-types

# 4. 데이터베이스 마이그레이션 실행
pnpm run prepare-db
```

**터미널 A (백엔드)**

```powershell
$env:FRONTEND_PORT = node scripts/setup-dev-environment.js frontend
$env:BACKEND_PORT = node scripts/setup-dev-environment.js backend
$env:RUST_LOG = "debug"
cargo run --bin server
```

**터미널 B (프론트엔드)**

```powershell
$env:FRONTEND_PORT = <터미널 A에서 생성된 프론트엔드 포트>
$env:BACKEND_PORT = <터미널 A에서 생성된 백엔드 포트>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

프론트엔드 페이지 열기: `http://localhost:<FRONTEND_PORT>` (예: `http://localhost:3001`).

## 릴리스 노트 및 로드맵

### V0.2

- ~~[x] 멀티 에이전트 그룹 채팅 및 공유 컨텍스트~~
- ~~[x] 병렬 에이전트 실행~~
- ~~[x] 에이전트 @mention 및 자율적 협업~~
- ~~[x] 10가지 코딩 에이전트 런타임 지원 (Claude Code, Gemini CLI, Codex, Qwen Code, Amp, Cursor Agent, Copilot, Droid, Kimi Code, OpenCode)~~
- ~~[x] 데스크톱 앱 (Windows, macOS, Linux)~~
- ~~[x] npx를 통한 웹 앱~~
- ~~[x] 다국어 지원 (EN, ZH, JA, KO, FR, ES)~~

### V0.3

- ~~[x] 프론트엔드 인터페이스 전면 개편~~
- ~~[x] 160개 이상의 내장 AI 멤버~~
- ~~[x] 8개의 내장 AI 팀 프리셋~~
- ~~[x] 팀 규칙 설정~~
- ~~[x] 1000개 이상의 내장 스킬~~
- ~~[x] 완전 로컬 실행 및 워크스페이스 격리~~
- ~~[x] 입력 프로토콜 재정의~~

### 로드맵

- [ ] OpenTeams 사용 사례에 최적화된 Code Agent 백엔드
- [ ] 고효율 팀 협업 프레임워크 구축
- [ ] 더 많은 에이전트 통합 (Kilo Code, OpenClaw 등)
- [ ] 더 강력한 바로 사용 가능한 AI 팀 추가
- [ ] 더 강력한 스킬 추가
- [ ] 다양한 프론트엔드 색상 테마 개발
- [ ] 고도로 최적화된 맞춤 버전 제공


## 기여

기여를 환영합니다! [Issues](https://github.com/openteams-lab/openteams/issues)에서 필요한 것을 확인하거나 [Discussion](https://github.com/openteams-lab/openteams/discussions)에서 토론을 시작하세요.

1. Fork -> feature 브랜치 -> PR
2. 큰 변경 전에 issue를 열어주세요
3. [Code of Conduct](../CODE_OF_CONDUCT.md)를 따라주세요

## 커뮤니티

| | |
|--|--|
| **버그 리포트** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **토론** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **커뮤니티 채팅** | [Discord](https://discord.gg/MbgNFJeWDc) |

## 감사의 말

[Vibe Kanban](https://www.vibekanban.com/)을 기반으로 구축되었습니다. 훌륭한 오픈 소스 기반을 제공해 준 팀에 감사합니다.

또한 내장 스킬 생태계를 형성하는 데 도움을 준 [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)와 에이전트 역할 설계 및 팀 구성에 영감을 준 [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)에게도 감사합니다.