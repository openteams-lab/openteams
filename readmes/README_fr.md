<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320" style="margin-top: 40px; margin-bottom: 20px;">

  <p><strong>Exécutez les agents comme une équipe, multipliez votre efficacité à l'ère de l'IA.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://docs.openteams.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="#démarrage-rapide">Démarrage rapide</a> |
    <a href="https://docs.openteams.com">Documentation</a>
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

**Guide de démarrage en une minute**

1. Importez une équipe prédéfinie et choisissez l'agent de base pour chaque membre.
2. Configurez des espaces de travail pour chaque membre de l'équipe.
3. Envoyez un message à un membre spécifique avec `@mentions`.

---

## Démarrage rapide

### Option A: Exécuter avec npx

```bash
# web
npx openteams-web
```

### Option B: Télécharger l'application de bureau

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### Prérequis

**Vous aurez besoin d'au moins un agent IA installé:**

| Agent | Installation |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [Plus de guides d'installation d'agents](https://docs.openteams.com/getting-started)

---

## Fonctionnalités

| Fonctionnalité | Ce que vous obtenez |
|--|--|
| **Agents supportés** | Prend en charge 10 runtimes d'agents de codage, dont `Claude Code`, `Gemini CLI`, `Codex`, `Qwen Code`, `Amp`, `Cursor Agent`, `Copilot`, `Droid`, `Kimi Code` et `OpenCode`. D'autres agents sont en cours d'intégration.|
| **Contexte de chat de groupe partagé** | Chaque participant travaille à partir du même historique de conversation au lieu de jongler avec des prompts copiés entre fenêtres séparées. |
| **Exécution parallèle** | Plusieurs agents peuvent travailler sur la même tâche en même temps dans une session partagée. Différents agents traitent les tâches pour lesquelles ils sont les meilleurs. |
| **Collaboration autonome** | Les agents peuvent se `@mentionner`, se passer le travail et coordonner directement dans le chat. |
| **Membres IA intégrés** | Commencez avec plus de 160 membres IA intégrés dans l'ingénierie, le marketing, la rédaction, la recherche et la production de contenu. |
| **Préréglages d'équipe IA intégrés** | Lancez-vous avec 8 préréglages d'équipe prêts à l'emploi pour les workflows courants. |
| **Directives d'équipe** | Définissez qui dirige, qui peut parler à qui, et comment la collaboration doit se dérouler. Personnalisez votre équipe IA et vos directives d'équipe. |
| **Bibliothèque de compétences** | Équipez les agents avec plus de 1000 compétences intégrées, et importez vos propres compétences si nécessaire. |
| **Exécution entièrement locale** | Les agents s'exécutent sur votre espace de travail local, et les artefacts d'exécution restent sous `.openteams/` dans cet espace. Pas de souci de confidentialité des données. |

### Exécution parallèle d'agents

*Exécutez plusieurs agents dans le même contexte partagé et laissez-les s'exécuter en parallèle pour accélérer la livraison.*

![OpenTeams parallel](../images/parallel.gif)

### Collaboration autonome d'agents

*OpenTeams permet aux agents de s'envoyer des messages directement sans imposer un workflow fixe. Si vous voulez plus de structure, ajoutez des directives d'équipe pour contrôler la communication, nommez un agent principal, ou laissez tout le monde collaborer librement. Le modèle de communication dépend entièrement de votre cas d'usage.*

![OpenTeams collaborate](../images/collaborate.gif)

### Membres IA

*OpenTeams inclut plus de 160 membres IA intégrés dans l'ingénierie, le marketing, la rédaction, la production de contenu, et plus. Combinez-les dans différentes équipes, personnalisez-les, et créez des combinaisons de rôles adaptées à votre façon de travailler. Nous continuerons à développer et améliorer la gamme.*

![OpenTeams members](../images/members.gif)

### Équipes IA

*OpenTeams est livré avec 8 préréglages d'équipe intégrés pour les workflows courants, afin que vous puissiez commencer immédiatement. Nous recommandons de définir des directives d'équipe lors de la création pour que la collaboration reste alignée sur la façon dont vous voulez que le groupe fonctionne.*

![OpenTeams team](../images/team.gif)

### Bibliothèque de compétences

*OpenTeams inclut plus de 1000 compétences intégrées que vous pouvez combiner et attribuer à différents membres IA. Vous pouvez également importer vos propres compétences et les appliquer directement à vos agents. Nous continuerons à développer la bibliothèque en nous concentrant sur les capacités qui tiennent la route dans les environnements de production réels.*

![OpenTeams skills](../images/skills.gif)

---

## Pourquoi nous sommes meilleurs

Légende: ✅ Support complet | 🟡 Support partiel | ❌ Pas de support

| **Capacité** | Agent unique traditionnel | Workflow multi-fenêtres | Claude Code Agent Team | OpenTeams |
|--|--|--|--|--|
| **Parallélisme**| ❌ Non, séquentiel | 🟡 Partiel, manuel | ✅ Oui, sous-agents Claude | ✅ Oui, automatique |
| **Contexte partagé** | ❌ Non | ❌ Non, copier-coller | 🟡 Partiel, contextes de sous-agents divisés | ✅ Oui, toujours synchronisé |
| **Collaboration multi-modèles** | ❌ Non | 🟡 Partiel, changement manuel | ❌ Non, Claude uniquement | ✅ Oui, Claude + Gemini + Codex + plus |
| **Passation d'agent** | ❌ Non | ❌ Non, vous orchestrez | 🟡 Partiel, délégué dans Claude | ✅ Oui, `@mentions` directs |
| **Membre IA prédéfini** | ❌ Non | ❌ Non | ❌ Non | ✅ Oui, plus de 160 membres |
| **Gestionnaire d'équipe** | ❌ Non | ❌ Non | ❌ Non | ✅ Oui, directives d'équipe personnalisables |
| **Votre effort** | 🔴 Élevé | 🔴 Très élevé | 🟠 Moyen | 🟢 Faible |

---

## Stack technique

| Couche | Technologie |
|-------|-----------|
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| Backend | Rust |
| Desktop | Tauri |

## Développement local

#### Mac/Linux

```bash
# 1. Cloner le repository
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. Installer les dépendances
pnpm i

# 3. Démarrer le serveur de développement (backend Rust + frontend React)
pnpm run dev

# 4. Builder le frontend
pnpm --filter frontend build

# 5. Builder l'application desktop
pnpm desktop:build
```

#### Windows (PowerShell): Démarrer backend et frontend séparément

`pnpm run dev` ne peut pas s'exécuter dans Windows PowerShell. Utilisez les commandes suivantes pour démarrer backend et frontend séparément.

```bash
# 1. Cloner le repository
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. Installer les dépendances
pnpm i

# 3. Générer les types TypeScript
pnpm run generate-types

# 4. Exécuter les migrations de base de données
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
$env:FRONTEND_PORT = <port frontend généré depuis le terminal A>
$env:BACKEND_PORT = <port backend généré depuis le terminal A>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

Ouvrez la page frontend à `http://localhost:<FRONTEND_PORT>` (exemple: `http://localhost:3001`).

## Notes de version et Feuille de route

### V0.2

- ~~[x] Chat de groupe multi-agents avec contexte partagé~~
- ~~[x] Exécution parallèle d'agents~~
- ~~[x] @mention d'agents et collaboration autonome~~
- ~~[x] Support de 10 runtimes d'agents de codage (Claude Code, Gemini CLI, Codex, Qwen Code, Amp, Cursor Agent, Copilot, Droid, Kimi Code, OpenCode)~~
- ~~[x] Applications desktop (Windows, macOS, Linux)~~
- ~~[x] Application web via npx~~
- ~~[x] Support multilingue (EN, ZH, JA, KO, FR, ES)~~

### V0.3

- ~~[x] Refonte complète de l'interface frontend~~
- ~~[x] Plus de 160 membres IA intégrés~~
- ~~[x] 8 préréglages d'équipe IA intégrés~~
- ~~[x] Configuration des règles d'équipe~~
- ~~[x] Plus de 1000 compétences intégrées~~
- ~~[x] Exécution entièrement locale avec isolation de l'espace de travail~~
- ~~[x] Redéfinition du protocole d'entrée~~

### Feuille de route

- [ ] Backend Code Agent optimisé pour les cas d'usage OpenTeams
- [ ] Établir un framework de collaboration d'équipe efficace
- [ ] Plus d'intégrations d'agents (Kilo Code, OpenClaw, etc.)
- [ ] Ajouter des équipes IA plus puissantes prêtes à l'emploi
- [ ] Ajouter des compétences plus puissantes
- [ ] Développer plusieurs schémas de couleurs pour l'interface
- [ ] Offrir une version hautement optimisée et personnalisée


## Contribution

Les contributions sont les bienvenues! Consultez ce qui est nécessaire dans [Issues](https://github.com/openteams-lab/openteams/issues) ou lancez une [Discussion](https://github.com/openteams-lab/openteams/discussions).

1. Fork -> branche feature -> PR
2. Veuillez ouvrir une issue avant les gros changements
3. Veuillez suivre notre [Code of Conduct](../CODE_OF_CONDUCT.md)

## Communauté

| | |
|--|--|
| **Rapports de bugs** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **Discussions** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **Chat communautaire** | [Discord](https://discord.gg/MbgNFJeWDc) |

## Remerciements

Construit sur [Vibe Kanban](https://www.vibekanban.com/) - merci à leur équipe pour l'excellente base open source.

Merci également à [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) pour avoir aidé à façonner l'écosystème de compétences intégré, et à [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) pour l'inspiration autour de la conception des rôles d'agents et de la composition d'équipe.