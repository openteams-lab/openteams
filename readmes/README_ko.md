<div align="center">
  <img src="../frontend/public/Logo/logo_blue.svg" alt="OpenTeams" width="200">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320" style="margin-top: 10px; margin-bottom: 10px;">
  
  <p><strong>에이전트를 하나의 팀처럼 실행해 AI 시대의 효율을 몇 배로 높이세요.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://doc.openteams-lab.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="#빠른-시작">빠른 시작</a> |
    <a href="https://doc.openteams-lab.com">문서</a> 
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

**1분 빠른 시작 가이드**

1. 프리셋 팀을 가져오고 각 멤버의 기본 Agent를 선택합니다.
2. 팀의 각 멤버에 대해 워크스페이스를 설정합니다.
3. `@member` 로 특정 멤버에게 메시지를 보냅니다.

---
## 🔥 *최신 소식:*
### *주요 업데이트*
- **2026.04.02 (v0.3.11)**
  - 다크 UI 모드 활성화
  - openteams-cli 동시성 문제 수정
- **2026.04.02 (v0.3.10)**
  - 앱 내 버전 업데이트 구현
  - 문서 사이트가 공개되었습니다.
- **2026.03.24 (v0.3.7)**: 
  - 내장 openteams-CLI Agent를 추가해 로컬 Agent 설치 의존성을 제거했습니다.
  - 실행기의 메모리 누수 문제를 수정했습니다.
---

## 빠른 시작

### 옵션 A: npx로 실행
**Mac과 Linux에서는 이 설치 방식을 권장합니다.**

```bash
# web
npx openteams-web
```

### 옵션 B: 데스크톱 앱 다운로드

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### 요구 사항

**v0.3.7부터 openteams-cli가 내장되어 있으므로 AI Agent를 따로 설치할 필요가 없습니다. `Settings -> Service Providers` 페이지에서 API를 설정할 수 있습니다.**

