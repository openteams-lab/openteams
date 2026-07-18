<div align="center">
  <img src="images/openteams-logo.png" alt="openteams" width="100">
</div>

<div align="center">
  <img src="images/characters_black.png" alt="openteams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>Planifier, construire et livrer — avec une équipe d'agents IA plutôt qu'un seul</h5>

  <p>
    openteams est une application de bureau IA open source et local-first qui aide les développeurs indépendants à planifier, construire et livrer plus vite avec une équipe IA qu'ils gardent sous leur contrôle.
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
<div align="center">
  <video src="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590" controls autoplay muted playsinline width="100%">
    <a href="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590">Voir la vidéo produit</a>
  </video>
</div>

## Qu'est-ce qu'openteams, exactement ?

Vous utilisez déjà Claude Code, Codex, Gemini CLI ou un autre agent de code. Chacun fonctionne bien seul. Puis vous ouvrez un deuxième terminal, puis un troisième. Vous répétez le même contexte, transportez les résultats d'une fenêtre à l'autre et gardez en tête qui modifie quoi. Rapidement, vous gérez les agents au lieu de gérer le travail : les changements sont dispersés entre plusieurs sessions, les priorités du projet se trouvent ailleurs et la consommation de tokens n'est pas reliée à ce qui a réellement été livré.

openteams apporte ce qui manque autour de ces agents : **une salle commune où ils peuvent échanger et se transmettre le travail, un plan que vous pouvez voir et contrôler, et un suivi local léger qui relie les tâches du projet aux résultats des agents sans leur confier la feuille de route.**

| openteams **est** | openteams **n'est pas** |
| --- | --- |
| un espace de travail local-first qui relie les agents de code que vous utilisez déjà | un nouveau modèle ou un remplacement de Claude Code, Codex ou Gemini CLI |
| une session partagée où les agents peuvent échanger, se transmettre le travail et conserver le même contexte | une série de chats séparés que vous devez encore coordonner vous-même |
| une liste d'issues gérée par le développeur et reliée aux sessions des agents | une suite complète de gestion de projet ou une feuille de route réécrite par les agents |
| un flux de travail que vous pouvez examiner, interrompre et relancer étape par étape | un gros prompt qui reste opaque jusqu'à la fin |
| des worktrees isolés à examiner, fusionner ou abandonner séparément | plusieurs agents qui modifient le même espace de travail et se gênent mutuellement |
| des statistiques de compilation qui montrent ce que les agents ont livré, les ressources consommées et leur coût | un compteur de tokens sans trace de ce qui a été construit |

**Concrètement, l'installation vous donne :** des sessions de chat pour la collaboration légère et l'exécution planifiée, des modèles de flux de travail en équipe prêts à l'emploi, des issues gérées par le développeur qui relient le travail aux sessions, des espaces de travail indépendants pour isoler les tâches parallèles et des statistiques de compilation détaillées.

```text
sans openteams                      avec openteams

Claude ─ terminal A ─┐              Claude ─┐
Codex ── terminal B ─┼─ vous relayez Codex ─┼─ session partagée
Gemini ─ terminal C ─┘              Gemini ─┘

plan : ailleurs                     issues ── sessions ── résultats
```

## Pourquoi openteams

Faire écrire du code à des agents n'est plus le plus difficile. Le vrai travail consiste à garder l'ensemble sous contrôle : conserver le contexte, savoir où en est chaque tâche, éviter que des travaux parallèles se marchent dessus, choisir la suite et connaître le coût réel.

openteams rassemble les agents et leurs échanges dans une même session. Pour les tâches complexes, le mode Workflow montre les étapes et leurs dépendances, ce qui permet de relire ou de relancer uniquement la partie nécessaire. Lorsque plusieurs sessions travaillent en parallèle, chacune peut disposer de son propre Git worktree ; les changements restent séparés jusqu'à ce que vous décidiez de les fusionner ou de les abandonner.

La direction du projet reste entre les mains du développeur. Les issues contiennent le travail que vous avez choisi et renvoient vers les sessions où les agents l'exécutent. Les agents font le travail, mais ne changent pas le plan à votre place. Une fois le travail terminé, les statistiques de compilation rapprochent les résultats de la consommation de tokens et du coût.

openteams ne cherche pas à ajouter davantage d'agents. Il sert à savoir, à tout moment, ce qui est en cours de construction, où se trouvent les changements, quelle est la prochaine étape et combien le résultat a coûté.

## Démarrage rapide
### Installation
#### Application de bureau (recommandée)

Téléchargez la dernière version pour votre plateforme depuis GitHub Releases.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-windows-x64.msi)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-macos.dmg)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-linux-amd64.deb)

