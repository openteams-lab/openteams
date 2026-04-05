<div align="center">
  <img src="../frontend/public/Logo/logo_blue.svg" alt="OpenTeams" width="200">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320" style="margin-top: 10px; margin-bottom: 10px;">
  
  <p><strong>Faites fonctionner les agents comme une seule équipe et multipliez votre efficacité à l'ère de l'IA.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://doc.openteams-lab.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="#démarrage-rapide">Démarrage rapide</a> |
    <a href="https://doc.openteams-lab.com">Documentation</a> 
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

**Guide de prise en main en une minute**

1. Importez une équipe prédéfinie et choisissez l'Agent de base pour chaque membre.
2. Configurez un espace de travail pour chaque membre de l'équipe.
3. Envoyez un message à un membre précis avec `@member`.

---
## 🔥 *Nouveautés :*
### *Mises à jour majeures*
- **2026.04.02 (v0.3.11)**
  - Activation du mode interface sombre
  - Correction des problèmes de concurrence d'openteams-cli
- **2026.04.02 (v0.3.10)**
  - Mise en place des mises à jour intégrées à l'application
  - Le site de documentation est désormais en ligne.
- **2026.03.24 (v0.3.7)**: 
  - Ajout de l'Agent openteams-CLI intégré, supprimant la dépendance à une installation locale d'Agent.
  - Correction d'une fuite mémoire dans l'exécuteur.
---

## Démarrage rapide

### Option A : Lancer avec npx
**Cette méthode d'installation est recommandée sur Mac et Linux.**

```bash
# web
npx openteams-web
```

### Option B : Télécharger l'application desktop

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### Prérequis

**À partir de la v0.3.7, openteams-cli est intégré ; il n'est donc plus nécessaire d'installer un AI Agent séparément. Vous pouvez configurer votre API dans la page « Settings -> Service Providers ».**

Vous pouvez aussi choisir n'importe quel Agent dans la liste des Agents pris en charge.