⚙️ [프로바이더 설정 문서를 참고하세요.](https://doc.openteams-lab.com/ko/advanced-usage/custom-provider)

지원되는 Agent 목록에서 원하는 Agent를 선택해 사용할 수도 있습니다.

| Agent | 설치 방법 |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [더 많은 Agent 설치 가이드](https://doc.openteams-lab.com/getting-started)

---

## 기능

| 기능 | 제공되는 내용 |
|--|--|
| **지원 Agent** | `Claude Code`, `Gemini CLI`, `Codex`, `Qwen Code`, `Amp`, `Cursor Agent`, `Copilot`, `Droid`, `Kimi Code`, `OpenCode`를 포함한 10가지 코딩 Agent 런타임을 지원합니다. 현재 더 많은 Agent도 통합 중입니다.|
| **공유 그룹 채팅 컨텍스트** | 모든 참여자가 동일한 대화 기록을 기반으로 작업하므로 여러 창 사이에서 프롬프트를 복사해 옮길 필요가 없습니다. |
| **병렬 실행** | 여러 Agent가 하나의 공유 세션 안에서 동시에 같은 작업을 처리할 수 있습니다. 각 Agent는 자신이 가장 잘하는 부분을 맡습니다. |
| **자율 협업** | Agent끼리 서로 `@mention` 하고, 작업을 넘기고, 채팅 안에서 직접 협업할 수 있습니다. |
| **내장 AI 멤버** | 엔지니어링, 마케팅, 글쓰기, 리서치, 콘텐츠 제작을 아우르는 160개 이상의 내장 AI 멤버를 바로 사용할 수 있습니다. |
| **내장 AI 팀 프리셋** | 일반적인 워크플로를 위한 즉시 사용 가능한 8개의 팀 프리셋을 제공합니다. |
| **팀 협업 가이드라인** | 누가 리드하는지, 누가 누구와 소통할 수 있는지, 협업을 어떻게 진행할지 정의할 수 있습니다. 원하는 방식에 맞춰 AI 팀과 팀 가이드라인을 설정하세요. |
| **스킬 라이브러리** | 1000개 이상의 내장 스킬을 Agent에 할당할 수 있고, 필요할 때 직접 만든 스킬도 가져올 수 있습니다. |
| **완전한 로컬 실행** | Agent는 로컬 워크스페이스에서 직접 실행되며 실행 산출물은 해당 워크스페이스 안의 `.openteams/` 아래에 저장됩니다. 데이터 프라이버시를 걱정할 필요가 없습니다. |

### 병렬 Agent 실행

*여러 Agent를 같은 공유 컨텍스트에서 병렬로 실행해 전달 속도를 높이세요.*

![OpenTeams parallel](images/parallel.gif)

### 자율 Agent 협업

*OpenTeams는 고정된 워크플로를 강제하지 않고 Agent들이 서로 직접 메시지를 주고받을 수 있게 합니다. 더 구조화된 방식이 필요하다면 팀 가이드라인으로 소통 방식을 제어하고, 리드 Agent를 지정하거나, 모두가 자유롭게 협업하도록 둘 수 있습니다. 소통 방식은 전적으로 사용 사례에 따라 달라집니다.*

![OpenTeams collaborate](images/collaborate.gif)

### AI 멤버

*OpenTeams에는 엔지니어링, 마케팅, 글쓰기, 콘텐츠 제작 등 다양한 분야를 아우르는 160개 이상의 내장 AI 멤버가 포함되어 있습니다. 자유롭게 조합해 팀을 만들고, 필요에 따라 커스터마이즈하며, 자신의 일하는 방식에 맞는 역할 구성을 만들 수 있습니다. 앞으로도 이 멤버 구성을 계속 확장하고 개선해 나갈 예정입니다.*

![OpenTeams members](images/members.gif)

### AI 팀

*OpenTeams는 일반적인 워크플로에 맞춘 8개의 팀 프리셋을 기본 제공합니다. 팀을 만들 때 팀 가이드라인을 함께 정의하면 협업 방식이 원하는 운영 방향과 잘 맞도록 유지할 수 있습니다.*

![OpenTeams team](images/team.gif)

### 스킬 라이브러리

*OpenTeams에는 1000개 이상의 내장 스킬이 포함되어 있어 다양한 AI 멤버에게 조합해 배정할 수 있습니다. 직접 만든 스킬을 가져와 Agent에 바로 적용할 수도 있습니다. 실제 프로덕션 환경에서도 안정적으로 쓸 수 있는 기능에 집중해 스킬 라이브러리를 계속 확장할 예정입니다.*

![OpenTeams skills](images/skills.gif)

---

## 왜 OpenTeams가 더 강한가

범례: ✅ 완전 지원 | 🟡 부분 지원 | ❌ 미지원

| **역량** | 전통적인 단일 Agent | 멀티 윈도우 워크플로 | Claude Code Agent Team | openteams |
|--|--|--|--|--|
| **병렬성**| ❌ 미지원, 순차 실행만 가능 | 🟡 부분 지원, 수동 작업 필요 | ✅ 지원, Claude 서브에이전트 | ✅ 지원, 자동 |
| **공유 컨텍스트** | ❌ 미지원 | ❌ 미지원, 복사/붙여넣기 필요 | 🟡 부분 지원, 서브에이전트 컨텍스트가 분리됨 | ✅ 지원, 항상 동기화 |
| **멀티 모델 협업** | ❌ 미지원 | 🟡 부분 지원, 수동 전환 | ❌ 미지원, Claude만 가능 | ✅ 지원, Claude + Gemini + Codex + 기타 |
| **Agent 인계** | ❌ 미지원 | ❌ 미지원, 직접 오케스트레이션 필요 | 🟡 부분 지원, Claude 내부 위임 | ✅ 지원, 직접 `@mentions` |
| **사전 정의된 AI 멤버** | ❌ 미지원 | ❌ 미지원 | ❌ 미지원 | ✅ 지원, 160개 이상 |
| **팀 운영 관리** | ❌ 미지원 | ❌ 미지원 | ❌ 미지원 | ✅ 지원, 팀 가이드라인 커스터마이즈 |
| **필요한 노력** | 🔴 높음 | 🔴 매우 높음 | 🟠 중간 | 🟢 낮음 |

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

#### Windows (PowerShell): 백엔드와 프론트엔드를 따로 실행

`pnpm run dev`는 Windows PowerShell에서 실행할 수 없습니다. 아래 명령으로 백엔드와 프론트엔드를 각각 실행하세요.

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
$env:FRONTEND_PORT = <터미널 A에서 생성된 frontend 포트>
$env:BACKEND_PORT = <터미널 A에서 생성된 backend 포트>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

`http://localhost:<FRONTEND_PORT>` 에서 프론트엔드를 엽니다 (예: `http://localhost:3001`).

#### `openteams-cli` 로컬 빌드

내장 버전이나 배포된 빌드 대신 로컬 `openteams-cli` 바이너리를 직접 컴파일해야 한다면 아래 명령을 사용하세요.
빌드 결과물은 binaries 디렉터리에 저장됩니다.

```bash
# 저장소 루트에서 실행
bun run ./scripts/build-openteams-cli.ts
```

## 릴리스 노트 및 로드맵

### V0.2

- [x] 공유 컨텍스트 기반 멀티 Agent 그룹 채팅
- [x] 병렬 Agent 실행
- [x] Agent `@mention` 및 자율 협업
- [x] 10가지 코딩 Agent 런타임 지원 (Claude Code, Gemini CLI, Codex, Qwen Code, Amp, Cursor Agent, Copilot, Droid, Kimi Code, OpenCode)
- [x] 데스크톱 앱 (Windows, macOS, Linux)
- [x] npx로 실행 가능한 웹 앱
- [x] 다국어 지원 (EN, ZH, JA, KO, FR, ES)

### V0.3
- [x] 프론트엔드 인터페이스 전면 개편 완료
- [x] 160개 이상의 내장 AI 멤버
- [x] 8개의 내장 AI 팀 프리셋
- [x] 팀 규칙 설정
- [x] 1000개 이상의 내장 스킬
- [x] 완전 로컬 실행 및 워크스페이스 격리
- [x] 입력 프로토콜 재정의

### 로드맵
- [x] OpenTeams 사용 사례에 최적화된 Code Agent 백엔드 —— v0.3.7
- [x] 여러 프론트엔드 색상 테마 개발 —— v0.3.11
- [ ] 고효율 팀 협업 프레임워크 구축
- [ ] 더 많은 Agent 통합 (Kilo Code, OpenClaw 등)
- [ ] 더 강력한 즉시 사용 가능한 AI 팀 추가
- [ ] 더 강력한 스킬 추가
- [ ] 고도로 최적화된 맞춤 버전 제공


## 기여

기여를 환영합니다. 필요한 내용은 [Issues](https://github.com/StarterraAI/OpenTeams/issues) 에서 확인하거나 [Discussion](https://github.com/StarterraAI/OpenTeams/discussions) 을 시작해 주세요.

1. Fork -> feature 브랜치 생성 -> PR 제출
2. 큰 변경은 먼저 issue로 논의해 주세요
3. [Code of Conduct](../CODE_OF_CONDUCT.md) 를 따라 주세요

### 코드 포맷팅

PR을 제출하기 전에 코드가 올바르게 포맷되어 있는지 확인해 주세요.

```bash
# 프론트엔드와 백엔드를 모두 포맷
pnpm run format

# 파일 수정 없이 포맷 상태만 확인
pnpm run format:check

# 프론트엔드만 포맷
pnpm run frontend:format

# 백엔드만 포맷 (Rust)
pnpm run backend:format
```

**참고:** 코드 포맷이 올바르지 않으면 CI가 실패합니다. push 전에 항상 `pnpm run format:check` 를 실행하세요.

## 커뮤니티

| | |
|--|--|
| **버그 제보** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **토론** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **커뮤니티 채팅** | [Discord](https://discord.gg/MbgNFJeWDc) |

## 감사의 말

이 프로젝트는 [Vibe Kanban](https://www.vibekanban.com/) 을 기반으로 구축되었습니다. 훌륭한 오픈소스 기반을 제공해 준 팀에 감사드립니다.

또한 내장 스킬 생태계 형성에 도움을 준 [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) 와 Agent 역할 설계 및 팀 구성에 영감을 준 [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) 에게도 감사드립니다.