**macOS :** La version macOS actuelle n’est ni signée avec un certificat Apple Developer ID ni notariée par Apple. Les navigateurs ajoutent un attribut de quarantaine aux applications téléchargées depuis Internet ; Gatekeeper peut donc indiquer qu’openteams est « endommagée » même si le téléchargement est intact. Après avoir déplacé `openteams.app` dans `/Applications`, et uniquement si vous êtes certain que l’application provient de la GitHub Release officielle d’openteams, exécutez :

```bash
xattr -dr com.apple.quarantine /Applications/openteams.app
```

Cette commande retire l’attribut de quarantaine uniquement d’openteams ; elle ne désactive pas Gatekeeper globalement.

#### npx

```bash
npx openteams-web
```

### Configurer les fournisseurs

**openteams** inclut un agent openteams CLI intégré. Configurez vos fournisseurs de modèles dans l'application via `Settings → Provider Config → Add Provider`.

⚙️ [Configuration des fournisseurs](https://doc.openteams-lab.com/advanced-usage/custom-provider)

Vous pouvez aussi connecter des agents de code pris en charge :

| Agent | Exemple d'installation |
| --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Gemini CLI | `npm i -g @google/gemini-cli` |
| Codex | `npm i -g @openai/codex` |
| Qwen Code | `npm i -g @qwen-code/qwen-code` |
| OpenCode | `npm i -g opencode-ai` |

📚 [Autres guides d'installation d'agents](https://doc.openteams-lab.com/getting-started)

## Mises à jour majeures
- **2026.05.20 (v0.4.4)**
  - Version beta du mode Workflow
- **2026.05.07 (v0.3.22)**
  - Possibilité d'enregistrer en un clic les membres d'une session de chat de groupe comme équipe prédéfinie
- **2026.04.14 (v0.3.15)**
  - Visualiseur des changements de fichiers de l'espace de travail
- **2026.04.06 (v0.3.12)**
  - Activation du mode UI sombre
  - Correction des problèmes de concurrence d'openteams-cli
- **2026.04.02 (v0.3.10)**
  - Mise en place de la mise à jour de version dans l'application
  - Le site de documentation est désormais en ligne

## Feuille de route

openteams est en développement actif. Voici la direction que nous prenons :

- [ ] **Travailleurs IA experts** — Lancer davantage de travailleurs IA dotés de connaissances métier spécialisées, capables de résoudre des problèmes experts.
- [ ] **Équipes IA à haut rendement** — Composer des équipes de travailleurs IA experts efficaces, capables de personnaliser des workflows de production pour des besoins métier précis et de transformer les exigences en livrables de bout en bout.
- [ ] **Intégrer davantage d'agents** — Intégrer davantage d'agents couramment utilisés, comme Kilo Code, hermes-agent et openclaw.

***Vision : transformer la consommation de tokens en productivité réelle.***

Vous avez une demande de fonctionnalité ou souhaitez contribuer à l'orientation du projet ? [Ouvrez une discussion](https://github.com/openteams-lab/openteams/discussions).

## Communauté

- [GitHub Issues](https://github.com/openteams-lab/openteams/issues) : bugs et demandes de fonctionnalités
- [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) : idées produit et questions
- [Discord](https://discord.gg/openteams) : chat communautaire
- [Linux.do](https://linux.do) : site partenaire ; merci pour le soutien aux échanges de la communauté
- Groupes communautaires :

<p>
  <a href="images/openteams-wechat-community.png"><img alt="QR code du groupe communautaire WeChat openteams" src="images/openteams-wechat-community.png" width="260"></a>
  <a href="images/openteams-feishu-community.png"><img alt="QR code du groupe communautaire Feishu/Lark openteams" src="images/openteams-feishu-community.png" width="260"></a>
</p>

## Fonctionnalités clés

| Fonctionnalité | Ce que cela signifie |
| --- | --- |
| Employés IA et équipes IA | Transformez les tokens en productivité réelle. Chaque employé IA ou équipe possède une expertise de domaine qui transforme les modèles généralistes en spécialistes prêts à livrer du travail, pas seulement à générer du texte. |
| Workspace multi-agent | Faites entrer plusieurs agents IA dans une même session partagée au lieu de jongler entre des fenêtres séparées. |
| Contexte partagé | Les agents travaillent à partir de la même conversation et du même contexte projet. |
| Free Chat | Utilisez `@` pour une collaboration directe et légère avec les agents. |
| Mode Workflow | Convertissez les tâches complexes en étapes structurées, dépendances, revues, relances et acceptation. |
| Exécution visible | Voyez ce que fait chaque agent et où le travail est bloqué. |
| Revue et relance | Relisez une étape, relancez la bonne tâche et évitez de redémarrer tout le projet. |
| Gestion des issues | Enregistrez et priorisez les éléments de travail contrôlés par le développeur, synchronisez les issues GitHub et créez ou reliez des sessions d'exécution. |
| Workspaces isolés | Exécutez les tâches de chaque session dans un Git worktree distinct, puis relisez, fusionnez ou abandonnez chaque résultat sans affecter les autres travaux. |
| Statistiques de compilation | Comparez les bugs corrigés et les fonctionnalités livrées avec la consommation de tokens et les coûts par session et par modèle. |
| Artefacts et traces | Conservez les logs, diffs, transcriptions et artefacts générés attachés au travail. |
| Exécution locale | Les agents travaillent dans l'espace de travail configuré, avec les enregistrements d'exécution conservés sous `.openteams/`. |

## À qui cela s'adresse

openteams s'adresse à :

- des développeurs qui utilisent plusieurs agents de code et en ont assez de jongler entre eux
- des leads techniques qui ont besoin que les exécutions d'agents soient auditables et reproductibles

Ce n'est pas seulement un endroit pour rassembler plus d'agents. C'est une façon de transformer des agents en véritable équipe de travail.

## Stack technique

| Couche | Technologie |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Rust |
| Desktop | Tauri |
| Database | SQLx-managed relational schema |
| Workflow UI | React Flow |

## Développement local

### Prérequis

- **Rust** >= 1.75
- **Node.js** >= 18
- **pnpm** >= 8

### macOS, Linux et Windows

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

### Compiler `openteams-cli` localement

Utilisez les commandes suivantes si vous devez compiler le binaire local `openteams-cli` au lieu d'utiliser la version intégrée ou publiée.
Les artefacts de compilation seront placés dans le répertoire binaries.

```bash
# From the repository root
bun run ./scripts/build-openteams-cli.ts
```

## Contribution

Les contributions sont les bienvenues, notamment les workflows d'équipes IA réutilisables que d'autres pourront étudier et adapter. Voici comment commencer :

1. **Trouver une issue** — Consultez les [Good First Issues](https://github.com/openteams-lab/openteams/labels/good%20first%20issue) pour des tâches accessibles aux débutants, ou parcourez les issues ouvertes.
2. **Discuter avant de construire** — Avant d'ouvrir une grosse pull request, ouvrez une issue ou une discussion afin de vous accorder sur l'orientation du projet.
3. **Respecter le style de code** — Exécutez ce qui suit avant de soumettre :

```bash
pnpm run format
pnpm run check
pnpm run lint
```

4. **Soumettre une PR** — Décrivez ce que vous avez changé et pourquoi. Liez l'issue associée le cas échéant.

Consultez [CONTRIBUTING.md](../CONTRIBUTING.md) pour le guide complet.

## Licence

openteams est publié sous Apache License 2.0. Concrètement, vous pouvez :

- l'utiliser gratuitement pour des projets personnels, éducatifs, internes ou commerciaux ;
- copier, modifier et réutiliser le code source comme base de votre travail ;
- distribuer la version originale ou modifiée, sous forme de code source ou de logiciel compilé ;
- l'intégrer à un produit propriétaire et vendre ce produit sans ouvrir le reste de votre code source.

Si vous redistribuez openteams ou une version modifiée, joignez une copie de la licence, conservez les mentions de copyright et d'attribution pertinentes, et indiquez clairement les fichiers modifiés.

Trois autres points sont à connaître :

- **Marque :** Vous pouvez utiliser le code, mais vous ne pouvez pas vous présenter comme le projet officiel openteams ni utiliser son nom ou ses marques comme votre propre marque.
- **Brevets :** Les contributeurs vous autorisent à utiliser les brevets nécessairement liés à leur code, afin qu'ils ne puissent pas s'en servir pour vous empêcher d'utiliser openteams. En échange, si vous engagez une action affirmant qu'openteams enfreint votre brevet, vous perdez cette protection. Seule l'autorisation liée aux brevets prend fin, pas votre droit ordinaire d'utiliser le code. Les utilisateurs qui n'engagent pas de procédure en matière de brevets ne sont normalement pas concernés.
- **Risques :** Le logiciel est fourni gratuitement en l'état. Vous devez décider vous-même s'il répond à vos besoins et assumer les risques liés à son utilisation ; le projet ne fournit aucune garantie ni indemnisation.

Cette section est un résumé en langage courant. Le fichier [LICENSE](../LICENSE) contient les conditions juridiques qui font foi.

Consultez [LICENSE](../LICENSE) pour les conditions juridiques complètes.