| Agent | Installation |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [Plus de guides d'installation d'Agent](https://doc.openteams-lab.com/getting-started)

---

## Fonctionnalités

| Fonctionnalité | Ce que vous obtenez |
|--|--|
| **Agents pris en charge** | Prise en charge de 10 runtimes d'Agents de code, dont `Claude Code`, `Gemini CLI`, `Codex`, `Qwen Code`, `Amp`, `Cursor Agent`, `Copilot`, `Droid`, `Kimi Code` et `OpenCode`. D'autres Agents sont en cours d'intégration.|
| **Contexte de chat de groupe partagé** | Tous les participants travaillent à partir du même historique de conversation, sans avoir à copier-coller des prompts entre plusieurs fenêtres. |
| **Exécution parallèle** | Plusieurs Agents peuvent traiter la même tâche en parallèle dans une session partagée. Chaque Agent prend en charge la partie qu'il maîtrise le mieux. |
| **Collaboration autonome** | Les Agents peuvent se `@mention`, se passer le relais et se coordonner directement dans le chat. |
| **Membres IA intégrés** | Commencez immédiatement avec plus de 160 membres IA intégrés couvrant l'ingénierie, le marketing, la rédaction, la recherche et la production de contenu. |
| **Préréglages d'équipes IA intégrés** | 8 préréglages d'équipe prêts à l'emploi sont fournis pour les workflows les plus courants. |
| **Règles de collaboration d'équipe** | Vous pouvez définir qui pilote, qui peut parler à qui et comment la collaboration doit fonctionner. Adaptez votre équipe IA et ses règles à votre manière de travailler. |
| **Bibliothèque de compétences** | Équipez vos Agents avec plus de 1000 compétences intégrées et importez vos propres compétences si nécessaire. |
| **Exécution entièrement locale** | Les Agents s'exécutent directement dans votre espace de travail local, et les artefacts d'exécution restent dans `.openteams/` à l'intérieur de cet espace. Vous n'avez donc pas à vous soucier de la confidentialité des données. |

### Exécution parallèle des Agents

*Lancez plusieurs Agents dans le même contexte partagé et laissez-les travailler en parallèle pour accélérer la livraison.*

![OpenTeams parallel](images/parallel.gif)

### Collaboration autonome des Agents

*OpenTeams permet aux Agents de s'envoyer des messages directement, sans imposer un workflow fixe. Si vous souhaitez davantage de structure, vous pouvez ajouter des règles d'équipe pour contrôler la communication, désigner un Agent leader, ou laisser tout le monde collaborer librement. Le mode de communication dépend entièrement de votre cas d'usage.*

![OpenTeams collaborate](images/collaborate.gif)

### Membres IA

*OpenTeams inclut plus de 160 membres IA intégrés, couvrant l'ingénierie, le marketing, la rédaction, la production de contenu et bien plus encore. Vous pouvez les combiner dans différentes équipes, les personnaliser et construire des combinaisons de rôles adaptées à votre façon de travailler. Nous continuerons à enrichir et améliorer cette bibliothèque de membres.*

![OpenTeams members](images/members.gif)

### Équipes IA

*OpenTeams est livré avec 8 préréglages d'équipe conçus pour les workflows courants, ce qui vous permet de démarrer immédiatement. Nous vous recommandons de définir les règles d'équipe au moment de la création afin que la collaboration reste alignée avec votre manière souhaitée de faire fonctionner le groupe.*

![OpenTeams team](images/team.gif)

### Bibliothèque de compétences

*OpenTeams inclut plus de 1000 compétences intégrées que vous pouvez combiner et attribuer à différents membres IA. Vous pouvez aussi importer les compétences que vous créez vous-même et les appliquer directement à vos Agents. Nous continuerons à enrichir la bibliothèque en privilégiant les capacités réellement solides en environnement de production.*

![OpenTeams skills](images/skills.gif)

---

## Pourquoi OpenTeams va plus loin

Légende : ✅ Prise en charge complète | 🟡 Prise en charge partielle | ❌ Non pris en charge

| **Capacité** | Agent unique traditionnel | Workflow multi-fenêtres | Claude Code Agent Team | openteams |
|--|--|--|--|--|
| **Parallélisme**| ❌ Non, uniquement séquentiel | 🟡 Partiel, manuel | ✅ Oui, sous-agents Claude | ✅ Oui, automatique |
| **Contexte partagé** | ❌ Non | ❌ Non, copier-coller requis | 🟡 Partiel, contextes de sous-agents séparés | ✅ Oui, toujours synchronisé |
| **Collaboration multi-modèles** | ❌ Non | 🟡 Partiel, changement manuel | ❌ Non, Claude uniquement | ✅ Oui, Claude + Gemini + Codex + autres |
| **Relais entre Agents** | ❌ Non | ❌ Non, orchestration manuelle | 🟡 Partiel, délégation dans Claude | ✅ Oui, `@mentions` directs |
| **Membres IA prédéfinis** | ❌ Non | ❌ Non | ❌ Non | ✅ Oui, 160+ membres |
| **Gestion de l'équipe** | ❌ Non | ❌ Non | ❌ Non | ✅ Oui, règles d'équipe personnalisables |
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
# 1. Cloner le dépôt
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. Installer les dépendances
pnpm i

# 3. Lancer le serveur de développement (backend Rust + frontend React)
pnpm run dev

# 4. Compiler le frontend
pnpm --filter frontend build

# 5. Compiler l'application desktop
pnpm desktop:build
```

#### Windows (PowerShell) : démarrer le backend et le frontend séparément

`pnpm run dev` ne fonctionne pas dans Windows PowerShell. Utilisez les commandes ci-dessous pour démarrer le backend et le frontend séparément.

```bash
# 1. Cloner le dépôt
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

Ouvrez le frontend à `http://localhost:<FRONTEND_PORT>` (exemple : `http://localhost:3001`).

#### Compiler `openteams-cli` en local

Si vous devez compiler le binaire local `openteams-cli` au lieu d'utiliser la version intégrée ou publiée, utilisez les commandes suivantes.
Les artefacts de build seront placés dans le répertoire binaries.

```bash
# Depuis la racine du dépôt
bun run ./scripts/build-openteams-cli.ts
```

## Notes de version et feuille de route

### V0.2

- [x] Chat multi-Agent avec contexte partagé
- [x] Exécution parallèle des Agents
- [x] `@mention` entre Agents et collaboration autonome
- [x] Prise en charge de 10 runtimes d'Agents de code (Claude Code, Gemini CLI, Codex, Qwen Code, Amp, Cursor Agent, Copilot, Droid, Kimi Code, OpenCode)
- [x] Applications desktop (Windows, macOS, Linux)
- [x] Application web utilisable via npx
- [x] Support multilingue (EN, ZH, JA, KO, FR, ES)

### V0.3
- [x] Refonte complète de l'interface frontend
- [x] 160+ membres IA intégrés
- [x] 8 préréglages d'équipes IA intégrés
- [x] Configuration des règles d'équipe
- [x] 1000+ compétences intégrées
- [x] Exécution entièrement locale avec isolation de l'espace de travail
- [x] Redéfinition du protocole d'entrée

### Feuille de route
- [x] Backend Code Agent optimisé pour les usages OpenTeams —— v0.3.7
- [x] Développement de plusieurs palettes frontend —— v0.3.11
- [ ] Mise en place d'un framework de collaboration d'équipe à haute efficacité
- [ ] Intégration de plus d'Agents (Kilo Code, OpenClaw, etc.)
- [ ] Ajout de davantage d'équipes IA prêtes à l'emploi
- [ ] Ajout de compétences plus puissantes
- [ ] Proposition d'une version hautement optimisée et personnalisée


## Contribution

Les contributions sont les bienvenues. Consultez [Issues](https://github.com/StarterraAI/OpenTeams/issues) pour voir ce qui est attendu, ou ouvrez une [Discussion](https://github.com/StarterraAI/OpenTeams/discussions).

1. Fork -> créer une branche feature -> ouvrir une PR
2. Merci d'ouvrir une issue avant les changements importants
3. Merci de respecter notre [Code of Conduct](../CODE_OF_CONDUCT.md)

### Formatage du code

Avant d'envoyer une PR, assurez-vous que le code est correctement formaté.

```bash
# Formater frontend et backend
pnpm run format

# Vérifier le format sans modifier les fichiers
pnpm run format:check

# Formater uniquement le frontend
pnpm run frontend:format

# Formater uniquement le backend (Rust)
pnpm run backend:format
```

**Remarque :** la CI échouera si le formatage du code n'est pas correct. Exécutez toujours `pnpm run format:check` avant de pousser.

## Communauté

| | |
|--|--|
| **Signalement de bugs** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **Discussions** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **Chat communautaire** | [Discord](https://discord.gg/MbgNFJeWDc) |

## Remerciements

Ce projet s'appuie sur [Vibe Kanban](https://www.vibekanban.com/) ; merci à leur équipe pour cette excellente base open source.

Merci également à [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) pour avoir contribué à structurer l'écosystème de compétences intégré, ainsi qu'à [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) pour l'inspiration autour de la conception des rôles d'Agent et de la composition d'équipe.
